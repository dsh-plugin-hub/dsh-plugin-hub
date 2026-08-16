#!/usr/bin/env node

// P1-T4 本地数据同步全量化：created 月份分桶贪心扫描（方案文档 4.1 / PLAN 6.1）。
// - 从当前月逐月向过去回退，桶触顶（>=1000 条，Search API 单查询硬上限）二分递归，
//   连续 3 个空桶停止；
// - 配额保护：匿名 Search API 10 次/分 -> 调用间 sleep >= 6.5s（有 GITHUB_TOKEN 时
//   30 次/分 -> 2.2s）；403/429 读 x-ratelimit-remaining/reset，短重置自动等待续跑，
//   长重置/重试耗尽时把已完成的桶保存到 data/topic-scan-state.json 并退出，重跑自动
//   续扫（created 不可变，已完成桶直接跳过，不重复消耗配额）；
// - 数据模型（P1-T2 新契约）：facts 由 lib/plugin-screening.mjs 的 deriveFacts 计算；
//   不写 screening/screenedCommit/installCommand/attention 字段；removed 初始 false，
//   与上次 generated 快照 diff，消失的插件标记 removed=true（完整扫描成功时才做 diff）；
// - 保留：curated 精选加载（含 curated.snapshot.json 回退）、raw package.json 事实采集
//   （mapLimit 并发、失败跳过）、GITHUB_TOKEN 可选、DSH_SKIP_MANIFESTS=1 逃生门、
//   双写 data/plugins.generated.json + public/plugins.json。

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readResponseTextLimited } from "../lib/limited-response.mjs";
import {
  LOCKFILES,
  categoryFromText,
  deriveFacts,
  manifestSummary,
  sanitizeRegistryInstallEvidence,
} from "../lib/plugin-screening.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = path.join(root, "data", "curated.snapshot.json");
const scanStatePath = path.join(root, "data", "topic-scan-state.json");
const generatedPath = path.join(root, "data", "plugins.generated.json");
const publicPath = path.join(root, "public", "plugins.json");
const MAX_JSON_BYTES = 6_000_000;
const MAX_TEXT_BYTES = 140_000;
// 全量 union（curated 820 + topic ~4200）pretty-printed 约 6~13 MB；旧 820 条文件约 2.1 MB。
const MAX_OUTPUT_BYTES = 16_000_000;
const MAX_CURATED_PLUGINS = 2_000;

const SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 10; // GitHub Search API 单查询硬上限 1000 条
const SEARCH_RESULT_CAP = SEARCH_PAGE_SIZE * MAX_SEARCH_PAGES;
const EMPTY_MONTH_STREAK_LIMIT = 3; // 连续 3 个空桶即停止
const MAX_RATE_LIMIT_WAIT_MS = 120_000; // 403/429 自动等待配额重置的上限（超过则保存断点退出）

const curatedUrl =
  process.env.DSH_CURATED_REGISTRY_URL ||
  "https://awesome-dsh-plugin.com/plugins.json";
const publicCuratedUrl = (() => {
  try {
    const url = new URL(curatedUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "https://awesome-dsh-plugin.com/plugins.json";
  }
})();
const githubToken = process.env.GITHUB_TOKEN?.trim();
const skipManifests = process.env.DSH_SKIP_MANIFESTS === "1";
// 匿名 Search API 10 次/分 -> 6.5s 间隔；带 token 30 次/分 -> 2.2s 间隔（各留 ~8% 余量）。
const SEARCH_INTERVAL_MS = githubToken ? 2_200 : 6_500;

const githubHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "dsh-plugin-hub-data-sync",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
};

