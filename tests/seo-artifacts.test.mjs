import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INDEXNOW_KEY, SITE_URL } from "../scripts/seo-artifacts.mjs";

// SEO 工件测试：robots.txt / sitemap.xml / llms.txt / IndexNow 密钥与推送清单。
// 工件由 scripts/sync-plugins.mjs（data:sync）生成，CI 在 npm test 前执行 data:sync。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

function readPublic(name) {
  const file = path.join(publicDir, name);
  assert.ok(existsSync(file), "missing public/" + name);
  return readFileSync(file, "utf8");
}

test("robots.txt 放行全部抓取并引用 sitemap", () => {
  const robots = readPublic("robots.txt");
  assert.match(robots, /^User-agent: \*/m);
  assert.match(robots, /Allow: \//);
  assert.match(robots, new RegExp("Sitemap: " + SITE_URL + "/sitemap.xml"));
  // 显式放行 AI 爬虫
  assert.match(robots, /GPTBot/);
  assert.match(robots, /ClaudeBot/);
  assert.match(robots, /Baiduspider/);
});

test("sitemap.xml 结构完整且指向生产域", () => {
  const sitemap = readPublic("sitemap.xml");
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(sitemap, new RegExp("<loc>" + SITE_URL + "/</loc>"));
  const urls = (sitemap.match(/<url>/g) || []).length;
  assert.equal(urls, (sitemap.match(/<\/url>/g) || []).length, "url open/close tags balanced");
  assert.ok(urls >= 1, "at least homepage");
  // 详情页路由已部署时（app/p 在仓库中），sitemap 应包含插件详情页
  if (existsSync(path.join(root, "app", "p"))) {
    assert.match(sitemap, new RegExp("<loc>" + SITE_URL + "/p/[^<]+</loc>"));
    assert.ok(urls > 100, "plugin detail URLs included");
  }
});

test("llms.txt 面向 AI 抓取器", () => {
  const llms = readPublic("llms.txt");
  assert.match(llms, /^# dsh-plugin — DeepSeek Harness 插件目录/);
  assert.match(llms, new RegExp(SITE_URL));
});

test("IndexNow 密钥文件与推送清单", () => {
  const keyFile = readPublic(INDEXNOW_KEY + ".txt");
  assert.equal(keyFile.trim(), INDEXNOW_KEY);

  const urls = readPublic("indexnow-urls.txt")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assert.ok(urls.length >= 1, "at least homepage in push list");
  assert.ok(urls.every((url) => url.startsWith(SITE_URL + "/")), "all URLs absolute on production domain");
  assert.ok(urls.includes(SITE_URL + "/"), "homepage included");
});
