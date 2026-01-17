/**
 * Cache Manager for Large-Scale Sync
 *
 * Cache Structure:
 * - sync-meta.json: Global sync metadata
 * - notebook-{notebookId}-docs.json: Document cache per notebook
 * - assets-{shard}.json: Asset cache sharded by hash (0-15)
 */

import type { Plugin } from "siyuan";
import type {
  DocCacheEntry,
  AssetCacheEntry,
  SyncMeta,
  NotebookDocCache,
  AssetCache,
  NotebookMeta,
} from "./types";
import { logInfo, logError } from "./logger";
import { calculateShardHash } from "./hash-utils";

// ============================================================================
// Constants
// ============================================================================

const SYNC_META_FILE = "sync-meta.json";
const ASSET_SHARD_COUNT = 16; // Number of asset cache shards

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get notebook cache file name
 */
function getNotebookCacheFile(notebookId: string): string {
  return `notebook-${notebookId}-docs.json`;
}

/**
 * Get asset cache shard number (0-15) based on asset path hash
 */
async function getAssetShard(assetPath: string): Promise<number> {
  const hash = await calculateShardHash(assetPath);
  return parseInt(hash.substring(0, 2), 16) % ASSET_SHARD_COUNT;
}

/**
 * Get asset cache file name
 */
async function getAssetCacheFile(assetPath: string): Promise<string> {
  const shard = await getAssetShard(assetPath);
  return `assets-${shard}.json`;
}

// ============================================================================
// Sync Meta Management
// ============================================================================

export async function loadSyncMeta(plugin: Plugin): Promise<SyncMeta> {
  const meta = await plugin.loadData(SYNC_META_FILE);
  return meta || {
    lastFullSync: 0,
    notebooks: {},
  };
}

export async function saveSyncMeta(plugin: Plugin, meta: SyncMeta): Promise<void> {
  await plugin.saveData(SYNC_META_FILE, meta);
}

export async function updateNotebookMeta(
  plugin: Plugin,
  notebookId: string,
  notebookName: string,
  docCount: number
): Promise<void> {
  await logInfo(`[Cache] Updating notebook meta: ${notebookName} (${docCount} docs)`);
  const meta = await loadSyncMeta(plugin);
  meta.notebooks[notebookId] = {
    notebookId,
    notebookName,
    docCount,
    lastSyncTime: Date.now(),
  };
  await saveSyncMeta(plugin, meta);
}

// ============================================================================
// Document Cache Management (Per Notebook)
// ============================================================================

/**
 * Load document cache for a specific notebook
 */
export async function loadNotebookDocCache(
  plugin: Plugin,
  notebookId: string
): Promise<NotebookDocCache> {
  const cacheFile = getNotebookCacheFile(notebookId);
  const cache = await plugin.loadData(cacheFile);
  return cache || {};
}

/**
 * Save document cache for a specific notebook
 */
export async function saveNotebookDocCache(
  plugin: Plugin,
  notebookId: string,
  cache: NotebookDocCache
): Promise<void> {
  const cacheFile = getNotebookCacheFile(notebookId);
  await plugin.saveData(cacheFile, cache);
}

/**
 * Get cache entry for a specific document
 */
export async function getDocCacheEntry(
  plugin: Plugin,
  notebookId: string,
  docId: string
): Promise<DocCacheEntry | null> {
  const cache = await loadNotebookDocCache(plugin, notebookId);
  const entry = cache[docId] || null;
  if (entry) {
    await logInfo(`[Cache] Doc cache hit: ${docId}`);
  } else {
    await logInfo(`[Cache] Doc cache miss: ${docId}`);
  }
  return entry;
}

/**
 * Update cache entry for a specific document
 */
export async function updateDocCacheEntry(
  plugin: Plugin,
  notebookId: string,
  docId: string,
  entry: DocCacheEntry
): Promise<void> {
  await logInfo(`[Cache] Updating doc cache: ${docId} -> ${entry.githubPath}`);
  const cache = await loadNotebookDocCache(plugin, notebookId);
  cache[docId] = entry;
  await saveNotebookDocCache(plugin, notebookId, cache);
}

