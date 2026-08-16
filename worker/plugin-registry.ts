/**
 * Worker 侧 GitHub 全量贪心分桶扫描（P1-T3）。
 *
 * 依据方案文档 4.1 节与 PLAN 6.1：
 * - 按月 created 分桶（created:YYYY-MM-01..YYYY-MM-31, sort:created asc）逐页扫完一桶；
 *   桶内结果触顶 1000（GitHub Search 硬上限）→ 按天二分递归；
 * - 首轮全量：从当前月逐月向过去回退，连续 3 个空桶停止（无 oldestSeen 时回退到安全下限）；
 * - 增量（每次 cron）：pushed:>=上次运行时间 + 当月 created 窗口（新仓库）；
 * - 每周全量重扫 + 与注册表 diff：本次全量未再出现的 topic 仓库置 removed=true（不物理删除）；
 * - 同步进度持久化到 KV（sync-state:v2），断点续扫：预算（每次 run 最多 60 次 search 调用）
 *   或平台墙钟上限打断后，下轮 cron 从持久化进度继续；
 * - 配额保护：匿名 search 10 次/分 → 调用间 sleep ≥ 6.5s（有 token 时按 2 次/秒）；
 *   403/429 读取 x-ratelimit-remaining/reset 重试；失败降级 automation.state='degraded'。
 *
 * 元数据直用 search 结果（stars/forks/pushed_at/license/language/archived/default_branch/
 * homepage/description/created_at 全都有），不再逐仓库调 commits API。
 * 事实采集（可选增强）：每轮最多 20 个仓库 raw 拉 package.json，用 manifestSummary + deriveFacts
 * 填充 facts；未采集的仓库保持保守默认值（hasManifest=false、lifecycleScripts=[]）。
 */
import type {
  CategoryId,
  PluginFacts,
  PluginManifest,
  PluginRecord,
  PluginRegistryData,
} from "../lib/plugin-data";
import { readResponseTextLimited } from "../lib/limited-response.mjs";
import {
  categoryFromText,
  deriveFacts,
  manifestSummary,
  normalizeRepositoryPath,
  sanitizeRegistryInstallEvidence,
} from "../lib/plugin-screening.mjs";

const REGISTRY_KEY = "registry:v2";
const STATE_KEY = "sync-state:v2";
export const SEARCH_PER_PAGE = 100;
export const SEARCH_PAGE_CAP = 10;
export const BUCKET_RESULT_CAP = 1_000;
export const EMPTY_BUCKET_STOP = 3;
export const SWEEP_FLOOR = "2020-01-01";
const MAX_SPLIT_DEPTH = 10;
const FULL_SCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
const PUSHED_FIRST_RUN_WINDOW_MS = 24 * 60 * 60 * 1_000;
const INCREMENTAL_CREATED_WINDOW_MS = 48 * 60 * 60 * 1_000;
const MAX_SEARCH_CALLS_PER_RUN = 60;
const MAX_SEARCH_RETRIES = 2;
const MAX_RATE_WAIT_MS = 30_000;
const SECONDARY_BACKOFF_MS = 13_000;
const MAX_FACT_FETCHES_PER_RUN = 20;
const MAX_JSON_BYTES = 6_000_000;
const MAX_TEXT_BYTES = 140_000;

export interface PluginRegistryEnv {
  PLUGIN_REGISTRY?: KVNamespace;
  GITHUB_TOKEN?: string;
  /** 静态资源绑定：/plugins.json 全量快照的运行时读取通道 */
  ASSETS?: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
}

interface GithubRepository {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  default_branch: string;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  subscribers_count?: number;
  pushed_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  language: string | null;
  owner?: { login?: string };
  license?: { spdx_id?: string | null } | null;
}

interface GithubSearchResponse {
  total_count: number;
  items: GithubRepository[];
}

/** ISO 日期/时间区间 [start, end]（含），用于 GitHub 时间限定符。 */
export interface DateRange {
  start: string;
  end: string;
}

/** 二分扫描中的子区间（带页游标，支持断点续扫）。 */
interface PendingRange extends DateRange {
  page: number;
  collected: number;
  depth: number;
}

/** 全量扫描进度（持久化到 KV，跨 cron run 续扫）。 */
interface FullScanProgress {
  mode: "first" | "weekly";
  startedAt: string;
  /** 是否启用「连续空桶停止」：首轮 / 无 oldestSeen 时启用；周扫（受 oldestSeen 约束）不启用 */
  useEmptyStop: boolean;
  /** 待扫月份桶（新 → 旧） */
  monthQueue: DateRange[];
  /** 当前月份的二分区间栈（LIFO） */
  rangeStack: PendingRange[];
  /** 当前月份已收集结果数（跨 run 累计，用于空桶判定） */
  monthCollected: number;
  emptyStreak: number;
  collected: number;
  /** 本次全量已确认仍在 topic 的仓库 id（周扫 diff 用，跨 run 累计） */
  seen: string[];
  /** 扫描开始时 registry 中的 topic 仓库 id 快照（周扫 diff 用） */
  topicBefore: string[];
}

