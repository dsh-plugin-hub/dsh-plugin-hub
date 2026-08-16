/**
 * SEO 工件生成器：sitemap.xml / llms.txt / indexnow-urls.txt。
 *
 * 由 scripts/sync-plugins.mjs 在每次 data:sync 时调用（本地与 CI 共用），
 * 因此站点地图与索引推送清单随插件数据一起刷新：
 *  - sitemap.xml      搜索引擎全量抓取入口（首页 + 插件详情页）
 *  - llms.txt        AI 大模型友好入口（llmstxt.org 规范）
 *  - indexnow-urls.txt  部署后由 scripts/indexnow-ping.mjs 推送 IndexNow（Bing/Seznam/Naver/Yep）
 *
 * 详情页路由 /p/[owner]/[repo] 以仓库中 app/p 目录是否存在为准：
 * 未部署时自动降级（sitemap 只收录首页），避免大量 404。
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SITE_URL = "https://dsh-plugin.store";
export const SITE_HOST = "dsh-plugin.store";
export const SITE_NAME = "dsh-plugin";
export const SITE_TAGLINE = "DeepSeek Harness 插件目录";

/**
 * IndexNow 密钥：公开设计（密钥文件必须能在站点根路径公开访问），
 * 与 public/<key>.txt 文件名、scripts/indexnow-ping.mjs 保持一致。
 */
export const INDEXNOW_KEY = "4f8a2c6e1b9d3f7a5c0e8b2d4f6a9c1e3";

export const SITEMAP_LIMIT_URLS = 50_000; // sitemap 协议硬上限
export const INDEXNOW_LIMIT_URLS = 500; // 每次推送 URL 数（协议上限 10k，保守取 500）

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const publicDir = path.join(root, "public");

/** 详情页路由是否已部署：以仓库中 app/p 目录为准（CI 检出内容即部署内容）。 */
export function hasPluginDetailRoutes() {
  return existsSync(path.join(root, "app", "p"));
}

export function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

/** 插件详情页相对路径，按数据 id（owner/repo）生成。 */
export function pluginPath(plugin) {
  return "/p/" + String(plugin.id || "");
}

/** sitemap 的 lastmod：优先真实更新时间，缺失则用快照日期。 */
function lastmodOf(plugin, generatedAt) {
  const source = plugin.pushedAt || plugin.updatedAt || plugin.discovery?.lastSeenAt || generatedAt;
  const date = String(source || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : generatedAt.slice(0, 10);
}

/** 生成 sitemap.xml 全文（string）。 */
export function buildSitemapXml({ plugins, generatedAt, detailRoutes }) {
  const lastmod = generatedAt.slice(0, 10);
  const urls = [{
    loc: SITE_URL + "/",
    lastmod,
    changefreq: "daily",
    priority: "1.0",
  }];
  if (detailRoutes) {
    for (const plugin of plugins) {
      if (!plugin || plugin.removed) continue;
      if (urls.length >= SITEMAP_LIMIT_URLS) break;
      urls.push({
        loc: SITE_URL + pluginPath(plugin),
        lastmod: lastmodOf(plugin, generatedAt),
        changefreq: "weekly",
        priority: "0.6",
      });
    }
  }
  const body = urls
    .map((entry) =>
      "  <url>\n" +
      "    <loc>" + xmlEscape(entry.loc) + "</loc>\n" +
      "    <lastmod>" + entry.lastmod + "</lastmod>\n" +
      "    <changefreq>" + entry.changefreq + "</changefreq>\n" +
      "    <priority>" + entry.priority + "</priority>\n" +
      "  </url>",
    )
    .join("\n");
  return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
    "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n" +
    body + "\n</urlset>\n";
}

/** 生成 llms.txt（llmstxt.org 规范，面向 AI 抓取器）。 */
export function buildLlmsTxt({ plugins, generatedAt, summary, categories, detailRoutes }) {
  const lines = [];
  lines.push("# " + SITE_NAME + " — " + SITE_TAGLINE);
  lines.push("");
  lines.push("> " + SITE_NAME + " 是 DeepSeek Harness（DSH）的社区插件目录，基于 GitHub 真实数据索引。");
  lines.push("> 收录 " + (summary?.listed ?? 0) + " 个插件（" + (summary?.curated ?? 0) + " 个精选），累计 " + (summary?.stars ?? 0) + " 星。");
  lines.push("> 数据快照：" + generatedAt + "；更新频率：每次部署重建 + 每 30 分钟边缘增量同步。");
  lines.push("");
  lines.push("## 入口");
  lines.push("");
  lines.push("- [插件目录](" + SITE_URL + "/): 全部插件、分类筛选、榜单与增长曲线");
  if (detailRoutes) {
    lines.push("- [插件详情页](" + SITE_URL + "/p/deepseek-ai/deepseek-harness): 示例（manifest、维护信号、README）");
  }
  lines.push("- [数据 API](" + SITE_URL + "/api/plugins): 全量插件 JSON API（分页）");
  lines.push("- [完整数据快照](" + SITE_URL + "/plugins.json): 全量注册表 JSON");
  lines.push("");
  lines.push("## 分类");
  lines.push("");
  for (const [id, labels] of Object.entries(categories ?? {})) {
    lines.push("- " + labels.zh + "（" + labels.en + "）: " + id);
  }
  lines.push("");
  lines.push("## 星标插件 Top 50");
  lines.push("");
  const top = plugins
    .filter((plugin) => plugin && !plugin.removed && plugin.stars !== null)
    .sort((a, b) => (b.stars || 0) - (a.stars || 0))
    .slice(0, 50);
  for (const plugin of top) {
    const description = String(plugin.description?.zh || plugin.description?.en || "").replaceAll("\n", " ");
    const url = detailRoutes ? SITE_URL + pluginPath(plugin) : plugin.url;
    lines.push("- [" + plugin.name + "](" + url + ")（" + plugin.stars + "★, " + plugin.owner + "）: " + description);
  }
  lines.push("");
  return lines.join("\n") + "\n";
}

/** 生成 IndexNow 推送清单（首页 + 星标插件详情页）。 */
export function buildIndexNowUrls({ plugins, detailRoutes }) {
  const urls = [SITE_URL + "/"];
  if (detailRoutes) {
    const top = plugins
      .filter((plugin) => plugin && !plugin.removed)
      .sort((a, b) => (b.stars || 0) - (a.stars || 0))
      .slice(0, INDEXNOW_LIMIT_URLS);
    for (const plugin of top) urls.push(SITE_URL + pluginPath(plugin));
  }
  return urls;
}

/** 写入全部 SEO 工件到 public/。 */
export async function writeSeoArtifacts({ plugins, generatedAt, summary, categories, detailRoutes }) {
  await mkdir(publicDir, { recursive: true });
  const detail = detailRoutes ?? hasPluginDetailRoutes();
  const sitemap = buildSitemapXml({ plugins, generatedAt, detailRoutes: detail });
  const llms = buildLlmsTxt({ plugins, generatedAt, summary, categories, detailRoutes: detail });
  const indexNowUrls = buildIndexNowUrls({ plugins, detailRoutes: detail });
  await Promise.all([
    writeFile(path.join(publicDir, "sitemap.xml"), sitemap),
    writeFile(path.join(publicDir, "llms.txt"), llms),
    writeFile(path.join(publicDir, "indexnow-urls.txt"), indexNowUrls.join("\n") + "\n"),
  ]);
  console.log(
    "seo artifacts: sitemap.xml (" + (detail ? "detail routes on" : "homepage only") +
      "), llms.txt, " + indexNowUrls.length + " indexnow urls",
  );
}