/** P1-T2 数据模型的 12 类分类白名单（lib/plugin-data.ts CategoryId）。 */
const CATEGORY_IDS = new Set([
  "ui", "theme", "model", "session", "memory", "tools",
  "skill", "workflow", "notify", "dev", "market", "fun",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function fetchJson(url, options = {}, maxBytes = MAX_JSON_BYTES) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}`);
    error.status = response.status;
    error.reset = response.headers.get("x-ratelimit-reset");
    error.remaining = response.headers.get("x-ratelimit-remaining");
    throw error;
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error(`Response too large (${length} bytes)`);
  return JSON.parse(await readResponseTextLimited(response, maxBytes));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "dsh-plugin-hub-data-sync" },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_TEXT_BYTES) throw new Error(`Response too large (${length} bytes)`);
  return readResponseTextLimited(response, MAX_TEXT_BYTES);
}

function repoParts(url) {
  const parsed = new URL(url);
  const [owner, name] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !name || parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    throw new Error(`Unsupported plugin repository URL: ${url}`);
  }
  if (!/^[a-z0-9_.-]+$/iu.test(owner) || !/^[a-z0-9_.-]+(?:[.]git)?$/iu.test(name)) {
    throw new Error(`Unsupported plugin repository URL: ${url}`);
  }
  return { owner, name: name.replace(/[.]git$/u, ""), fullName: `${owner}/${name.replace(/[.]git$/u, "")}` };
}

function canonicalGithubRepositoryUrl(value) {
  try {
    return `https://github.com/${repoParts(value).fullName}`;
  } catch {
    return "https://github.com/awesome-dsh-plugin/awesome-dsh-plugin";
  }
}

function isoAgeDays(value, now = Date.now()) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now - time) / 86_400_000));
}

function maintenanceState(meta) {
  if (meta?.archived) return "archived";
  const age = isoAgeDays(meta?.pushed_at);
  if (age === null) return "unknown";
  if (age <= 30) return "active";
  if (age <= 180) return "warm";
  return "quiet";
}