interface SyncState {
  version: 2;
  lastRunAt: string | null;
  lastFullScanAt: string | null;
  progress: FullScanProgress | null;
  factsCollected: string[];
}

interface RunOutcome {
  topicTotal: number | null;
  mergedThisRun: number;
  discoveredThisRun: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// 错误与预算
// ---------------------------------------------------------------------------

class BudgetExhaustedError extends Error {}

class RateLimitError extends Error {
  readonly remaining: string | null;
  readonly reset: string | null;
  constructor(message: string, remaining: string | null, reset: string | null) {
    super(message);
    this.remaining = remaining;
    this.reset = reset;
  }
}

/** 每次 cron run 的 search 调用预算；耗尽即停，进度交给下轮续扫。 */
class SearchBudget {
  remaining: number;
  constructor(limit: number) {
    this.remaining = limit;
  }
  consume() {
    if (this.remaining <= 0) throw new BudgetExhaustedError("search budget exhausted");
    this.remaining -= 1;
  }
}

// ---------------------------------------------------------------------------
// 纯分桶规划函数（供 tests/worker-bucket.test.mjs 直接 import，无网络）
// ---------------------------------------------------------------------------

function parseDateStrict(value: string | null | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00Z` : value;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? new Date(time) : null;
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 月份桶：所在自然月的 [1 号, 月末]。 */
export function monthRangeFor(date: Date): DateRange {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start: toISODate(start), end: toISODate(end) };
}

/** 上一月份桶（跨年正确）。 */
export function prevMonthRange(range: DateRange): DateRange {
  const start = parseDateStrict(range.start);
  if (!start) return range;
  return monthRangeFor(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)));
}

/**
 * 全量扫描的月份桶序列（新 → 旧）：从 now 所在月回退到 oldestSeen 所在月（含）。
 * oldestSeen 为空（首轮无数据）或早于 floor 时回退到 floor（安全下限，防止无限回退）。
 */
export function planBuckets(now: Date, oldestSeen?: string | null, floor = SWEEP_FLOOR): DateRange[] {
  const buckets: DateRange[] = [];
  const floorDate = parseDateStrict(floor) ?? new Date(0);
  const oldestDate = parseDateStrict(oldestSeen);
  const stopAt = oldestDate && oldestDate.getTime() >= floorDate.getTime() ? oldestDate : floorDate;
  const stopRange = monthRangeFor(stopAt);
  let cursor = monthRangeFor(now);
  while (cursor.start >= stopRange.start) {
    buckets.push(cursor);
    cursor = prevMonthRange(cursor);
  }
  return buckets;
}

/**
 * 区间按时间中点切分（返回 [前半, 后半]，首尾相接、与原区间覆盖一致）。
 * 单日区间无法再切分 → 返回 [range, range]，调用方应停止二分（触顶时接受溢出）。
 */
export function splitRange(range: DateRange): [DateRange, DateRange] {
  if (range.start === range.end) return [range, range];
  const start = parseDateStrict(range.start);
  const end = parseDateStrict(range.end);
  if (!start || !end) return [range, range];
  const mid = new Date(start.getTime() + Math.floor((end.getTime() - start.getTime()) / 2));
  const midDay = toISODate(mid);
  return [
    { start: range.start, end: midDay },
    { start: midDay, end: range.end },
  ];
}

/** 连续空桶停止判定：仅首轮（useEmptyStop=true）生效。 */
export function shouldStopOnEmptyStreak(
  emptyStreak: number,
  useEmptyStop: boolean,
  stopAfter = EMPTY_BUCKET_STOP,
): boolean {
  return useEmptyStop && emptyStreak >= stopAfter;
}

/**
 * 增量新仓库 created 窗口起点：max(当月 1 号, now - INCREMENTAL_CREATED_WINDOW_MS)。
 * 当月桶可能包含数千仓库（如 2026-08 有 4000+），每 30 分钟整月重扫会烧光配额，
 * 因此只补扫最近窗口；整月完整性由每周全量重扫兜底。
 */
export function incrementalCreatedStart(now: Date): string {
  const monthStart = monthRangeFor(now).start;
  const windowStart = new Date(now.getTime() - INCREMENTAL_CREATED_WINDOW_MS).toISOString();
  return windowStart < monthStart ? monthStart : windowStart;
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 去掉 ISO 时间戳的毫秒部分（GitHub 限定符更稳妥）。 */
function isoTimestamp(value: string): string {
  return value.replace(/\.\d{3}Z$/u, "Z");
}

function midpointISO(startISO: string, endISO: string): string {
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  const mid = new Date(start + Math.floor((end - start) / 2));
  return isoTimestamp(mid.toISOString());
}

function safeRepoId(fullName: string): string | null {
  try {
    return validateRepoName(fullName).toLowerCase();
  } catch {
    return null;
  }
}

/** 空注册表兜底（静态快照缺失时，保证 API 不抛错） */
function emptyRegistry(): PluginRegistryData {
  return {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
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
      curated: { url: "", repository: "", state: "snapshot", updated: "", count: 0 },
      topic: { url: "", query: "topic:dsh-plugin", state: "snapshot", total: 0, scanned: 0, matched: 0, error: null },
    },
    summary: {
      curated: 0, listed: 0, autoDiscovered: 0, topicTotal: 0,
      metadataMatches: 0, manifestMatches: 0, owners: 0, stars: 0,
    },
    categories: {} as PluginRegistryData["categories"],
    plugins: [],
  };
}

/**
 * 全量快照改为运行时从静态资源读取（/plugins.json，由 data:sync 双写），
 * 不再把 ~6MB 的 JSON 塞进打包产物（vite-plugin-commonjs 会栈溢出）。
 */
async function bundledRegistry(env: PluginRegistryEnv): Promise<PluginRegistryData> {
  try {
    const response = await env.ASSETS?.fetch(new Request("https://dsh-plugin.store/plugins.json"));
    if (response?.ok) {
      const text = await response.text();
      return sanitizeRegistryInstallEvidence(JSON.parse(text)) as PluginRegistryData;
    }
    console.error(JSON.stringify({ event: "registry.bundled.missing", status: response?.status ?? null }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "registry.bundled.read.error",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
  return emptyRegistry();
}

function githubHeaders(env: PluginRegistryEnv) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "dsh-plugin-hub-cloudflare-sync",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(env.GITHUB_TOKEN?.trim() ? { Authorization: `Bearer ${env.GITHUB_TOKEN.trim()}` } : {}),
  };
}

function validateRepoName(value: string) {
  if (!/^[a-z\d_.-]+\/[a-z\d_.-]+$/iu.test(value)) {
    throw new Error(`Invalid GitHub repository name: ${value}`);
  }
  return value;
}

async function fetchLimited(url: string, init: RequestInit, maxBytes: number) {
  const response = await fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    const suffix = remaining === "0" ? " (GitHub rate limit reached)" : "";
    if (response.status === 403 || response.status === 429) {
      throw new RateLimitError(`${response.status} ${response.statusText}: ${url}${suffix}`, remaining, reset);
    }
    throw new Error(`${response.status} ${response.statusText}: ${url}${suffix}`);
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error(`Response too large (${length} bytes): ${url}`);
  try {
    return await readResponseTextLimited(response, maxBytes);
  } catch (error) {
    if (error instanceof RangeError) throw new Error(`Response exceeded ${maxBytes} bytes: ${url}`);
    throw error;
  }
}

async function fetchJson<T>(url: string, env: PluginRegistryEnv, maxBytes = MAX_JSON_BYTES): Promise<T> {
  const text = await fetchLimited(url, { headers: githubHeaders(env) }, maxBytes);
  if (text === null) throw new Error(`404 Not Found: ${url}`);
  return JSON.parse(text) as T;
}

async function fetchRaw(repo: string, revision: string, filePath: string) {
  validateRepoName(repo);
  const safePath = normalizeRepositoryPath(filePath);
  if (!safePath) throw new Error(`Unsafe repository path: ${filePath}`);
  const encodedPath = safePath.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(revision)}/${encodedPath}`;
  return fetchLimited(url, { headers: { Accept: "text/plain" } }, MAX_TEXT_BYTES);
}

// ---------------------------------------------------------------------------
// GitHub Search（配额保护）
// ---------------------------------------------------------------------------

function searchSleepMs(env: PluginRegistryEnv): number {
  // 匿名 search 10 次/分 → 调用间 ≥6.5s；有 token（30 次/分）→ 2s（方案 4.1 按 2 次/秒）
  return env.GITHUB_TOKEN?.trim() ? 2_000 : 6_500;
}

/** 403/429 后等待多久重试：优先按 x-ratelimit-reset，重置过远则不等待（本轮放弃）。 */
function rateLimitWaitMs(error: RateLimitError): number {
  if (error.reset) {
    const resetMs = Number(error.reset) * 1000;
    if (Number.isFinite(resetMs) && resetMs > 0) {
      const wait = resetMs - Date.now() + 1_000;
      if (wait > 0 && wait <= MAX_RATE_WAIT_MS) return wait;
      return 0;
    }
  }
  // secondary rate limit（无 reset 头）→ 短退避
  return SECONDARY_BACKOFF_MS;
}

async function githubSearchPage(
  env: PluginRegistryEnv,
  query: string,
  sort: string,
  order: string,
  page: number,
  budget: SearchBudget,
  attempt = 0,
): Promise<GithubSearchResponse> {
  budget.consume();
  await sleep(searchSleepMs(env));
  const params = new URLSearchParams({
    q: query,
    sort,
    order,
    per_page: String(SEARCH_PER_PAGE),
    page: String(page),
  });
  const url = `https://api.github.com/search/repositories?${params}`;
  try {
    return await fetchJson<GithubSearchResponse>(url, env);
  } catch (error) {
    if (error instanceof RateLimitError && attempt < MAX_SEARCH_RETRIES) {
      const waitMs = rateLimitWaitMs(error);
      if (waitMs > 0) {
        await sleep(waitMs);
        return githubSearchPage(env, query, sort, order, page, budget, attempt + 1);
      }
    }
    throw error;
  }
}

function createdQualifier(start: string, end: string): string {
  return `topic:dsh-plugin created:${start}..${end}`;
}

function pushedQualifier(startISO: string, endISO: string): string {
  return `topic:dsh-plugin pushed:${isoTimestamp(startISO)}..${isoTimestamp(endISO)}`;
}

// ---------------------------------------------------------------------------
// 记录构造与合并
// ---------------------------------------------------------------------------

function defaultManifest(branch: string | null): PluginManifest {
  return {
    state: "missing",
    branch,
    kinds: [],
    packageName: null,
    version: null,
    lifecycleScripts: [],
    runtimeDependencies: 0,
    declaredPaths: [],
    invalidDeclaredPaths: [],
  };
}

/** 未采集事实的保守默认值（task 要求：hasManifest=false、lifecycleScripts=[] 等）。 */
function defaultFacts(): PluginFacts {
  return {
    hasManifest: false,
    hasLockfile: false,
    hasLicense: false,
    hasReadme: false,
    lifecycleScripts: [],
  };
}

function maintenanceState(meta: GithubRepository) {
  if (meta.archived) return "archived" as const;
  const pushed = meta.pushed_at ? Date.parse(meta.pushed_at) : Number.NaN;
  if (!Number.isFinite(pushed)) return "unknown" as const;
  const days = Math.max(0, Math.floor((Date.now() - pushed) / 86_400_000));
  if (days <= 30) return "active" as const;
  if (days <= 180) return "warm" as const;
  return "quiet" as const;
}

/** 由 search 结果元数据直接构造 PluginRecord（无 commits API、无 screening）。 */
function recordFromMeta(
  meta: GithubRepository,
  previous: PluginRecord | undefined,
  now: string,
  fetched: { manifest: PluginManifest; facts: PluginFacts } | null,
): PluginRecord {
  const curated = previous?.curated === true;
  const [fallbackOwner, fallbackName] = meta.full_name.split("/");
  const description = meta.description?.trim() || meta.name || fallbackName;
  const category = previous?.category || (categoryFromText(`${meta.name} ${description}`) as CategoryId);
  const firstSeenAt = previous?.discovery?.firstSeenAt || now.slice(0, 10);
  return {
    id: meta.full_name.toLowerCase(),
    order: previous?.order ?? Number.MAX_SAFE_INTEGER,
    name: previous?.name || meta.name || fallbackName,
    owner: previous?.owner || meta.owner?.login || fallbackOwner,
    repo: meta.full_name,
    url: `https://github.com/${meta.full_name}`,
    category,
    description: previous?.description || { zh: description, en: description },
    added: previous?.added || now.slice(0, 10),
    curated,
    topic: true,
    stars: meta.stargazers_count ?? previous?.stars ?? null,
    forks: meta.forks_count ?? previous?.forks ?? null,
    openIssues: meta.open_issues_count ?? previous?.openIssues ?? null,
    watchers: meta.subscribers_count ?? meta.watchers_count ?? previous?.watchers ?? null,
    pushedAt: meta.pushed_at ?? previous?.pushedAt ?? null,
    updatedAt: meta.updated_at ?? previous?.updatedAt ?? null,
    createdAt: meta.created_at ?? previous?.createdAt ?? null,
    license: meta.license?.spdx_id && meta.license.spdx_id !== "NOASSERTION" ? meta.license.spdx_id : null,
    language: meta.language ?? previous?.language ?? null,
    homepage: meta.homepage || previous?.homepage || null,
    archived: Boolean(meta.archived),
    defaultBranch: meta.default_branch || previous?.defaultBranch || null,
    maintenance: maintenanceState(meta),
    manifest: fetched?.manifest ?? previous?.manifest ?? defaultManifest(meta.default_branch),
    facts: fetched?.facts ?? previous?.facts ?? defaultFacts(),
    discovery: {
      source: curated ? "curated" as const : "topic" as const,
      firstSeenAt,
      lastSeenAt: now,
    },
  } satisfies PluginRecord;
}

/** 把 search 结果合并进工作副本（upsert，去重按 repo id）。 */
function mergeRepos(
  previousById: Map<string, PluginRecord>,
  items: GithubRepository[],
  now: string,
): { merged: number; discovered: number } {
  let merged = 0;
  let discovered = 0;
  for (const item of items) {
    if (!item?.full_name) continue;
    const id = safeRepoId(item.full_name);
    if (!id) continue;
    const previous = previousById.get(id);
    const record = recordFromMeta(item, previous, now, null);
    previousById.set(id, record);
    merged += 1;
    if (!previous) discovered += 1;
  }
  return { merged, discovered };
}

// ---------------------------------------------------------------------------
// 增量扫描（每次 cron）：pushed 变更 + 当月 created 窗口 + topic 计数
// ---------------------------------------------------------------------------

/** pushed 区间扫描：触顶 1000 时按时间中点二分（深度受限），预算耗尽返回已收集部分。 */
async function sweepPushed(
  env: PluginRegistryEnv,
  budget: SearchBudget,
  startISO: string,
  endISO: string,
): Promise<{ items: GithubRepository[]; truncated: boolean }> {
  const items: GithubRepository[] = [];
  const stack: PendingRange[] = [{ start: startISO, end: endISO, page: 1, collected: 0, depth: 0 }];
  let truncated = false;
  while (stack.length > 0 && !truncated) {
    const top = stack[stack.length - 1];
    let response: GithubSearchResponse;
    try {
      response = await githubSearchPage(env, pushedQualifier(top.start, top.end), "updated", "desc", top.page, budget);
    } catch (error) {
      if (error instanceof BudgetExhaustedError) {
        truncated = true;
        break;
      }
      throw error;
    }
    const pageItems = response.items || [];
    items.push(...pageItems);
    top.collected += pageItems.length;
    const finished = pageItems.length < SEARCH_PER_PAGE || top.page >= SEARCH_PAGE_CAP;
    if (finished) {
      stack.pop();
      const atCap = top.collected >= BUCKET_RESULT_CAP;
      if (atCap && top.start !== top.end && top.depth < MAX_SPLIT_DEPTH) {
        const mid = midpointISO(top.start, top.end);
        if (mid !== top.start && mid !== top.end) {
          stack.push({ start: mid, end: top.end, page: 1, collected: 0, depth: top.depth + 1 });
          stack.push({ start: top.start, end: mid, page: 1, collected: 0, depth: top.depth + 1 });
        }
      }
    } else {
      top.page += 1;
    }
  }
  return { items, truncated };
}

/** 当月 created 窗口（新仓库）扫描：created:>=windowStart，翻页到桶空。 */
async function searchCreatedSince(env: PluginRegistryEnv, budget: SearchBudget, sinceISO: string): Promise<GithubRepository[]> {
  const items: GithubRepository[] = [];
  const query = `topic:dsh-plugin created:>=${isoTimestamp(sinceISO)}`;
  for (let page = 1; page <= SEARCH_PAGE_CAP; page += 1) {
    const response = await githubSearchPage(env, query, "created", "asc", page, budget);
    const pageItems = response.items || [];
    items.push(...pageItems);
    if (pageItems.length < SEARCH_PER_PAGE) break;
  }
  return items;
}

async function runIncremental(
  registry: PluginRegistryData,
  state: SyncState,
  env: PluginRegistryEnv,
  now: string,
  previousById: Map<string, PluginRecord>,
): Promise<RunOutcome> {
  const budget = new SearchBudget(MAX_SEARCH_CALLS_PER_RUN);
  const errors: string[] = [];
  let mergedThisRun = 0;
  let discoveredThisRun = 0;
  let topicTotal: number | null = null;

  // 1. topic 计数 + 最新更新前 100 的元数据刷新（1 次调用）
  try {
    const pageOne = await githubSearchPage(env, "topic:dsh-plugin", "updated", "desc", 1, budget);
    topicTotal = pageOne.total_count;
    const merged = mergeRepos(previousById, pageOne.items || [], now);
    mergedThisRun += merged.merged;
    discoveredThisRun += merged.discovered;
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) errors.push(`topic count: ${messageOf(error)}`);
  }

