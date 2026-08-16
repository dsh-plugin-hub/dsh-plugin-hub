import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryFromText,
  deriveFacts,
  installCommandFor,
  manifestSummary,
  normalizeRepositoryPath,
  sanitizeRegistryInstallEvidence,
} from "../lib/plugin-screening.mjs";

function manifest(pkg = {}) {
  return manifestSummary({
    name: "safe-plugin",
    version: "1.0.0",
    main: "./lib/index.js",
    dsh: { bundle: { patch: "./cordis.patch.yml" } },
    ...pkg,
  }, "main");
}

test("normalizes only repository-relative declared paths", () => {
  assert.equal(normalizeRepositoryPath("./src/index.ts"), "src/index.ts");
  assert.equal(normalizeRepositoryPath("../outside.ts"), null);
  assert.equal(normalizeRepositoryPath("/etc/passwd"), null);
  assert.equal(normalizeRepositoryPath("https://example.com/a.js"), null);
});

test("extracts dsh manifest fields from package.json", () => {
  const summary = manifest({
    exports: { ".": { default: "./lib/index.js" }, "./client": "./lib/client.js" },
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: { platform: "web" },
    },
    scripts: { prepare: "npm run build", postinstall: "node scripts/patch.mjs" },
    dependencies: { react: "^19", lodash: "^4" },
  });
  assert.equal(summary.state, "verified");
  assert.deepEqual(summary.kinds, ["bundle", "client"]);
  assert.ok(summary.declaredPaths.includes("lib/client.js"));
  assert.deepEqual(summary.lifecycleScripts, ["postinstall", "prepare"]);
  assert.equal(summary.runtimeDependencies, 2);
  assert.equal(summary.packageName, "safe-plugin");
});

test("returns a missing manifest summary for non-object input", () => {
  const summary = manifestSummary(null, "main");
  assert.equal(summary.state, "missing");
  assert.equal(summary.branch, "main");
  assert.deepEqual(summary.lifecycleScripts, []);
  assert.deepEqual(summary.declaredPaths, []);
});

test("derives facts from manifest and repository metadata", () => {
  const facts = deriveFacts(manifest({ scripts: { postinstall: "node patch.mjs" } }), {
    license: { spdx_id: "MIT" },
    files: ["README.md", "package.json", "pnpm-lock.yaml"],
  });
  assert.equal(facts.hasManifest, true);
  assert.equal(facts.hasLicense, true);
  assert.equal(facts.hasReadme, true);
  assert.equal(facts.hasLockfile, true);
  assert.deepEqual(facts.lifecycleScripts, ["postinstall"]);
});

test("best-effort facts tolerate missing metadata", () => {
  const facts = deriveFacts(manifestSummary(null, null), { license: "NOASSERTION" });
  assert.equal(facts.hasManifest, false);
  assert.equal(facts.hasLicense, false);
  assert.equal(facts.hasLockfile, false);
  assert.equal(facts.hasReadme, false);
  assert.deepEqual(facts.lifecycleScripts, []);
});

test("facts accept precomputed lockfile/readme flags", () => {
  const facts = deriveFacts(manifest(), {
    license: "MIT",
    hasLockfile: true,
    hasReadme: true,
  });
  assert.equal(facts.hasLockfile, true);
  assert.equal(facts.hasReadme, true);
  assert.equal(facts.hasLicense, true);
});

test("builds an unpinned install command for valid owner/name repos", () => {
  assert.equal(
    installCommandFor("owner/plugin"),
    "dsh plugin --profile web add github:owner/plugin",
  );
  assert.equal(
    installCommandFor("Owner-Name/repo.name_1"),
    "dsh plugin --profile web add github:Owner-Name/repo.name_1",
  );
  assert.equal(
    installCommandFor("  owner/plugin  "),
    "dsh plugin --profile web add github:owner/plugin",
  );
});

