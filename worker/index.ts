/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  pluginRegistryResponse,
  readPluginRegistry,
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
// /api/plugins：D1 惰性同步 + 服务端分页查询（P1-T5）
// 依据方案文档 4.2 / PLAN 6.2：KV 全量 JSON → D1 行存储，查询走 SQL。
// 数据链路：读 KV registry（readPluginRegistry）→ 与 registry_meta 中的
// generatedAt 比对，不一致则批量 upsert（100 条/批）→ D1 分页查询。
// D1 绑定缺失或未就绪（迁移未应用等）→ 降级到 KV 全量 JSON（pluginRegistryResponse），
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
const PLUGIN_META_KEY = "generatedAt";

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
  summary: PluginRegistryData["summary"];
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

/** 惰性同步：registry.generatedAt 与 D1 元数据不一致时全量 upsert（100 条/批）。 */
async function ensurePluginsSynced(db: D1Database, registry: PluginRegistryData): Promise<void> {
  const meta = await db
    .prepare("SELECT value FROM registry_meta WHERE key = ?")
    .bind(PLUGIN_META_KEY)
    .first<{ value: string }>();
  if (meta?.value === registry.generatedAt) return;

  const plugins = registry.plugins ?? [];
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
  for (let i = 0; i < plugins.length; i += PLUGIN_SYNC_BATCH_SIZE) {
    const chunk = plugins.slice(i, i + PLUGIN_SYNC_BATCH_SIZE);
    const statements = chunk.map((plugin) => db.prepare(upsertSql).bind(
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
      plugin.updatedAt ?? plugin.pushedAt ?? plugin.added ?? registry.generatedAt,
    ));
    await db.batch(statements);
  }
  await db
    .prepare("INSERT INTO registry_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(PLUGIN_META_KEY, registry.generatedAt, new Date().toISOString())
    .run();
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
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM plugins WHERE ${whereSql}`)
    .bind(...bindings)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
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
    summary: registrySummary(registry),
  };
}

/** /api/plugins 处理器：D1 可用 → 惰性同步 + 分页；不可用 → KV 全量回退。 */
async function handlePluginsRequest(request: Request, env: Env): Promise<Response> {
  const registry = await readPluginRegistry(env);
  const d1 = env.VISIT_METRICS;
  if (!d1) {
    return pluginRegistryResponse(registry);
  }
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
  try {
    await ensurePluginsSynced(d1, registry);
    const body = await queryPluginsPage(d1, registry, query);
    return Response.json(body, { headers: pluginsApiHeaders("cloudflare-d1") });
  } catch (error) {
    console.error(JSON.stringify({
      event: "plugins.d1.error",
      error: error instanceof Error ? error.message : String(error),
    }));
    return pluginRegistryResponse(registry);
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/plugins") {
      return withSecurityHeaders(await handlePluginsRequest(request, env));
    }

    if (request.method === "GET" && url.pathname === "/api/registry/status") {
      const registry = await readPluginRegistry(env);
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
    await syncPluginRegistry(env);
  },
};

export default worker;