  // 2. pushed:>=上次运行时间 → now（捕获所有变更）
  const sinceISO = state.lastRunAt ?? new Date(Date.now() - PUSHED_FIRST_RUN_WINDOW_MS).toISOString();
  if (sinceISO < now) {
    try {
      const { items, truncated } = await sweepPushed(env, budget, sinceISO, now);
      const merged = mergeRepos(previousById, items, now);
      mergedThisRun += merged.merged;
      discoveredThisRun += merged.discovered;
      if (truncated) errors.push("pushed sweep truncated (window >= 1000 repos)");
    } catch (error) {
      if (!(error instanceof BudgetExhaustedError)) errors.push(`pushed sweep: ${messageOf(error)}`);
    }
  }

  // 3. 当月 created 窗口（新仓库）
  const createdSince = incrementalCreatedStart(new Date(now));
  try {
    const items = await searchCreatedSince(env, budget, createdSince);
    const merged = mergeRepos(previousById, items, now);
    mergedThisRun += merged.merged;
    discoveredThisRun += merged.discovered;
    if (items.length >= BUCKET_RESULT_CAP) errors.push("created window truncated (>= 1000 repos)");
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) errors.push(`created sweep: ${messageOf(error)}`);
  }

  return { topicTotal, mergedThisRun, discoveredThisRun, errors };
}