async function mapLimit(items, limit, mapper) {
  const result = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      result[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

async function loadCurated() {
  const fallback = await readJson(snapshotPath);
  try {
    const live = await fetchJson(curatedUrl, {
      headers: { Accept: "application/json", "User-Agent": "dsh-plugin-hub-data-sync" },
    });
    if (!Array.isArray(live.plugins) || !live.plugins.length || live.plugins.length > MAX_CURATED_PLUGINS) {
      throw new Error("Curated registry returned no plugins");
    }
    await writeFile(snapshotPath, `${JSON.stringify(live, null, 2)}
`);
    return { registry: live, state: "live" };
  } catch (error) {
    if (!fallback?.plugins?.length) throw error;
    return { registry: fallback, state: "snapshot" };
  }
}

// ---------------------------------------------------------------------------
// GitHub Search 配额保护：sleep 限速 + 403/429 重置等待 + 断点保存
// ---------------------------------------------------------------------------

let lastSearchAt = 0;

async function waitForSearchSlot() {
  const wait = SEARCH_INTERVAL_MS - (Date.now() - lastSearchAt);
  if (wait > 0) await sleep(wait);
  lastSearchAt = Date.now();
}

async function fetchJsonWithSearchRetry(url, retriesLeft = 2) {
  try {
    return await fetchJson(url, { headers: githubHeaders });
  } catch (error) {
    const limited = error.status === 403 || error.status === 429;
    const exhausted = Number(error.remaining) === 0;
    if (limited && exhausted && retriesLeft > 0) {
      const resetMs = Number(error.reset || 0) * 1000;
      const wait = resetMs - Date.now();
      if (Number.isFinite(wait) && wait > 0 && wait <= MAX_RATE_LIMIT_WAIT_MS) {
        console.warn(
          `GitHub search quota exhausted (x-ratelimit-remaining 0); pausing ${Math.ceil(wait / 1000)}s until ${new Date(resetMs).toISOString()}`,
        );
        await sleep(wait + 2_000);
        return fetchJsonWithSearchRetry(url, retriesLeft - 1);
      }
    }
    throw error;
  }
}

/** 单页搜索（受 6.5s/2.2s 限速 + 403/429 自动续跑保护）。 */
async function searchPage(query, page) {
  await waitForSearchSlot();
  const params = new URLSearchParams({
    q: query,
    sort: "created",
    order: "asc",
    per_page: String(SEARCH_PAGE_SIZE),
    page: String(page),
  });
  return fetchJsonWithSearchRetry(`https://api.github.com/search/repositories?${params}`);
}

/** 逐页翻完一个桶（最多 1000 条），页不满或触顶即停。 */
async function searchAll(query) {
  const items = [];
  for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
    const payload = await searchPage(query, page);
    const batch = payload.items || [];
    items.push(...batch);
    if (batch.length < SEARCH_PAGE_SIZE) break;
  }
  return items;
}

/** topic:dsh-plugin 总仓库数（1 次 search 调用）。 */
async function fetchTopicTotal() {
  await waitForSearchSlot();
  const params = new URLSearchParams({ q: "topic:dsh-plugin", per_page: "1" });
  const payload = await fetchJsonWithSearchRetry(`https://api.github.com/search/repositories?${params}`);
  return typeof payload.total_count === "number" ? payload.total_count : null;
}

// ---------------------------------------------------------------------------
// created 月份分桶贪心扫描（PLAN 6.1 / 方案 4.1），带断点续扫
// ---------------------------------------------------------------------------

function startOfMonthUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonthUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function previousMonthStart(monthStart) {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 把 [startIso, endIso] 日范围切成两个严格更小的日范围（切点取中点所在日的下一天 00:00）。
 * 单日范围返回 null（Search API 单查询上限 1000 条，单日无法继续按日二分）。
 * 切点由日期范围唯一确定 -> 断点续扫时重拆分可复现相同叶子键。
 */
function splitDayRange(startIso, endIso) {
  if (startIso >= endIso) return null;
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  const mid = new Date((start.getTime() + end.getTime()) / 2);
  const boundary = new Date(Date.UTC(mid.getUTCFullYear(), mid.getUTCMonth(), mid.getUTCDate() + 1));
  const boundaryIso = isoDate(boundary);
  if (boundaryIso <= startIso || boundaryIso > endIso) return null;
  const leftEnd = isoDate(new Date(boundary.getTime() - 86_400_000));
  return { left: [startIso, leftEnd], right: [boundaryIso, endIso] };
}

function leafKey(startIso, endIso) {
  return `${startIso}..${endIso}`;
}

/** 桶内（含此前已完成叶子）在 [startIso, endIso] 日范围内已收集的去重仓库数。 */
function countItemsInRange(scan, startIso, endIso) {
  let count = 0;
  for (const item of scan.items.values()) {
    const day = (item?.created_at || "").slice(0, 10);
    if (day >= startIso && day <= endIso) count += 1;
  }
  return count;
}

/** 该范围内是否已有完成的分桶叶子（断点续扫时跳过已完成的二分分支，不重查）。 */
function hasCompletedLeaf(scan, startIso, endIso) {
  for (const key of scan.completed) {
    if (!key.includes("..")) continue;
    const sep = key.indexOf("..");
    const leafStart = key.slice(0, sep);
    const leafEnd = key.slice(sep + 2);
    if (leafStart >= startIso && leafEnd <= endIso) return true;
  }
  return false;
}

function addItems(scan, results) {
  for (const item of results) {
    const id = String(item?.full_name || item?.repo || "").toLowerCase();
    if (id) scan.items.set(id, item);
  }
}

async function saveScanState(scan) {
  await writeFile(
    scanStatePath,
    `${JSON.stringify(
      {
        version: 1,
        total: scan.total,
        completed: [...scan.completed].sort(),
        emptyMonths: [...scan.emptyMonths].sort(),
        items: [...scan.items.values()],
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    )}
`,
  );
}

/**
 * 递归分桶（PLAN 6.1 / 方案 4.1）：
 * 桶结果 < 1000 -> 桶完整，标记完成并返回；触顶 -> 中点二分递归。
 * 断点续扫：已完成桶/叶子直接跳过（created 不可变，永不重扫）；
 * 已有完成叶子的桶重拆分但不重查（二分切点由日范围唯一确定，叶子键可复现）。
 */
async function sweepBucket(startIso, endIso, key, scan) {
  if (scan.completed.has(key)) return [];
  if (hasCompletedLeaf(scan, startIso, endIso)) {
    const split = splitDayRange(startIso, endIso);
    if (!split) return [];
    return [
      ...(await sweepBucket(split.left[0], split.left[1], leafKey(split.left[0], split.left[1]), scan)),
      ...(await sweepBucket(split.right[0], split.right[1], leafKey(split.right[0], split.right[1]), scan)),
    ];
  }
  const results = await searchAll(`topic:dsh-plugin created:${startIso}..${endIso}`);
  if (results.length < SEARCH_RESULT_CAP) {
    scan.completed.add(key);
    addItems(scan, results);
    await saveScanState(scan);
    return results;
  }
  // 触顶：按日二分；单日仍触顶（一天 >1000 条）则保留已取结果并告警（Search API 上限）。
  const split = splitDayRange(startIso, endIso);
  if (!split) {
    console.warn(
      `bucket ${key} exceeds the 1000-result search cap and cannot be split further; keeping ${results.length} results`,
    );
    scan.completed.add(key);
    addItems(scan, results);
    await saveScanState(scan);
    return results;
  }
  return [
    ...(await sweepBucket(split.left[0], split.left[1], leafKey(split.left[0], split.left[1]), scan)),
    ...(await sweepBucket(split.right[0], split.right[1], leafKey(split.right[0], split.right[1]), scan)),
  ];
}

/**
 * 首轮全量：从当前月逐月向过去回退，连续 3 个空桶停止（PLAN 6.1 / 方案 7.1）。
 * 扫描中断（403/429 且重置过远）时保存断点并抛错；重跑从断点继续。
 * 成功后删除断点文件（下一轮全新全量刷新元数据）。
 */
async function scanTopic(previous) {
  const persisted = await readJson(scanStatePath, null);
  const resumed = Boolean(persisted);
  const scan = {
    completed: new Set(persisted?.completed || []),
    emptyMonths: new Set(persisted?.emptyMonths || []),
    items: new Map(
      (persisted?.items || [])
        .map((item) => [String(item?.full_name || item?.repo || "").toLowerCase(), item])
        .filter(([id]) => Boolean(id)),
    ),
    total: typeof persisted?.total === "number" ? persisted.total : null,
  };
  if (resumed) {
    console.log(
      `resuming topic sweep: ${scan.completed.size} buckets done, ${scan.items.size} repos already collected`,
    );
  }

  if (scan.total === null) {
    try {
      scan.total = await fetchTopicTotal();
      await saveScanState(scan);
    } catch (error) {
      scan.total = previous?.sources?.topic?.total ?? null;
      console.warn(
        `topic total query failed (${error instanceof Error ? error.message : error}); using previous total ${scan.total}`,
      );
    }
  }

  try {
    let cursor = startOfMonthUtc(new Date());
    let emptyStreak = 0;
    while (emptyStreak < EMPTY_MONTH_STREAK_LIMIT) {
      const key = monthKey(cursor);
      const monthStart = cursor;
      const monthEnd = endOfMonthUtc(cursor);
      if (scan.emptyMonths.has(key)) {
        emptyStreak += 1; // 此前已确认该月为空
      } else if (scan.completed.has(key)) {
        emptyStreak = 0; // 非空桶，中断连续空桶计数
      } else {
        const startIso = isoDate(monthStart);
        const endIso = isoDate(monthEnd);
        const before = countItemsInRange(scan, startIso, endIso);
        await sweepBucket(startIso, endIso, key, scan);
        const after = countItemsInRange(scan, startIso, endIso);
        if (before === 0 && after === 0) {
          scan.emptyMonths.add(key);
          emptyStreak += 1;
        } else {
          emptyStreak = 0;
        }
        await saveScanState(scan);
        console.log(
          `bucket ${key}: +${after - before} repos (month ${after}, cumulative ${scan.items.size}, empty streak ${emptyStreak})`,
        );
      }
      cursor = previousMonthStart(cursor);
      if (cursor.getUTCFullYear() < 2008) break; // GitHub 成立年份，防御性下限
    }
  } catch (error) {
    if (error.status === 403 || error.status === 429) {
      await saveScanState(scan);
      throw new Error(
        `GitHub search rate limit reached (${error.message}); ` +
          `scan state saved to ${path.relative(root, scanStatePath)} - rerun the script to resume`,
        { cause: error },
      );
    }
    throw error;
  }

  await rm(scanStatePath, { force: true });
  return {
    items: [...scan.items.values()],
    total: scan.total ?? scan.items.size,
    scanned: scan.items.size,
    state: "live",
    error: null,
  };
}

// ---------------------------------------------------------------------------
// 记录构造与事实采集（新数据模型：无 screening，有 facts/removed）
// ---------------------------------------------------------------------------

function licenseFromMeta(license) {
  return license?.spdx_id && license.spdx_id !== "NOASSERTION" ? license.spdx_id : null;
}

/**
 * 拉取 package.json 并 best-effort 探测 README/锁文件，供 deriveFacts 填真实值。
 * 返回 { manifest, files, inspected }：inspected=false 表示本次未实检
 * （命中上次快照缓存或仓库无 package.json），此时 facts 走保守/复用路径。
 */
async function inspectManifest(record, topicMeta, previous) {
  const pushedAt = topicMeta?.pushed_at || null;
  if (
    previous?.manifest &&
    previous?.pushedAt === pushedAt &&
    previous.manifest.state !== "error"
  ) {
    return { manifest: previous.manifest, files: null, inspected: false };
  }

  const repo = record.repo;
  const branches = [...new Set([topicMeta?.default_branch, "main", "master"].filter(Boolean))];
  for (const branch of branches) {
    let pkgText = null;
    try {
      pkgText = await fetchText(
        `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/package.json`,
      );
    } catch {
      // raw 拉取失败（网络/瞬时 5xx）按缺失处理，尝试下一个分支
    }
    if (!pkgText) continue;

    let manifest;
    try {
      manifest = manifestSummary(JSON.parse(pkgText), branch);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return { manifest: { ...manifestSummary(null, branch), state: "invalid" }, files: [], inspected: true };
      }
      throw error;
    }

    const probeNames = ["README.md", ...LOCKFILES];
    const probeResults = await Promise.all(
      probeNames.map(async (name) => {
        try {
          return await fetchText(
            `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${encodeURIComponent(name)}`,
          );
        } catch {
          return null;
        }
      }),
    );
    const files = ["package.json"];
    probeResults.forEach((text, index) => {
      if (text) files.push(probeNames[index]);
    });
    return { manifest, files, inspected: true };
  }

  return { manifest: manifestSummary(null, topicMeta?.default_branch || null), files: null, inspected: false };
}

/** topic 扫描结果构造 PluginRecord（curated=false）。 */
function topicRecord(item, previous, now) {
  const fullName = String(item.full_name || item.repo || "");
  const [owner, name] = fullName.split("/");
  const id = fullName.toLowerCase();
  const description = String(item.description || name || "").trim();
  return {
    id,
    order: 0,
    name: previous?.name || item.name || name || fullName,
    owner: previous?.owner || item.owner?.login || owner,
    repo: fullName,
    url: item.html_url || `https://github.com/${fullName}`,
    category: previous?.category || categoryFromText(`${item.name || name} ${description}`),
    description: previous?.description || { zh: description, en: description },
    added: previous?.added || now.slice(0, 10),
    curated: false,
    topic: true,
    stars: item.stargazers_count ?? previous?.stars ?? null,
    forks: item.forks_count ?? previous?.forks ?? null,
    openIssues: item.open_issues_count ?? previous?.openIssues ?? null,
    watchers: item.subscribers_count ?? item.watchers_count ?? previous?.watchers ?? null,
    pushedAt: item.pushed_at ?? previous?.pushedAt ?? null,
    updatedAt: item.updated_at ?? previous?.updatedAt ?? null,
    createdAt: item.created_at ?? previous?.createdAt ?? null,
    license: licenseFromMeta(item.license) ?? previous?.license ?? null,
    language: item.language ?? previous?.language ?? null,
    homepage: item.homepage || previous?.homepage || null,
    archived: Boolean(item.archived),
    defaultBranch: item.default_branch || previous?.defaultBranch || null,
    maintenance: maintenanceState(item),
    manifest: null,
    facts: null,
    removed: false,
    discovery: {
      source: "topic",
      firstSeenAt: previous?.discovery?.firstSeenAt || previous?.added || now.slice(0, 10),
      lastSeenAt: now,
    },
  };
}

/** curated 精选条目构造 PluginRecord（curated=true，topic 元数据命中时合并）。 */
function curatedRecord(entry, topicMeta, previous, now, index) {
  const parts = repoParts(entry.url);
  const id = parts.fullName.toLowerCase();
  const rawDescription = entry.description;
  const description =
    rawDescription && typeof rawDescription === "object" && !Array.isArray(rawDescription)
      ? rawDescription
      : typeof rawDescription === "string"
        ? { zh: rawDescription, en: rawDescription }
        : previous?.description || { zh: "", en: "" };
  const category = CATEGORY_IDS.has(entry.category)
    ? entry.category
    : previous?.category && CATEGORY_IDS.has(previous.category)
      ? previous.category
      : categoryFromText(`${parts.name} ${description.en || ""} ${description.zh || ""}`);
  return {
    id,
    order: index,
    name: entry.name || previous?.name || parts.name,
    owner: entry.owner || previous?.owner || parts.owner,
    repo: parts.fullName,
    url: entry.url,
    category,
    description,
    added: entry.added || previous?.added || null,
    curated: true,
    topic: Boolean(topicMeta),
    stars: topicMeta?.stargazers_count ?? previous?.stars ?? null,
    forks: topicMeta?.forks_count ?? previous?.forks ?? null,
    openIssues: topicMeta?.open_issues_count ?? previous?.openIssues ?? null,
    watchers: topicMeta?.subscribers_count ?? topicMeta?.watchers_count ?? previous?.watchers ?? null,
    pushedAt: topicMeta?.pushed_at ?? previous?.pushedAt ?? null,
    updatedAt: topicMeta?.updated_at ?? previous?.updatedAt ?? null,
    createdAt: topicMeta?.created_at ?? previous?.createdAt ?? null,
    license: licenseFromMeta(topicMeta?.license) ?? previous?.license ?? null,
    language: topicMeta?.language ?? previous?.language ?? null,
    homepage: topicMeta?.homepage || previous?.homepage || null,
    archived: Boolean(topicMeta?.archived),
    defaultBranch: topicMeta?.default_branch || previous?.defaultBranch || null,
    maintenance: maintenanceState(topicMeta),
    manifest: null,
    facts: null,
    removed: false,
    discovery: {
      source: "curated",
      firstSeenAt: entry.added || previous?.discovery?.firstSeenAt || previous?.added || now.slice(0, 10),
      lastSeenAt: now,
    },
  };
}

async function main() {
  await mkdir(path.dirname(generatedPath), { recursive: true });
  // 用 lib 的字段白名单清洗上次快照（剔除旧 screening/installCommand 等字段）。
  const previous = sanitizeRegistryInstallEvidence(await readJson(generatedPath, {}));
  const previousById = new Map((previous.plugins || []).map((plugin) => [plugin.id, plugin]));

  const { registry, state: curatedState } = await loadCurated();
  console.log(`curated registry: ${curatedState} (${registry.plugins.length} plugins)`);

  const topic = await scanTopic(previous);
  console.log(`topic sweep complete: ${topic.scanned} unique repos (topic total ${topic.total})`);

  const generatedAt = new Date().toISOString();
  const topicByName = new Map(
    topic.items.map((item) => [String(item.full_name || item.repo || "").toLowerCase(), item]),
  );

  // union：curated 优先，topic 补齐（方案 4.1「完整性 = topic 全量 ∪ awesome 精选」）。
  const records = new Map();
  const curatedOrder = [];
  for (const entry of registry.plugins) {
    let parts;
    try {
      parts = repoParts(entry.url);
    } catch (error) {
      console.warn(`skipping curated entry: ${error.message}`);
      continue;
    }
    const id = parts.fullName.toLowerCase();
    if (records.has(id)) continue;
    const record = curatedRecord(entry, topicByName.get(id), previousById.get(id), generatedAt, curatedOrder.length);
    records.set(id, record);
    curatedOrder.push(record);
  }
  for (const item of topic.items) {
    const id = String(item.full_name || item.repo || "").toLowerCase();
    if (records.has(id)) continue;
    records.set(id, topicRecord(item, previousById.get(id), generatedAt));
  }

  // manifest/facts 采集（mapLimit 并发，失败跳过）。
  const union = [...records.values()];
  if (skipManifests) {
    // 逃生门：不拉 package.json；facts 保守默认（hasLicense 用 search 元数据真实值），
    // 上次快照已有真实 facts 时复用。
    for (const record of union) {
      const previousRecord = previousById.get(record.id);
      const topicMeta = topicByName.get(record.id);
      record.manifest = previousRecord?.manifest || manifestSummary(null, topicMeta?.default_branch || null);
      const reusedFacts = previousRecord?.facts;
      record.facts = {
        ...deriveFacts(record.manifest, { license: topicMeta?.license }),
        hasLockfile: Boolean(reusedFacts?.hasLockfile),
        hasReadme: Boolean(reusedFacts?.hasReadme),
      };
    }
  } else {
    await mapLimit(union, 10, async (record) => {
      const previousRecord = previousById.get(record.id);
      const topicMeta = topicByName.get(record.id);
      try {
        const inspected = await inspectManifest(record, topicMeta, previousRecord);
        record.manifest = inspected.manifest;
        const reusedFacts = previousRecord?.facts;
        record.facts = inspected.inspected
          ? deriveFacts(inspected.manifest, { license: topicMeta?.license, files: inspected.files })
          : {
              ...deriveFacts(inspected.manifest, { license: topicMeta?.license }),
              hasLockfile: Boolean(reusedFacts?.hasLockfile),
              hasReadme: Boolean(reusedFacts?.hasReadme),
            };
      } catch (error) {
        console.warn(
          `manifest inspection failed for ${record.id}: ${error instanceof Error ? error.message : error}`,
        );
        record.manifest = previousRecord?.manifest || manifestSummary(null, topicMeta?.default_branch || null);
        const reusedFacts = previousRecord?.facts;
        record.facts = {
          ...deriveFacts(record.manifest, { license: topicMeta?.license }),
          hasLockfile: Boolean(reusedFacts?.hasLockfile),
          hasReadme: Boolean(reusedFacts?.hasReadme),
        };
      }
    });
  }

  // 与上次 generated 快照 diff：完整扫描成功时，消失的插件标记 removed=true（诚实记账）。
  // scanned > 0 守卫：扫描一无所获（降级/异常）时不做删除性 diff。
  if (topic.scanned > 0) {
    for (const prevRecord of previousById.values()) {
      if (records.has(prevRecord.id)) continue;
      records.set(prevRecord.id, {
        ...prevRecord,
        removed: true,
        facts: prevRecord.facts || deriveFacts(prevRecord.manifest || manifestSummary(null, null), {}),
        discovery: {
          source: prevRecord.discovery?.source || "topic",
          firstSeenAt: prevRecord.discovery?.firstSeenAt || prevRecord.added || generatedAt.slice(0, 10),
          lastSeenAt: generatedAt,
        },
      });
    }
  }

  const plugins = [...records.values()].sort((a, b) => {
    if (a.removed !== b.removed) return a.removed ? 1 : -1;
    if (a.curated !== b.curated) return a.curated ? -1 : 1;
    if (a.curated) return a.order - b.order;
    return (b.stars || 0) - (a.stars || 0) || a.name.localeCompare(b.name);
  });
  plugins.forEach((plugin, index) => {
    plugin.order = index;
  });

  const livePlugins = plugins.filter((plugin) => !plugin.removed);
  const removedCount = plugins.length - livePlugins.length;
  const metadataMatches = livePlugins.filter((plugin) => plugin.topic).length;
  const manifestMatches = livePlugins.filter((plugin) => plugin.manifest?.state === "verified").length;
  const output = {
    schemaVersion: 2,
    generatedAt,
    automation: {
      enabled: true,
      schedule: "*/30 * * * *",
      state: "bundled",
      scanVersion: 1,
      lastRunAt: null,
      lastSuccessfulRunAt: null,
      checkedThisRun: 0,
      discoveredThisRun: 0,
      admittedThisRun: 0,
      rejectedTotal: 0,
      error: null,
    },
    sources: {
      curated: {
        url: publicCuratedUrl,
        repository: canonicalGithubRepositoryUrl(registry.source),
        state: curatedState,
        updated: registry.updated,
        count: registry.count,
      },
      topic: {
        url: "https://github.com/topics/dsh-plugin",
        query: "topic:dsh-plugin created:YYYY-MM-DD..YYYY-MM-DD (month-bucket sweep)",
        state: topic.state,
        total: topic.total,
        scanned: topic.scanned,
        matched: metadataMatches,
        error: topic.error,
      },
    },
    summary: {
      curated: livePlugins.filter((plugin) => plugin.curated).length,
      listed: livePlugins.length,
      autoDiscovered: livePlugins.filter((plugin) => !plugin.curated).length,
      topicTotal: topic.total,
      metadataMatches,
      manifestMatches,
      owners: new Set(livePlugins.map((plugin) => plugin.owner.toLowerCase())).size,
      stars: livePlugins.reduce((sum, plugin) => sum + (plugin.stars || 0), 0),
    },
    categories: registry.categories,
    plugins,
  };

  const serialized = `${JSON.stringify(output, null, 2)}
`;
  if (Buffer.byteLength(serialized) > MAX_OUTPUT_BYTES) {
    throw new Error(`Generated registry exceeds ${MAX_OUTPUT_BYTES} bytes`);
  }
  await writeFile(generatedPath, serialized);
  await writeFile(publicPath, serialized);
  console.log(
    `synced ${livePlugins.length} plugins (${output.summary.curated} curated, ${output.summary.autoDiscovered} topic-only)` +
      `${removedCount ? `, ${removedCount} removed` : ""}; ` +
      `${metadataMatches} topic matches; ${manifestMatches} manifests; topic total ${topic.total}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