/**
 * Remove cache entry for a specific document
 */
export async function removeDocCacheEntry(
  plugin: Plugin,
  notebookId: string,
  docId: string
): Promise<void> {
  const cache = await loadNotebookDocCache(plugin, notebookId);
  delete cache[docId];
  await saveNotebookDocCache(plugin, notebookId, cache);
}

/**
 * Get all document IDs in a notebook cache
 */
export async function getNotebookDocIds(
  plugin: Plugin,
  notebookId: string
): Promise<string[]> {
  const cache = await loadNotebookDocCache(plugin, notebookId);
  return Object.keys(cache);
}

// ============================================================================
// Asset Cache Management (Sharded by Hash)
// ============================================================================

/**
 * Load asset cache for a specific shard
 */
async function loadAssetCacheShard(
  plugin: Plugin,
  shard: number
): Promise<AssetCache> {
  const cacheFile = `assets-${shard}.json`;
  const cache = await plugin.loadData(cacheFile);
  return cache || {};
}

/**
 * Save asset cache for a specific shard
 */
async function saveAssetCacheShard(
  plugin: Plugin,
  shard: number,
  cache: AssetCache
): Promise<void> {
  const cacheFile = `assets-${shard}.json`;
  await plugin.saveData(cacheFile, cache);
}

/**
 * Get cache entry for a specific asset
 */
export async function getAssetCacheEntry(
  plugin: Plugin,
  assetPath: string
): Promise<AssetCacheEntry | null> {
  const shard = await getAssetShard(assetPath);
  const cache = await loadAssetCacheShard(plugin, shard);
  const entry = cache[assetPath] || null;
  if (entry) {
    await logInfo(`[Cache] Asset cache hit: ${assetPath} (shard ${shard})`);
  }
  return entry;
}

/**
 * Update cache entry for a specific asset
 */
export async function updateAssetCacheEntry(
  plugin: Plugin,
  assetPath: string,
  entry: AssetCacheEntry
): Promise<void> {
  const shard = await getAssetShard(assetPath);
  await logInfo(`[Cache] Updating asset cache: ${assetPath} (shard ${shard})`);
  const cache = await loadAssetCacheShard(plugin, shard);
  cache[assetPath] = entry;
  await saveAssetCacheShard(plugin, shard, cache);
}

/**
 * Remove cache entry for a specific asset
 */
export async function removeAssetCacheEntry(
  plugin: Plugin,
  assetPath: string
): Promise<void> {
  const shard = await getAssetShard(assetPath);
  const cache = await loadAssetCacheShard(plugin, shard);
  delete cache[assetPath];
  await saveAssetCacheShard(plugin, shard, cache);
}

// ============================================================================
// Batch Operations & Statistics
// ============================================================================

/**
 * Get total number of cached documents across all notebooks
 */
export async function getTotalCachedDocs(plugin: Plugin): Promise<number> {
  const meta = await loadSyncMeta(plugin);
  return Object.values(meta.notebooks).reduce((sum, nb) => sum + nb.docCount, 0);
}

/**
 * Get total number of cached assets across all shards
 */
export async function getTotalCachedAssets(plugin: Plugin): Promise<number> {
  let total = 0;
  for (let shard = 0; shard < ASSET_SHARD_COUNT; shard++) {
    const cache = await loadAssetCacheShard(plugin, shard);
    total += Object.keys(cache).length;
  }
  return total;
}

/**
 * Clear all cache for a specific notebook
 */
export async function clearNotebookCache(
  plugin: Plugin,
  notebookId: string
): Promise<void> {
  const cacheFile = getNotebookCacheFile(notebookId);
  await plugin.removeData(cacheFile);

  // Update meta
  const meta = await loadSyncMeta(plugin);
  delete meta.notebooks[notebookId];
  await saveSyncMeta(plugin, meta);
}

/**
 * Clear all asset cache
 */
export async function clearAllAssetCache(plugin: Plugin): Promise<void> {
  for (let shard = 0; shard < ASSET_SHARD_COUNT; shard++) {
    const cacheFile = `assets-${shard}.json`;
    await plugin.removeData(cacheFile);
  }
}