// ---------------------------------------------------------------------------
// 全量分桶扫描（首轮 / 每周），带断点续扫
// ---------------------------------------------------------------------------

function oldestCreatedAt(registry: PluginRegistryData): string | null {
  let oldest: string | null = null;
  for (const plugin of registry.plugins) {
    if (!plugin.createdAt) continue;
    if (!oldest || plugin.createdAt < oldest) oldest = plugin.createdAt;
  }
  return oldest;
}

async function runFullScan(
  registry: PluginRegistryData,
  state: SyncState,
  env: PluginRegistryEnv,
  now: string,
  previousById: Map<string, PluginRecord>,
): Promise<RunOutcome> {
  const budget = new SearchBudget(MAX_SEARCH_CALLS_PER_RUN);
  const errors: string[] = [];
  let progress = state.progress;
  if (!progress) {
    const oldest = oldestCreatedAt(registry);
    progress = {
      mode: state.lastFullScanAt ? "weekly" : "first",
      startedAt: now,
      useEmptyStop: !state.lastFullScanAt || !oldest,
      monthQueue: planBuckets(new Date(now), oldest),
      rangeStack: [],
      monthCollected: 0,
      emptyStreak: 0,
      collected: 0,
      seen: [],
      topicBefore: registry.plugins.filter((p) => p.topic && !p.removed).map((p) => p.id),
    };
    const firstMonth = progress.monthQueue.shift();
    if (firstMonth) progress.rangeStack.push({ ...firstMonth, page: 1, collected: 0, depth: 0 });
    state.progress = progress;
  }
  const seenSet = new Set(progress.seen);
  let mergedThisRun = 0;
  let discoveredThisRun = 0;
  let topicTotal: number | null = null;

  // 0. topic 计数 + 最新更新前 100 的元数据刷新（1 次调用）
  try {
    const pageOne = await githubSearchPage(env, "topic:dsh-plugin", "updated", "desc", 1, budget);
    topicTotal = pageOne.total_count;
    const merged = mergeRepos(previousById, pageOne.items || [], now);
    mergedThisRun += merged.merged;
    discoveredThisRun += merged.discovered;
    for (const item of pageOne.items || []) {
      const id = safeRepoId(item?.full_name || "");
      if (id) seenSet.add(id);
    }
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) errors.push(`topic count: ${messageOf(error)}`);
  }

  let complete = false;
  while (budget.remaining > 0 && !complete) {
    if (progress.rangeStack.length === 0) {
      // 完成一个月份桶 → 更新连续空桶计数
      if (progress.monthCollected === 0) progress.emptyStreak += 1;
      else progress.emptyStreak = 0;
      progress.monthCollected = 0;
      if (shouldStopOnEmptyStreak(progress.emptyStreak, progress.useEmptyStop)) {
        complete = true;
        break;
      }
      const nextMonth = progress.monthQueue.shift();
      if (!nextMonth) {
        complete = true;
        break;
      }
      progress.rangeStack.push({ ...nextMonth, page: 1, collected: 0, depth: 0 });
      continue;
    }

    const top = progress.rangeStack[progress.rangeStack.length - 1];
    try {
      const response = await githubSearchPage(
        env,
        createdQualifier(top.start, top.end),
        "created",
        "asc",
        top.page,
        budget,
      );
      const items = response.items || [];
      const merged = mergeRepos(previousById, items, now);
      mergedThisRun += merged.merged;
      discoveredThisRun += merged.discovered;
      for (const item of items) {
        const id = safeRepoId(item?.full_name || "");
        if (id) seenSet.add(id);
      }
      top.collected += items.length;
      progress.monthCollected += items.length;
      progress.collected += items.length;

      const pageCount = items.length;
      const atCap = top.collected >= BUCKET_RESULT_CAP;
      const finished = pageCount < SEARCH_PER_PAGE || top.page >= SEARCH_PAGE_CAP;
      if (finished) {
        progress.rangeStack.pop();
        if (atCap && top.start !== top.end && top.depth < MAX_SPLIT_DEPTH) {
          const [first, second] = splitRange({ start: top.start, end: top.end });
          progress.rangeStack.push({ ...second, page: 1, collected: 0, depth: top.depth + 1 });
          progress.rangeStack.push({ ...first, page: 1, collected: 0, depth: top.depth + 1 });
        }
      } else {
        top.page += 1;
      }

      // 每页持久化进度：run 被墙钟/预算打断后，下轮从精确页游标续扫
      // （env.PLUGIN_REGISTRY 由 syncPluginRegistry 入口守卫保证存在）
      progress.seen = [...seenSet];
      await env.PLUGIN_REGISTRY!.put(STATE_KEY, JSON.stringify(state));
    } catch (error) {
      if (error instanceof BudgetExhaustedError) break;
      errors.push(`${top.start}..${top.end} page ${top.page}: ${messageOf(error)}`);
      // 失败区间移到栈底，本轮稍后或下轮重试（不丢进度）
      progress.rangeStack.pop();
      progress.rangeStack.unshift(top);
    }
  }

  if (complete) {
    // 周扫 diff：本次全量未再出现的 topic 仓库 → removed=true（不物理删除）
    if (progress.mode === "weekly") {
      const seenFinal = new Set(progress.seen);
      for (const id of progress.topicBefore) {
        const plugin = previousById.get(id);
        if (plugin && !seenFinal.has(id)) {
          plugin.removed = true;
          plugin.discovery.lastSeenAt = now;
        }
      }
    }
    state.progress = null;
    state.lastFullScanAt = now;
  }

  return { topicTotal, mergedThisRun, discoveredThisRun, errors };
}

