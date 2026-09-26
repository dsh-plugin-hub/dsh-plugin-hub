/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  fullStaticSnapshotResponse,
  readPluginRecord,
  readPluginRegistry,
  readPluginRegistryMetadata,
  syncPluginRegistry,
} from "./plugin-registry";
import { incrementVisit, readVisitStats } from "../lib/visit-metrics.mjs";
import type {
  CategoryId,
  PluginFacts,
  PluginRecord,
  PluginRegistryData,
} from "../lib/plugin-data";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function withSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function isRootDocumentRequest(request: Request, url: URL, response: Response) {
  return request.method === "GET"
    && url.pathname === "/"
    && response.ok
    && (request.headers.get("accept") || "").toLowerCase().includes("text/html");
}

function visitStatsResponse(stats: Awaited<ReturnType<typeof readVisitStats>>) {
  return Response.json(stats, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------------
// /api/plugins：D1 预同步 + 服务端分页查询（P1-T5）
// 数据链路：读 KV 分片 registry（readPluginRegistry）→ 与 registry_meta 中的
// generatedAt 比对并由 scheduled 任务批量 upsert（100 条/批）→ D1 分页查询。
// 用户请求不再触发全量同步；D1 不可用时使用 KV/静态快照在 Worker 内分页回退，
// 用 X-Registry-Source 头区分数据来源（cloudflare-d1 / cloudflare-kv / bundled-fallback）。
// ---------------------------------------------------------------------------

const PLUGIN_CATEGORY_IDS = [
  "ui", "theme", "model", "session", "memory",
  "tools", "skill", "workflow", "notify", "dev", "market", "fun",
] as const;

const PLUGIN_SORTS = ["curated", "stars", "updated", "added", "name"] as const;

/** 排序白名单 → ORDER BY 片段（内部常量，杜绝 SQL 注入）。 */
const PLUGIN_ORDER_BY: Record<(typeof PLUGIN_SORTS)[number], string> = {
  curated: "curated DESC, stars DESC, name COLLATE NOCASE ASC",
  stars: "stars DESC, name COLLATE NOCASE ASC",
  updated: "updated_at DESC, name COLLATE NOCASE ASC",
  added: "created_at DESC, name COLLATE NOCASE ASC",
  name: "name COLLATE NOCASE ASC",
};

const PLUGIN_DEFAULT_PAGE_SIZE = 60;
const PLUGIN_MAX_PAGE_SIZE = 100;
const PLUGIN_SYNC_BATCH_SIZE = 100;
/** 单轮最多写入行数：D1 调用占 Worker 子请求配额（免费版 50/次），
 *  全量 1.4 万行 = 137 个 batch 必超限，写入到一半就断（2026-09-02 实锤：
 *  D1 卡在 11,936 行而注册表已有 13,703）。截断时下轮 cron 续写收敛。 */
const PLUGIN_SYNC_MAX_ROWS_PER_RUN = 1500;
/** 差量比对时键集分页读回现值的页大小。 */
const PLUGIN_SYNC_READ_PAGE = 2000;
const PLUGIN_META_KEY = "generatedAt";
/** 无筛选查询的 total 缓存：COUNT(*) 每次冷请求全表扫 N 行，是读额度大头。 */
const PLUGIN_TOTAL_ACTIVE_KEY = "plugins_total_active";
// D1 同步策略：内容哈希未变 → 跳过；变了 → 差量 upsert（只写变化的行），
// 全表比对最多每 6h 一次；新收录插件不受节流。不节流时每 30 分钟的 cron
// 一天会写 ~65 万行，免费版限额 10 万行/天（UTC 0 点重置），数小时内打爆。
const PLUGIN_D1_SYNC_STATE_KEY = "plugins_d1_sync_state";
const PLUGIN_D1_SYNC_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 保持公开兼容：底层静态资产和 KV 分片对外仍呈现原有完整 JSON 快照。 */
async function handleFullSnapshotRequest(env: Env, headOnly = false): Promise<Response> {
  try {
    return await fullStaticSnapshotResponse(env, headOnly);
  } catch (error) {
    console.error(JSON.stringify({
      event: "registry.public-snapshot.error",
      error: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({ error: "Snapshot temporarily unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

type RegistryPlugin = NonNullable<PluginRegistryData["plugins"]>[number];

/** D1 plugins 表行（snake_case，对应 migrations/0002_plugins.sql）。 */
interface PluginRow {
  id: string;
  name: string;
  owner: string;
  category: string;
  description_en: string | null;
  description_zh: string | null;
  stars: number | null;
  forks: number | null;
  open_issues: number | null;
  pushed_at: string | null;
  created_at: string | null;
  license: string | null;
  language: string | null;
  homepage: string | null;
  archived: number;
  curated: number;
  has_manifest: number;
  has_lockfile: number;
  has_license: number;
  has_readme: number;
  lifecycle_scripts: string | null;
  removed: number;
  updated_at: string | null;
}

interface PluginsQuery {
  q: string | null;
  category: string | null;
  sort: (typeof PLUGIN_SORTS)[number];
  page: number;
  pageSize: number;
}

interface PluginsPageResponse {
  schemaVersion: number;
  generatedAt: string | null;
  total: number;
  page: number;
  pageSize: number;
  items: PluginRecord[];
  categories: PluginRegistryData["categories"];
  sources: PluginRegistryData["sources"];
  summary: PluginRegistryData["summary"];
  automation: PluginRegistryData["automation"];
}

function pluginsApiHeaders(source: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
    "X-Registry-Source": source,
    "X-Content-Type-Options": "nosniff",
  };
}

/** LIKE 通配符转义：%/_/\ 前置反斜杠（SQL 侧配 ESCAPE '\\'）。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function parseLifecycleScripts(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function maintenanceFrom(pushedAt: string | null, archived: boolean): PluginRecord["maintenance"] {
  if (archived) return "archived";
  if (!pushedAt) return "unknown";
  const time = Date.parse(pushedAt);
  if (!Number.isFinite(time)) return "unknown";
  const days = Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
  if (days <= 30) return "active";
  if (days <= 180) return "warm";
  return "quiet";
}

/**
 * D1 行 → API 响应的 PluginRecord。
 * D1 只存事实字段，manifest 明细 / discovery / watchers / defaultBranch 等未落库，
 * 按保守默认值重建（facts 缺省即未知；manifest.state 由 has_manifest 推导）。
 */
function pluginRowToRecord(row: PluginRow): PluginRecord {
  const lifecycleScripts = parseLifecycleScripts(row.lifecycle_scripts);
  const facts: PluginFacts = {
    hasManifest: Boolean(row.has_manifest),
    hasLockfile: Boolean(row.has_lockfile),
    hasLicense: Boolean(row.has_license),
    hasReadme: Boolean(row.has_readme),
    lifecycleScripts,
  };
  const descriptionEn = row.description_en || row.name;
  const descriptionZh = row.description_zh || descriptionEn;
  const pushedAt = row.pushed_at || null;
  const createdAt = row.created_at || null;
  const updatedAt = row.updated_at || null;
  const curated = Boolean(row.curated);
  const category = (PLUGIN_CATEGORY_IDS as readonly string[]).includes(row.category)
    ? row.category as CategoryId
    : "dev" as const;
  return {
    id: row.id,
    order: 0,
    name: row.name,
    owner: row.owner,
    repo: row.id,
    url: `https://github.com/${row.id}`,
    category,
    description: { en: descriptionEn, zh: descriptionZh },
    added: createdAt ?? updatedAt,
    curated,
    topic: !curated,
    stars: row.stars ?? null,
    forks: row.forks ?? null,
    openIssues: row.open_issues ?? null,
    watchers: null,
    pushedAt,
    updatedAt,
    createdAt,
    license: row.license ?? null,
    language: row.language ?? null,
    homepage: row.homepage ?? null,
    archived: Boolean(row.archived),
    defaultBranch: null,
    maintenance: maintenanceFrom(pushedAt, Boolean(row.archived)),
    manifest: {
      state: facts.hasManifest ? "verified" : "missing",
      branch: null,
      kinds: [],
      packageName: null,
      version: null,
      lifecycleScripts,
      runtimeDependencies: 0,
      declaredPaths: [],
      invalidDeclaredPaths: [],
    },
    facts,
    discovery: {
      source: curated ? "curated" : "topic",
      firstSeenAt: createdAt ?? updatedAt ?? "",
      lastSeenAt: updatedAt ?? "",
    },
  };
}

/** 从注册表防御性提取新模型 summary 字段（旧数据可能残留 screening 三字段，直接忽略）。 */
function registrySummary(registry: PluginRegistryData): PluginRegistryData["summary"] {
  const source = registry.summary as Partial<PluginRegistryData["summary"]> | undefined;
  return {
    curated: source?.curated ?? 0,
    listed: source?.listed ?? registry.plugins?.length ?? 0,
    autoDiscovered: source?.autoDiscovered ?? 0,
    topicTotal: source?.topicTotal ?? registry.sources?.topic?.total ?? 0,
    metadataMatches: source?.metadataMatches ?? 0,
    manifestMatches: source?.manifestMatches ?? 0,
    owners: source?.owners ?? 0,
    stars: source?.stars ?? 0,
  };
}

/**
 * 计算注册表内容的稳定指纹：只有插件数据本身变化（新增/更新/移除/热度变动）
 * 才会改变哈希，generatedAt 每轮 cron 都会刷新，不能作为变更依据。
 */
async function computePluginsHash(plugins: PluginRegistryData["plugins"]): Promise<string> {
  const canonical = (plugins ?? []).map((plugin) => [
    plugin.id,
    plugin.updatedAt ?? plugin.pushedAt ?? "",
    plugin.stars ?? -1,
    plugin.forks ?? -1,
    plugin.openIssues ?? -1,
    plugin.removed ? 1 : 0,
    plugin.curated ? 1 : 0,
    plugin.order ?? -1,
  ].join("\u001f")).join("\u001e");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * upsert 绑定参数（列顺序固定）。写入与差量比对共用，避免两处映射漂移。
 * 注意 updated_at 不用 generatedAt 兜底：否则缺时间戳的行每轮都会被判为「已变更」。
 */
function pluginUpsertParams(plugin: RegistryPlugin): (string | number | null)[] {
  return [
    plugin.id,
    plugin.name,
    plugin.owner,
    plugin.category,
    plugin.description?.en ?? null,
    plugin.description?.zh ?? null,
    plugin.stars ?? null,
    plugin.forks ?? null,
    plugin.openIssues ?? null,
    plugin.pushedAt ?? null,
    plugin.createdAt ?? plugin.added ?? null,
    plugin.license ?? null,
    plugin.language ?? null,
    plugin.homepage ?? null,
    plugin.archived ? 1 : 0,
    plugin.curated ? 1 : 0,
    (plugin.facts?.hasManifest || plugin.manifest?.state === "verified") ? 1 : 0,
    plugin.facts?.hasLockfile ? 1 : 0,
    plugin.facts?.hasLicense ? 1 : 0,
    plugin.facts?.hasReadme ? 1 : 0,
    JSON.stringify(plugin.facts?.lifecycleScripts ?? []),
    plugin.removed ? 1 : 0,
    plugin.updatedAt ?? plugin.pushedAt ?? plugin.added ?? null,
  ];
}

/** D1 行 → 与 pluginUpsertParams 相同顺序的参数数组（列名取值，顺序必须一致）。 */
function pluginRowParams(row: PluginRow): (string | number | null)[] {
  return [
    row.id, row.name, row.owner, row.category,
    row.description_en, row.description_zh,
    row.stars, row.forks, row.open_issues,
    row.pushed_at, row.created_at,
    row.license, row.language, row.homepage,
    row.archived, row.curated,
    row.has_manifest, row.has_lockfile, row.has_license, row.has_readme,
    row.lifecycle_scripts, row.removed, row.updated_at,
  ];
}

/**
 * 键集分页读回 D1 全表现值 → { id: 行签名 }，供差量比对。
 * 读额度（免费版 500 万行/天）余量远大于写额度，用读换写是本方案的核心取舍。
 */
async function readExistingRowSigs(db: D1Database): Promise<Map<string, string>> {
  const sigs = new Map<string, string>();
  let cursor = "";
  for (;;) {
    const { results } = await db
      .prepare("SELECT * FROM plugins WHERE id > ? ORDER BY id LIMIT ?")
      .bind(cursor, PLUGIN_SYNC_READ_PAGE)
      .all<PluginRow>();
    const rows = results ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      sigs.set(row.id, JSON.stringify(pluginRowParams(row)));
      cursor = row.id;
    }
    if (rows.length < PLUGIN_SYNC_READ_PAGE) break;
  }
  return sigs;
}

/**
 * 定时同步（差量）：读回 D1 现值逐行比对，只 upsert 真正变化的行。
 * - 内容指纹未变且无新收录 → 跳过；全表比对最多每 6h 一次（写额度保护）。
 * - 新收录插件（firstSeenAt ≥ 水位）不受节流，每轮都写，~30 分钟内可见。
 * - 单轮写入行数有上限，截断时下轮 cron 续写收敛（子请求/额度双保护）。
 * 该操作只在 scheduled 任务中执行，绝不阻塞用户的搜索请求。
 */
async function syncPluginsToD1(db: D1Database, registry: PluginRegistryData): Promise<void> {
  const plugins = registry.plugins ?? [];
  if (plugins.length === 0) return;

  const registryHash = await computePluginsHash(plugins);
  const stateRow = await db
    .prepare("SELECT value FROM registry_meta WHERE key = ?")
    .bind(PLUGIN_D1_SYNC_STATE_KEY)
    .first<{ value: string }>();
  let state: { hash?: string; syncedAt?: string; newSince?: string } = {};
  if (stateRow?.value) {
    try {
      state = JSON.parse(stateRow.value) as typeof state;
    } catch {
      // 状态行损坏 → 走一次全量差量重建
    }
  }

  const watermark = state.newSince ?? null;
  const fresh = watermark
    ? plugins.filter((plugin) => (plugin.discovery?.firstSeenAt ?? "") >= watermark)
    : [];
  if (state.hash === registryHash && fresh.length === 0) return; // 内容与水位都没变，D1 已是最新

  const lastSync = state.syncedAt ? Date.parse(state.syncedAt) : Number.NaN;
  const dueFull = !Number.isFinite(lastSync) || Date.now() - lastSync >= PLUGIN_D1_SYNC_MIN_INTERVAL_MS;
  if (!dueFull && fresh.length === 0) {
    console.log(JSON.stringify({
      event: "plugins.d1.sync.skipped",
      reason: "throttled",
      lastSyncedAt: state.syncedAt ?? null,
    }));
    return;
  }

  const upsertSql = `INSERT INTO plugins (
      id, name, owner, category, description_en, description_zh,
      stars, forks, open_issues, pushed_at, created_at,
      license, language, homepage, archived, curated,
      has_manifest, has_lockfile, has_license, has_readme,
      lifecycle_scripts, removed, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, owner = excluded.owner, category = excluded.category,
      description_en = excluded.description_en, description_zh = excluded.description_zh,
      stars = excluded.stars, forks = excluded.forks, open_issues = excluded.open_issues,
      pushed_at = excluded.pushed_at, created_at = excluded.created_at,
      license = excluded.license, language = excluded.language, homepage = excluded.homepage,
      archived = excluded.archived, curated = excluded.curated,
      has_manifest = excluded.has_manifest, has_lockfile = excluded.has_lockfile,
      has_license = excluded.has_license, has_readme = excluded.has_readme,
      lifecycle_scripts = excluded.lifecycle_scripts, removed = excluded.removed,
      updated_at = excluded.updated_at`;
  const writeChunked = async (targets: RegistryPlugin[]): Promise<number> => {
    let written = 0;
    for (let i = 0; i < targets.length && written < PLUGIN_SYNC_MAX_ROWS_PER_RUN; i += PLUGIN_SYNC_BATCH_SIZE) {
      const chunk = targets.slice(i, i + PLUGIN_SYNC_BATCH_SIZE).slice(0, PLUGIN_SYNC_MAX_ROWS_PER_RUN - written);
      await db.batch(chunk.map((plugin) => db.prepare(upsertSql).bind(...pluginUpsertParams(plugin))));
      written += chunk.length;
    }
    return written;
  };

  let fullComplete = false;
  let targets: RegistryPlugin[];
  if (dueFull) {
    const existing = await readExistingRowSigs(db);
    const changed = plugins.filter((plugin) => existing.get(plugin.id) !== JSON.stringify(pluginUpsertParams(plugin)));
    fullComplete = changed.length <= PLUGIN_SYNC_MAX_ROWS_PER_RUN;
    targets = changed;
  } else {
    targets = fresh;
  }
  const written = await writeChunked(targets);

  // 水位推进到当前最大 firstSeenAt：下轮只挑更新收录的行（>= 含等号，重复重写最新一行可忽略不计）
  const newestFirstSeen = plugins.reduce((max, plugin) => {
    const seenAt = plugin.discovery?.firstSeenAt ?? "";
    return seenAt > max ? seenAt : max;
  }, state.newSince ?? "");
  const nowIso = new Date().toISOString();
  const metaUpsert = db
    .prepare("INSERT INTO registry_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
  await db.batch([
    metaUpsert.bind(PLUGIN_META_KEY, registry.generatedAt, nowIso),
    metaUpsert.bind(PLUGIN_D1_SYNC_STATE_KEY, JSON.stringify({
      hash: fullComplete ? registryHash : state.hash,
      syncedAt: fullComplete ? nowIso : state.syncedAt,
      newSince: newestFirstSeen || undefined,
    }), nowIso),
    metaUpsert.bind(PLUGIN_TOTAL_ACTIVE_KEY, String(plugins.reduce((n, p) => n + (p.removed ? 0 : 1), 0)), nowIso),
  ]);
  console.log(JSON.stringify({
    event: "plugins.d1.sync.complete",
    mode: dueFull ? "diff" : "fresh",
    written,
    truncated: dueFull ? !fullComplete : false,
  }));
}

/** 查询参数解析：白名单校验（sort/category），数值钳制（page/pageSize），q 转义。 */
function parsePluginsQuery(searchParams: URLSearchParams): PluginsQuery {
  const rawSort = searchParams.get("sort") ?? "curated";
  if (!(PLUGIN_SORTS as readonly string[]).includes(rawSort)) {
    throw new Error(`Unsupported sort: "${rawSort}" (expected one of ${PLUGIN_SORTS.join(", ")})`);
  }
  const category = searchParams.get("category");
  if (category && !(PLUGIN_CATEGORY_IDS as readonly string[]).includes(category)) {
    throw new Error(`Unsupported category: "${category}"`);
  }
  const rawPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
  const rawSize = Number.parseInt(searchParams.get("pageSize") ?? String(PLUGIN_DEFAULT_PAGE_SIZE), 10);
  const pageSize = Number.isFinite(rawSize)
    ? Math.min(Math.max(rawSize, 1), PLUGIN_MAX_PAGE_SIZE)
    : PLUGIN_DEFAULT_PAGE_SIZE;
  const q = (searchParams.get("q") ?? "").trim().slice(0, 200);
  return { q: q || null, category: category || null, sort: rawSort as PluginsQuery["sort"], page, pageSize };
}

/** D1 分页查询：removed 默认过滤；q 走 LIKE（四列 OR）；排序走白名单映射。 */
async function queryPluginsPage(
  db: D1Database,
  registry: PluginRegistryData,
  query: PluginsQuery,
): Promise<PluginsPageResponse> {
  const where: string[] = ["removed = 0"];
  const bindings: (string | number)[] = [];
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    where.push(
      "(name LIKE ? ESCAPE '\\' OR owner LIKE ? ESCAPE '\\' OR description_en LIKE ? ESCAPE '\\' OR description_zh LIKE ? ESCAPE '\\')",
    );
    bindings.push(pattern, pattern, pattern, pattern);
  }
  if (query.category) {
    where.push("category = ?");
    bindings.push(query.category);
  }
  const whereSql = where.join(" AND ");
  const orderBy = PLUGIN_ORDER_BY[query.sort];
  // 无筛选查询的 total 走 registry_meta 缓存（同步时由 Worker 写入）：
  // COUNT(*) 每次冷请求全表扫 N 行，是读额度大头；带筛选时必须实算。
  let total: number;
  if (!query.q && !query.category) {
    const cached = await db
      .prepare("SELECT value FROM registry_meta WHERE key = ?")
      .bind(PLUGIN_TOTAL_ACTIVE_KEY)
      .first<{ value: string }>();
    const parsed = cached?.value ? Number.parseInt(cached.value, 10) : Number.NaN;
    if (Number.isFinite(parsed)) {
      total = parsed;
    } else {
      const countRow = await db
        .prepare(`SELECT COUNT(*) AS total FROM plugins WHERE ${whereSql}`)
        .bind(...bindings)
        .first<{ total: number }>();
      total = countRow?.total ?? 0;
    }
  } else {
    const countRow = await db
      .prepare(`SELECT COUNT(*) AS total FROM plugins WHERE ${whereSql}`)
      .bind(...bindings)
      .first<{ total: number }>();
    total = countRow?.total ?? 0;
  }
  const offset = (query.page - 1) * query.pageSize;
  const { results } = await db
    .prepare(`SELECT * FROM plugins WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .bind(...bindings, query.pageSize, offset)
    .all<PluginRow>();
  const items = (results ?? []).map((row) => pluginRowToRecord(row));
  return {
    schemaVersion: registry.schemaVersion ?? 2,
    generatedAt: registry.generatedAt ?? null,
    total,
    page: query.page,
    pageSize: query.pageSize,
    items,
    categories: registry.categories ?? ({} as PluginRegistryData["categories"]),
    sources: registry.sources,
    summary: registrySummary(registry),
    // 前端据此显示巡检状态（live/degraded/bundled）
    automation: registry.automation,
  };
}

function registrySource(registry: PluginRegistryData): "cloudflare-kv" | "bundled-fallback" {
  return registry.automation?.state === "live" ? "cloudflare-kv" : "bundled-fallback";
}

/**
 * D1 不可用时的内存分页回退。
 * 重要的是返回与 D1 相同的分页契约，而不是把十几 MB 的全量注册表直接返回给浏览器。
 */
function queryRegistryPage(
  registry: PluginRegistryData,
  query: PluginsQuery,
): PluginsPageResponse {
  const normalizedQuery = query.q?.toLocaleLowerCase() ?? "";
  const filtered = (registry.plugins ?? [])
    .filter((plugin) => plugin.removed !== true)
    .filter((plugin) => !query.category || plugin.category === query.category)
    .filter((plugin) => {
      if (!normalizedQuery) return true;
      return [
        plugin.name,
        plugin.owner,
        plugin.description?.en,
        plugin.description?.zh,
      ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    });

  filtered.sort((left, right) => {
    if (query.sort === "curated" && left.curated !== right.curated) {
      return left.curated ? -1 : 1;
    }
    if (query.sort === "curated" || query.sort === "stars") {
      const stars = (right.stars ?? -Infinity) - (left.stars ?? -Infinity);
      if (stars !== 0) return stars;
    }
    if (query.sort === "updated") {
      const updated = (Date.parse(right.updatedAt || "") || -Infinity)
        - (Date.parse(left.updatedAt || "") || -Infinity);
      if (updated !== 0) return updated;
    }
    if (query.sort === "added") {
      const added = (Date.parse(right.createdAt || right.added || "") || -Infinity)
        - (Date.parse(left.createdAt || left.added || "") || -Infinity);
      if (added !== 0) return added;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });

  const offset = (query.page - 1) * query.pageSize;
  return {
    schemaVersion: registry.schemaVersion ?? 2,
    generatedAt: registry.generatedAt ?? null,
    total: filtered.length,
    page: query.page,
    pageSize: query.pageSize,
    items: filtered.slice(offset, offset + query.pageSize),
    categories: registry.categories ?? ({} as PluginRegistryData["categories"]),
    sources: registry.sources,
    summary: registrySummary(registry),
    automation: registry.automation,
  };
}

/** /api/plugins 处理器：D1 查询不再触发同步；不可用时使用分页回退。 */
async function handlePluginsRequest(request: Request, env: Env): Promise<Response> {
  let query: PluginsQuery;
  try {
    query = parsePluginsQuery(new URL(request.url).searchParams);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      {
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const d1 = env.VISIT_METRICS;
  if (!d1) {
    const registry = await readPluginRegistry(env);
    return Response.json(queryRegistryPage(registry, query), {
      headers: pluginsApiHeaders(registrySource(registry)),
    });
  }

  // A small manifest supplies response metadata; load all shards only on fallback.
  const { registry } = await readPluginRegistryMetadata(env);
  try {
    const body = await queryPluginsPage(d1, registry, query);

    // 定时同步尚未完成时，D1 可能暂时为空。只在 D1 没有命中时使用快照回退，
    // 既避免首轮部署显示空目录，也不会把全量快照发到浏览器。
    if (body.total === 0) {
      const fallback = await readPluginRegistry(env);
      if (fallback.plugins.length > 0) {
        return Response.json(queryRegistryPage(fallback, query), {
          headers: pluginsApiHeaders(registrySource(fallback)),
        });
      }
    }

    return Response.json(body, { headers: pluginsApiHeaders("cloudflare-d1") });
  } catch (error) {
    console.error(JSON.stringify({
      event: "plugins.d1.error",
      error: error instanceof Error ? error.message : String(error),
    }));
    const fallback = await readPluginRegistry(env);
    return Response.json(queryRegistryPage(fallback, query), {
      headers: pluginsApiHeaders(registrySource(fallback)),
    });
  }
}

/** /api/plugins/:owner/:repo loads only the stable ID-assigned registry shard. */
async function handlePluginDetailRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/api\/plugins\/([^/]+)\/([^/]+)\/?$/u.exec(url.pathname);
  if (!match) {
    return Response.json({ error: "Invalid plugin detail path" }, {
      status: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    });
  }

  let owner: string;
  let repo: string;
  try {
    owner = decodeURIComponent(match[1]);
    repo = decodeURIComponent(match[2]);
  } catch {
    return Response.json({ error: "Invalid plugin detail path" }, {
      status: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    });
  }

  const id = `${owner}/${repo}`.toLowerCase();
  const { registry, plugin, source } = await readPluginRecord(env, id);
  if (!plugin) {
    return Response.json({ error: "Plugin not found" }, {
      status: 404,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return Response.json({
    plugin,
    categories: registry.categories,
    generatedAt: registry.generatedAt,
  }, {
    headers: pluginsApiHeaders(source),
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/plugins.json") {
      return withSecurityHeaders(await handleFullSnapshotRequest(env, request.method === "HEAD"));
    }

    if (request.method === "GET" && url.pathname === "/api/plugins") {
      return withSecurityHeaders(await handlePluginsRequest(request, env));
    }

    if (request.method === "GET" && /^\/api\/plugins\/[^/]+\/[^/]+\/?$/u.test(url.pathname)) {
      return withSecurityHeaders(await handlePluginDetailRequest(request, env));
    }

    if (request.method === "GET" && url.pathname === "/api/registry/status") {
      const { registry } = await readPluginRegistryMetadata(env);
      return withSecurityHeaders(Response.json({
        generatedAt: registry.generatedAt,
        automation: registry.automation,
        summary: {
          listed: registry.summary.listed,
          autoDiscovered: registry.summary.autoDiscovered,
        },
      }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } }));
    }

    if (request.method === "GET" && url.pathname === "/api/visits") {
      try {
        return withSecurityHeaders(visitStatsResponse(await readVisitStats(env)));
      } catch (error) {
        console.error(JSON.stringify({
          event: "visits.read.error",
          error: error instanceof Error ? error.message : String(error),
        }));
        return withSecurityHeaders(Response.json({ error: "Visit metrics unavailable" }, {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        }));
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return withSecurityHeaders(await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths));
    }

    const response = await handler.fetch(request, env, ctx);
    if (env.VISIT_METRICS && isRootDocumentRequest(request, url, response)) {
      ctx.waitUntil(incrementVisit(env).catch((error) => {
        console.error(JSON.stringify({
          event: "visits.increment.error",
          error: error instanceof Error ? error.message : String(error),
        }));
      }));
    }
    return withSecurityHeaders(response);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const registry = await syncPluginRegistry(env);
    if (!registry || !env.VISIT_METRICS) return;
    try {
      await syncPluginsToD1(env.VISIT_METRICS, registry);
      console.log(JSON.stringify({
        event: "plugins.d1.sync.complete",
        generatedAt: registry.generatedAt,
        listed: registry.summary.listed,
      }));
    } catch (error) {
      // D1 同步失败不应阻塞下一轮 KV/registry 巡检；搜索会使用分页快照回退。
      console.error(JSON.stringify({
        event: "plugins.d1.sync.error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  },
};

export default worker;
