/** Shared stable sharding helpers for generated assets and Worker KV snapshots. */
export const SNAPSHOT_FORMAT = "dsh-plugin-registry-shards";
export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_SHARD_COUNT = 4;
export const MAX_SNAPSHOT_SHARD_BYTES = 16_000_000;

export function pluginShardIndex(id, shardCount = SNAPSHOT_SHARD_COUNT) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new RangeError("shardCount must be a positive integer");
  }
  let hash = 0x811c9dc5;
  for (const character of String(id).toLowerCase()) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % shardCount;
}

export function partitionPlugins(plugins, shardCount = SNAPSHOT_SHARD_COUNT) {
  if (!Array.isArray(plugins)) throw new TypeError("plugins must be an array");
  const shards = Array.from({ length: shardCount }, () => []);
  for (const plugin of plugins) {
    if (!plugin || typeof plugin.id !== "string" || !plugin.id) {
      throw new TypeError("every plugin must have a non-empty id");
    }
    shards[pluginShardIndex(plugin.id, shardCount)].push(plugin);
  }
  return shards;
}

/** Contiguous order ranges are used by the streamed legacy full-snapshot endpoint. */
export function partitionPluginsByOrder(plugins, shardCount = SNAPSHOT_SHARD_COUNT) {
  if (!Array.isArray(plugins)) throw new TypeError("plugins must be an array");
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new RangeError("shardCount must be a positive integer");
  }
  return Array.from({ length: shardCount }, (_, index) => {
    const start = Math.floor((index * plugins.length) / shardCount);
    const end = Math.floor(((index + 1) * plugins.length) / shardCount);
    return plugins.slice(start, end);
  });
}

async function sha256(value) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function serializeSnapshotShard(plugins) {
  const content = JSON.stringify(plugins);
  const hash = await sha256(content);
  const value = JSON.stringify({ version: SNAPSHOT_VERSION, hash, plugins });
  return {
    value,
    hash,
    count: plugins.length,
    bytes: new TextEncoder().encode(value).byteLength,
  };
}

/** Static shards are bare arrays so the legacy full-snapshot route can stream them. */
export async function serializeStaticSnapshotShard(plugins) {
  const value = JSON.stringify(plugins);
  return {
    value,
    hash: await sha256(value),
    count: plugins.length,
    bytes: new TextEncoder().encode(value).byteLength,
  };
}

export function createSnapshotManifest(registry, shards) {
  const metadata = { ...registry };
  delete metadata.plugins;
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    shardCount: shards.length,
    registry: metadata,
    shards,
  };
}

/** Reassemble a manifest, validating every shard before returning any data. */
export async function restoreSnapshotManifest(manifest, readShard) {
  // Compatibility with pre-sharding static assets during a rolling deployment.
  if (manifest && Array.isArray(manifest.plugins)) return manifest;
  if (
    !manifest || manifest.format !== SNAPSHOT_FORMAT || manifest.version !== SNAPSHOT_VERSION ||
    !manifest.registry || typeof manifest.registry !== "object" ||
    !Array.isArray(manifest.shards) || manifest.shards.length < 1 || manifest.shards.length > 64 ||
    (manifest.shardCount !== undefined && manifest.shardCount !== manifest.shards.length)
  ) {
    throw new Error("Invalid plugin snapshot manifest");
  }

  const plugins = [];
  const seenIndexes = new Set();
  for (const descriptor of manifest.shards) {
    if (
      !descriptor || !Number.isInteger(descriptor.index) || seenIndexes.has(descriptor.index) ||
      typeof descriptor.hash !== "string"
    ) {
      throw new Error("Invalid plugin snapshot shard descriptor");
    }
    seenIndexes.add(descriptor.index);
  }

  const loadedShards = await Promise.all(manifest.shards.map(async (descriptor) => ({
    descriptor,
    shard: await readShard(descriptor),
  })));
  const seen = new Set();
  for (const { descriptor, shard } of loadedShards) {
    const shardPlugins = Array.isArray(shard) ? shard : shard?.plugins;
    const shardVersion = Array.isArray(shard) ? SNAPSHOT_VERSION : shard?.version;
    const shardHash = Array.isArray(shard) ? descriptor.hash : shard?.hash;
    if (
      !shard || shardVersion !== SNAPSHOT_VERSION || shardHash !== descriptor.hash ||
      !Array.isArray(shardPlugins) || shardPlugins.length !== descriptor.count
    ) {
      throw new Error(`Plugin snapshot shard ${descriptor.index} is incomplete`);
    }
    if (await sha256(JSON.stringify(shardPlugins)) !== descriptor.hash) {
      throw new Error(`Plugin snapshot shard ${descriptor.index} failed integrity validation`);
    }
    for (const plugin of shardPlugins) {
      if (!plugin || typeof plugin.id !== "string" || seen.has(plugin.id.toLowerCase())) {
        throw new Error(`Plugin snapshot shard ${descriptor.index} contains an invalid or duplicate plugin`);
      }
      seen.add(plugin.id.toLowerCase());
      plugins.push(plugin);
    }
  }

  plugins.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
  return { ...manifest.registry, plugins };
}