// ---------------------------------------------------------------------------
// 事实采集（可选增强）：每轮最多 20 个仓库 raw 拉 package.json
// ---------------------------------------------------------------------------

async function collectFacts(
  previousById: Map<string, PluginRecord>,
  state: SyncState,
): Promise<string[]> {
  const errors: string[] = [];
  const collected = new Set(state.factsCollected);
  let attempts = MAX_FACT_FETCHES_PER_RUN;
  for (const plugin of previousById.values()) {
    if (attempts <= 0) break;
    if (plugin.removed || collected.has(plugin.id)) continue;
    attempts -= 1;
    const branch = plugin.defaultBranch || plugin.manifest?.branch || "main";
    try {
      const text = await fetchRaw(plugin.repo, branch, "package.json");
      if (text) {
        let pkg: unknown;
        try {
          pkg = JSON.parse(text);
        } catch {
          // invalid JSON → 视为无有效 package.json
        }
        if (pkg && typeof pkg === "object" && !Array.isArray(pkg)) {
          const manifest = manifestSummary(pkg, branch) as PluginManifest;
          plugin.manifest = manifest;
          plugin.facts = deriveFacts(manifest, { license: plugin.license, files: ["package.json"] }) as PluginFacts;
        }
      }
      collected.add(plugin.id);
    } catch (error) {
      // 网络错误下轮重试（不标记完成）
      errors.push(`facts ${plugin.repo}: ${messageOf(error)}`);
    }
  }
  state.factsCollected = [...collected];
  return errors;
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

function summarize(registry: PluginRegistryData) {
  const plugins = registry.plugins;
  const active = plugins.filter((plugin) => !plugin.removed);
  registry.summary = {
    curated: plugins.filter((plugin) => plugin.curated).length,
    listed: plugins.length,
    autoDiscovered: active.filter((plugin) => !plugin.curated).length,
    topicTotal: registry.sources.topic.total,
    metadataMatches: active.filter((plugin) => plugin.topic).length,
    manifestMatches: active.filter((plugin) => plugin.manifest.state === "verified").length,
    owners: new Set(active.map((plugin) => plugin.owner.toLowerCase())).size,
    stars: active.reduce((sum, plugin) => sum + (plugin.stars || 0), 0),
  };
  registry.sources.topic.scanned = registry.summary.metadataMatches;
  registry.sources.topic.matched = registry.summary.metadataMatches;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

export async function readPluginRegistry(env: PluginRegistryEnv): Promise<PluginRegistryData> {
  if (!env.PLUGIN_REGISTRY) return bundledRegistry(env);
  try {
    const stored = await env.PLUGIN_REGISTRY.get<PluginRegistryData>(REGISTRY_KEY, "json");
    return stored ? sanitizeRegistryInstallEvidence(stored) as PluginRegistryData : bundledRegistry(env);
  } catch (error) {
    console.error(JSON.stringify({
      event: "registry.read.error",
      error: error instanceof Error ? error.message : String(error),
    }));
    return bundledRegistry(env);
  }
}

export async function syncPluginRegistry(env: PluginRegistryEnv) {
  if (!env.PLUGIN_REGISTRY) {
    console.warn(JSON.stringify({ event: "registry.sync.skipped", reason: "PLUGIN_REGISTRY binding missing" }));
    return null;
  }

  const now = new Date().toISOString();
  const registry = await readPluginRegistry(env);
  const state: SyncState = await env.PLUGIN_REGISTRY.get<SyncState>(STATE_KEY, "json") || {
    version: 2,
    lastRunAt: null,
    lastFullScanAt: null,
    progress: null,
    factsCollected: [],
  };
  const previousById = new Map(registry.plugins.map((plugin) => [plugin.id, plugin]));
  const errors: string[] = [];
  let mergedThisRun = 0;
  let discoveredThisRun = 0;
  let topicTotal: number | null = null;

  const weeklyDue = !state.lastFullScanAt
    || Date.parse(now) - Date.parse(state.lastFullScanAt) >= FULL_SCAN_INTERVAL_MS;
  const mode: "full" | "incremental" = state.progress || weeklyDue ? "full" : "incremental";

  try {
    const outcome = mode === "full"
      ? await runFullScan(registry, state, env, now, previousById)
      : await runIncremental(registry, state, env, now, previousById);
    errors.push(...outcome.errors);
    topicTotal = outcome.topicTotal;
    mergedThisRun = outcome.mergedThisRun;
    discoveredThisRun = outcome.discoveredThisRun;
  } catch (error) {
    // 整体降级（保留现有机制）
    const message = messageOf(error);
    registry.automation = { ...registry.automation, state: "degraded", lastRunAt: now, error: message };
    await env.PLUGIN_REGISTRY.put(REGISTRY_KEY, JSON.stringify(registry));
    console.error(JSON.stringify({ event: "registry.sync.error", stage: "scan", error: message }));
    return registry;
  }

  // 事实采集（raw 拉 package.json，不计 search 配额；失败计入 errors → 降级）
  try {
    errors.push(...await collectFacts(previousById, state));
  } catch (error) {
    errors.push(`facts: ${messageOf(error)}`);
  }

  const plugins = [...previousById.values()].sort((a, b) => {
    if (a.curated !== b.curated) return a.curated ? -1 : 1;
    if (a.curated) return a.order - b.order;
    return b.discovery.firstSeenAt.localeCompare(a.discovery.firstSeenAt) || a.name.localeCompare(b.name);
  });
  plugins.forEach((plugin, index) => { plugin.order = index; });
  registry.plugins = plugins;
  registry.schemaVersion = 2;
  registry.generatedAt = now;
  registry.sources.topic = {
    ...registry.sources.topic,
    state: errors.length ? "partial" : "live",
    total: topicTotal ?? registry.sources.topic.total,
    error: errors.length ? errors.slice(0, 3).join(" | ") : null,
  };
  registry.automation = {
    enabled: true,
    schedule: "*/30 * * * *",
    state: errors.length ? "degraded" : "live",
    scanVersion: 2,
    lastRunAt: now,
    lastSuccessfulRunAt: errors.length ? registry.automation?.lastSuccessfulRunAt || null : now,
    checkedThisRun: mergedThisRun,
    discoveredThisRun,
    admittedThisRun: discoveredThisRun,
    rejectedTotal: 0,
    error: errors.length ? errors.slice(0, 3).join(" | ") : null,
  };
  summarize(registry);

  state.lastRunAt = now;
  await env.PLUGIN_REGISTRY.put(REGISTRY_KEY, JSON.stringify(registry));
  await env.PLUGIN_REGISTRY.put(STATE_KEY, JSON.stringify(state));
  console.log(JSON.stringify({
    event: "registry.sync.complete",
    mode,
    checked: mergedThisRun,
    discovered: discoveredThisRun,
    listed: registry.summary.listed,
    errors: errors.length,
  }));
  return registry;
}

export function pluginRegistryResponse(registry: PluginRegistryData) {
  return Response.json(registry, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
      "X-Registry-Source": registry.automation?.state === "live" ? "cloudflare-kv" : "bundled-fallback",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