test("rejects invalid repo inputs for installCommandFor", () => {
  assert.equal(installCommandFor(""), null);
  assert.equal(installCommandFor("owner"), null);
  assert.equal(installCommandFor("owner/plugin/extra"), null);
  assert.equal(installCommandFor("/plugin"), null);
  assert.equal(installCommandFor("owner/"), null);
  assert.equal(installCommandFor("owner//plugin"), null);
  assert.equal(installCommandFor("../.."), null);
  assert.equal(installCommandFor("https://github.com/owner/plugin"), null);
  assert.equal(installCommandFor("a".repeat(241)), null);
  assert.equal(installCommandFor(null), null);
});

test("maps text to all twelve categories", () => {
  assert.equal(categoryFromText("dsh web sidebar panel"), "ui");
  assert.equal(categoryFromText("dark mode appearance theme"), "theme");
  assert.equal(categoryFromText("openai llm provider proxy"), "model");
  assert.equal(categoryFromText("conversation memory recall"), "memory");
  assert.equal(categoryFromText("session export chat history"), "session");
  assert.equal(categoryFromText("prompt skill pack"), "skill");
  assert.equal(categoryFromText("cron automation pipeline"), "workflow");
  assert.equal(categoryFromText("telegram webhook notify"), "notify");
  assert.equal(categoryFromText("debug sandbox inspector"), "dev");
  assert.equal(categoryFromText("plugin marketplace catalog"), "market");
  assert.equal(categoryFromText("emoji sticker pet"), "fun");
  assert.equal(categoryFromText("ocr vision document tool"), "tools");
});

test("categoryFromText falls back to tools for unrelated text", () => {
  assert.equal(categoryFromText("random words with no signal"), "tools");
  assert.equal(categoryFromText(""), "tools");
});

test("whitelists plugin fields and drops screening evidence", () => {
  const registry = sanitizeRegistryInstallEvidence({
    summary: { listed: 1, screeningClear: 0, screeningReview: 2, screeningBlocked: 9, stars: 10 },
    plugins: [{
      id: "owner/plugin",
      repo: "Owner/Plugin",
      manifest: { state: "verified" },
      screening: { state: "blocked" },
      screenedCommit: "abc",
      installCommand: "dsh plugin --profile web add github:Owner/Plugin",
      attention: { level: "caution" },
      facts: { hasManifest: true, hasLicense: true },
      removed: false,
    }],
  });
  assert.equal(registry.summary.screeningClear, undefined);
  assert.equal(registry.summary.screeningReview, undefined);
  assert.equal(registry.summary.screeningBlocked, undefined);
  assert.equal(registry.summary.listed, 1);
  assert.equal(registry.summary.stars, 10);
  const plugin = registry.plugins[0];
  assert.equal(plugin.screening, undefined);
  assert.equal(plugin.screenedCommit, undefined);
  assert.equal(plugin.installCommand, undefined);
  assert.equal(plugin.attention, undefined);
  assert.equal(plugin.id, "owner/plugin");
  assert.equal(plugin.repo, "Owner/Plugin");
  assert.deepEqual(plugin.facts, { hasManifest: true, hasLicense: true });
  assert.equal(plugin.removed, false);
});

test("cleans malformed repo values", () => {
  const registry = sanitizeRegistryInstallEvidence({
    plugins: [
      { repo: "not-a-repo" },
      { repo: "owner/plugin/extra" },
      { repo: "Owner/Plugin" },
    ],
  });
  assert.equal(registry.plugins[0].repo, null);
  assert.equal(registry.plugins[1].repo, null);
  assert.equal(registry.plugins[2].repo, "Owner/Plugin");
});

test("passes through non-registry input untouched", () => {
  assert.equal(sanitizeRegistryInstallEvidence(null), null);
  assert.equal(sanitizeRegistryInstallEvidence(undefined), undefined);
  assert.equal(sanitizeRegistryInstallEvidence({ plugins: "nope" }).plugins, "nope");
});
