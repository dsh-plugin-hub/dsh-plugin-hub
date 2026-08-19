import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

// Worker 的 bundled 回退改为从静态资源 /plugins.json 读取（不再打包进产物），
// 测试环境用磁盘上的全量快照模拟 ASSETS 绑定。
let assetsJsonCache = null;
async function assetsResponse() {
  if (!assetsJsonCache) {
    assetsJsonCache = await readFile(new URL("public/plugins.json", root), "utf8");
  }
  return new Response(assetsJsonCache, { headers: { "content-type": "application/json" } });
}

async function request(path = "/", accept = "text/html", envOverrides = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  const pending = [];
  const response = await worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept } }),
    {
      ASSETS: {
        fetch: async (input) => {
          const url = new URL(typeof input === "string" ? input : input.url);
          if (url.pathname === "/plugins.json") return assetsResponse();
          return new Response("Not found", { status: 404 });
        },
      },
      ...envOverrides,
    },
    {
      waitUntil(promise) { pending.push(promise); },
      passThroughOnException() {},
    },
  );
  await Promise.all(pending);
  return response;
}

function visitDatabase({ historical = 100, tracked = 5, cutoff = "2026-08-15T00:00:00Z" } = {}) {
  const state = { historical, tracked };
  return {
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/gu, " ").trim();
      const statement = {
        bindings: [],
        bind(...values) {
          this.bindings = values;
          return this;
        },
        async all() {
          assert.match(normalized, /^SELECT name, value/iu);
          return {
            success: true,
            results: [
              { name: "historical_root_views", value: state.historical, source: "cloudflare-http-requests", cutoff_at: cutoff, updated_at: cutoff },
              { name: "tracked_root_views", value: state.tracked, source: "worker-root-html", cutoff_at: null, updated_at: cutoff },
            ],
          };
        },
        async run() {
          assert.match(normalized, /^INSERT INTO visit_counters/iu);
          assert.equal(this.bindings[0], "tracked_root_views");
          state.tracked += 1;
          return { success: true, results: [], meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}

test("server-renders the complete plugin hub", async () => {
  const registry = JSON.parse(await readFile(new URL("data/plugins.generated.json", root), "utf8"));
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");

  const html = await response.text();
  // 站点名与主题（P1-T1/T8：默认深色；SEO 标题带实时收录数）
  assert.match(html, /<title>dsh-plugin · DeepSeek Harness 插件目录｜收录 \d+ 个 GitHub 真实插件<\/title>/i);
  assert.match(html, /rel="icon"[^>]+href="\/favicon\.svg"/i);
  assert.match(html, /<html[^>]+data-theme="dark"/i);
  // SEO：canonical 指向生产域 + 结构化数据（WebSite/Organization/ItemList）
  assert.match(html, /rel="canonical" href="https:\/\/dsh-plugin\.store"/i);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type":"WebSite"/);
  assert.match(html, /"@type":"ItemList"/);
  // hero 文案与动态背景（P1-T7/T8）
  assert.match(html, /一切皆插件/);
  assert.match(html, /先看证据/);
  // 巡检状态文案：bundled 快照应显示"部署快照已同步"，而非误导性的"等待首次云端巡检"
  assert.match(html, /部署快照已同步/);
  assert.doesNotMatch(html, /等待首次云端巡检/);
  assert.match(html, /ds-hero__streams/);
  assert.match(html, /ds-hero__spotlight/);
  assert.doesNotMatch(html, /ds-hero__matrix/);
  assert.match(html, /ds-hero__shade/);
  assert.match(html, new RegExp(String(registry.summary.listed)));
    // 首页留存改版：紧凑价值区 + 数据条 + 首屏目录（保留后续事实说明）
    assert.match(html, /class="ds-home"/);
    assert.match(html, /ds-home-metrics/);
    assert.match(html, /id="ds-catalog-heading"/);
    assert.match(html, /ds-catalog-results/);
    assert.match(html, /每张卡片都说明事实到哪一步/);
    assert.doesNotMatch(html, /社区热度/);
    assert.doesNotMatch(html, /按分类逛/);
  // 官网风格组件类名
  for (const cls of ["ds-header", "ds-hero__bg", "ds-container", "ds-footer", "ds-section--catalog", "growth-chart"]) {
    assert.match(html, new RegExp(`class="[^"]*${cls}`), `missing class ${cls}`);
  }
  assert.match(html, /访问量/);
  assert.doesNotMatch(html, />访问热度</);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("serves the real registry through the JSON API (bundled fallback)", async () => {
  const response = await request("/api/plugins", "application/json");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  // 测试环境无 D1 绑定 → 回退 bundled 全量格式
  assert.equal(response.headers.get("x-registry-source"), "bundled-fallback");

  const body = await response.json();
  assert.equal(body.schemaVersion, 2);
  assert.ok(body.plugins.length >= body.summary.listed);
  assert.ok(body.summary.curated <= body.plugins.length);
  assert.ok(body.summary.topicTotal >= body.summary.curated);
  assert.ok(body.summary.manifestMatches >= 500);
  assert.equal(body.automation.schedule, "*/30 * * * *");
  assert.equal(body.sources.curated.state, "live");
  assert.equal(body.sources.topic.state, "live");
  assert.ok(body.plugins.every((plugin) => plugin.url.startsWith("https://github.com/")));
  // 新数据模型：有 facts、无 screening/installCommand
  assert.ok(body.plugins.every((plugin) => plugin.facts && plugin.discovery));
  assert.ok(body.plugins.every((plugin) => !("screening" in plugin) && !("screenedCommit" in plugin) && !("installCommand" in plugin)));
  // facts 与 manifest 一致：verified 必有 hasManifest
  for (const plugin of body.plugins.filter((p) => p.manifest?.state === "verified")) {
    assert.equal(plugin.facts.hasManifest, true, `${plugin.id} verified but facts.hasManifest false`);
  }
});

test("serves one complete plugin record through the detail JSON API", async () => {
  const registry = JSON.parse(await readFile(new URL("data/plugins.generated.json", root), "utf8"));
  const expected = registry.plugins.find((plugin) => plugin.id === "max-samson/dsh-usage-chart");
  assert.ok(expected, "fixture plugin should exist in the registry");

  const response = await request("/api/plugins/Max-Samson/dsh-usage-chart", "application/json");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");

  const body = await response.json();
  assert.equal(body.plugin.id, expected.id);
  assert.equal(body.plugin.manifest.packageName, "dsh-usage-chart");
  assert.equal(body.categories.ui.zh, registry.categories.ui.zh);
  assert.equal(body.generatedAt, registry.generatedAt);
});

test("server-renders the plugin detail page for preview plugins", async () => {
  const preview = JSON.parse(await readFile(new URL("data/preview.generated.json", root), "utf8"));
  const plugin = preview.plugins[0];
  const response = await request(`/p/${plugin.id}`, "text/html");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, new RegExp(plugin.name));
  assert.match(html, /ds-detail__plate/);
  assert.match(html, /安装/);
  assert.match(html, /README/);
  assert.match(html, /仓库事实/);
});

test("serves a compact public registry status endpoint", async () => {
  const registry = JSON.parse(await readFile(new URL("data/plugins.generated.json", root), "utf8"));
  const response = await request("/api/registry/status", "application/json");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.automation.enabled, true);
  assert.equal(body.summary.listed, registry.summary.listed);
  assert.ok(!("screeningClear" in body.summary));
  assert.ok(!("screeningReview" in body.summary));
  assert.ok(!("screeningBlocked" in body.summary));
});

test("serves multiplied visit heat while preserving the real total", async () => {
  const db = visitDatabase({ historical: 100, tracked: 5 });
  const env = { VISIT_METRICS: db, VISIT_DISPLAY_MULTIPLIER: "3" };

  const first = await request("/api/visits", "application/json", env);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(first.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await first.json(), {
    available: true,
    displayCount: 315,
    realCount: 105,
    multiplier: 3,
    trackedCount: 5,
    historicalCount: 100,
    historicalCutoff: "2026-08-15T00:00:00Z",
    updatedAt: "2026-08-15T00:00:00Z",
    methodology: "root-document-requests",
  });

  const page = await request("/", "text/html", env);
  assert.equal(page.status, 200);
  assert.equal(db.state.tracked, 6);

  const next = await request("/api/visits", "application/json", env);
  const nextBody = await next.json();
  assert.equal(nextBody.realCount, 106);
  assert.equal(nextBody.displayCount, 318);
});

test("keeps the generated registry internally consistent", async () => {
  const [generatedText, publicText, packageText] = await Promise.all([
    readFile(new URL("data/plugins.generated.json", root), "utf8"),
    readFile(new URL("public/plugins.json", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  const registry = JSON.parse(generatedText);
  const ids = registry.plugins.map((plugin) => plugin.id);
  // manifestMatches 只计活跃（未下架）插件；removed 保留历史记录但不再计入统计
  const verified = registry.plugins.filter((plugin) => plugin.removed !== true && plugin.manifest?.state === "verified");
  const removed = registry.plugins.filter((plugin) => plugin.removed);

  assert.equal(publicText, generatedText);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(verified.length, registry.summary.manifestMatches);
  // 新数据模型：无筛查字段，facts 与 manifest 一致
  assert.ok(registry.plugins.every((plugin) => !("screening" in plugin) && !("screenedCommit" in plugin) && !("installCommand" in plugin)));
  assert.ok(registry.plugins.every((plugin) => plugin.facts && plugin.facts.lifecycleScripts));
  for (const plugin of verified) {
    assert.equal(plugin.facts.hasManifest, true, `${plugin.id} verified but facts.hasManifest false`);
  }
  // listed 只计活跃插件，removed 只标记不删除
  assert.equal(registry.plugins.length - removed.length, registry.summary.listed);
  assert.ok(removed.every((plugin) => plugin.removed === true));
  assert.doesNotMatch(packageText, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview", root)));

  // 预览快照：SSR 薄切片与全量数据一致（全量 JSON 不进打包器）
  const preview = JSON.parse(await readFile(new URL("data/preview.generated.json", root), "utf8"));
  assert.equal(preview.summary.listed, registry.summary.listed);
  assert.equal(preview.plugins.length, Math.min(60, registry.summary.listed));
  assert.equal(preview.topStars.length, 20);
  assert.equal(preview.topFresh.length, 20);
  for (let i = 1; i < preview.topStars.length; i++) {
    assert.ok((preview.topStars[i - 1].stars || 0) >= (preview.topStars[i].stars || 0));
  }
  assert.equal(
    Object.values(preview.categoryCounts).reduce((sum, value) => sum + value, 0),
    registry.summary.listed,
  );
  assert.equal(preview.growthSeries.at(-1).total, registry.summary.listed);
});
