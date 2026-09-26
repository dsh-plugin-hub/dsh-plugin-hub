import assert from "node:assert/strict";
import test from "node:test";
import {
  createSnapshotManifest,
  partitionPlugins,
  partitionPluginsByOrder,
  restoreSnapshotManifest,
  serializeSnapshotShard,
  SNAPSHOT_SHARD_COUNT,
} from "../lib/registry-snapshot.mjs";
import {
  readPluginRecord,
  readPluginRegistry,
  readPluginRegistryMetadata,
} from "../worker/plugin-registry.ts";

const registryFixture = {
  schemaVersion: 2,
  generatedAt: "2026-09-26T00:00:00.000Z",
  automation: { enabled: true, state: "live" },
  sources: { curated: { count: 1 }, topic: { total: 3 } },
  summary: { listed: 3, curated: 1 },
  categories: { tools: { en: "Tools", zh: "工具" } },
  plugins: [
    { id: "owner/first", order: 0, repo: "owner/first" },
    { id: "owner/second", order: 1, repo: "owner/second" },
    { id: "owner/third", order: 2, repo: "owner/third" },
  ],
};

test("stable hash partitioning preserves every plugin and registry order", async () => {
  const shards = partitionPlugins(registryFixture.plugins);
  assert.equal(shards.length, SNAPSHOT_SHARD_COUNT);
  assert.deepEqual(partitionPlugins(registryFixture.plugins), shards);
  assert.deepEqual(shards.flat().map((plugin) => plugin.id).sort(), [
    "owner/first", "owner/second", "owner/third",
  ]);
  assert.deepEqual(partitionPluginsByOrder(registryFixture.plugins, 2).flat(), registryFixture.plugins);

  const descriptors = [];
  const values = new Map();
  for (let index = 0; index < shards.length; index += 1) {
    const serialized = await serializeSnapshotShard(shards[index]);
    const key = `registry:v3:shard:${String(index).padStart(2, "0")}`;
    descriptors.push({ index, key, hash: serialized.hash, count: serialized.count, bytes: serialized.bytes });
    values.set(key, JSON.parse(serialized.value));
  }
  const manifest = createSnapshotManifest(registryFixture, descriptors);
  const restored = await restoreSnapshotManifest(manifest, (descriptor) => values.get(descriptor.key));
  assert.deepEqual(restored, registryFixture);
});

test("manifest restoration rejects a missing or tampered shard", async () => {
  const [plugins] = partitionPlugins(registryFixture.plugins, 1);
  const shard = await serializeSnapshotShard(plugins);
  const manifest = createSnapshotManifest(registryFixture, [{
    index: 0,
    hash: shard.hash,
    count: shard.count,
    bytes: shard.bytes,
  }]);

  await assert.rejects(
    restoreSnapshotManifest(manifest, async () => null),
    /incomplete/u,
  );
  await assert.rejects(
    restoreSnapshotManifest(manifest, async () => ({ ...JSON.parse(shard.value), plugins: [] })),
    /incomplete|integrity/u,
  );
});

test("Worker reads a complete KV shard set and falls back to the legacy key if incomplete", async () => {
  const shards = partitionPlugins(registryFixture.plugins);
  const values = new Map();
  const descriptors = [];
  for (let index = 0; index < shards.length; index += 1) {
    const serialized = await serializeSnapshotShard(shards[index]);
    const key = `registry:v3:shard:${String(index).padStart(2, "0")}`;
    descriptors.push({ index, key, hash: serialized.hash, count: serialized.count, bytes: serialized.bytes });
    values.set(key, JSON.parse(serialized.value));
  }
  values.set("registry:v3:manifest", createSnapshotManifest(registryFixture, descriptors));
  const reads = [];
  const env = {
    PLUGIN_REGISTRY: {
      async get(key) {
        reads.push(key);
        return values.get(key) ?? null;
      },
    },
  };
  const restored = await readPluginRegistry(env);
  assert.deepEqual(restored.plugins.map((plugin) => plugin.id), [
    "owner/first", "owner/second", "owner/third",
  ]);

  reads.length = 0;
  const detail = await readPluginRecord(env, "owner/second");
  assert.equal(detail.plugin?.id, "owner/second");
  assert.equal(reads.length, 2, "detail lookup should read the manifest and one shard");

  reads.length = 0;
  const metadata = await readPluginRegistryMetadata(env);
  assert.equal(metadata.registry.summary.listed, 3);
  assert.deepEqual(reads, ["registry:v3:manifest"], "metadata lookup should not read plugin shards");

  values.delete("registry:v3:shard:02");
  values.set("registry:v2", registryFixture);
  const fallback = await readPluginRegistry(env);
  assert.deepEqual(fallback.plugins.map((plugin) => plugin.id), [
    "owner/first", "owner/second", "owner/third",
  ]);
});
