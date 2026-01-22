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
// In-Memory Cache Layer
// ============================================================================

/**
 * 内存缓存层，避免重复读取同一个缓存文件
 * 注意：这些缓存在每次sync周期中有效，会在clearMemoryCache()中清空
 */
const notebookCacheMemory: Map<string, NotebookDocCache> = new Map();
const assetCacheMemory: Map<number, AssetCache> = new Map();

/**
 * 清空内存缓存（在每次sync开始时调用，确保数据新鲜）
 */
export function clearMemoryCache(): void {
  notebookCacheMemory.clear();
  assetCacheMemory.clear();
}

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
 * 使用内存缓存避免重复读取同一文件
 */
export async function loadNotebookDocCache(
  plugin: Plugin,
  notebookId: string
): Promise<NotebookDocCache> {
  // Check memory cache first
  if (notebookCacheMemory.has(notebookId)) {
    const memCache = notebookCacheMemory.get(notebookId)!;
    const keyCount = Object.keys(memCache).length;
    await logInfo(`[Cache] Notebook ${notebookId} loaded from memory (${keyCount} docs)`);
    return memCache;
  }

  // Load from file
  const cacheFile = getNotebookCacheFile(notebookId);
  await logInfo(`[Cache] Loading notebook ${notebookId} from file: ${cacheFile}`);

  let cache: NotebookDocCache | null = null;
  try {
    cache = await plugin.loadData(cacheFile);

    if (cache) {
      const keyCount = Object.keys(cache).length;
      await logInfo(`[Cache] Notebook ${notebookId} loaded successfully (${keyCount} docs)`);
    } else {
      await logInfo(`[Cache] Notebook ${notebookId} file not found or empty`);
    }
  } catch (error) {
    await logError(`[Cache] Failed to load notebook ${notebookId}`, error);
  }

  const result = cache || {};
  const finalKeyCount = Object.keys(result).length;
  await logInfo(`[Cache] Notebook ${notebookId} final result: ${finalKeyCount} docs`);

  // Store in memory cache
  notebookCacheMemory.set(notebookId, result);

  return result;
}

/**
 * Save document cache for a specific notebook
 * 同时更新内存缓存
 */
export async function saveNotebookDocCache(
  plugin: Plugin,
  notebookId: string,
  cache: NotebookDocCache
): Promise<void> {
  const cacheFile = getNotebookCacheFile(notebookId);
  // Debug: Log what we're about to save
  const preview = JSON.stringify(cache).substring(0, 500);
  await logInfo(`[Cache] Saving to ${cacheFile}: ${preview}...`);
  await plugin.saveData(cacheFile, cache);
  await logInfo(`[Cache] Save completed for ${cacheFile}`);

  // Update memory cache
  notebookCacheMemory.set(notebookId, cache);
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
  // Debug: Log the exact entry object being saved
  await logInfo(`[Cache] Entry data: ${JSON.stringify(entry)}`);
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
 * 使用内存缓存避免重复读取同一文件
 */
async function loadAssetCacheShard(
  plugin: Plugin,
  shard: number
): Promise<AssetCache> {
  // Check memory cache first
  if (assetCacheMemory.has(shard)) {
    const memCache = assetCacheMemory.get(shard)!;
    const keyCount = Object.keys(memCache).length;
    await logInfo(`[Cache] Asset shard ${shard} loaded from memory (${keyCount} entries)`);
    return memCache;
  }

  // Load from file
  const cacheFile = `assets-${shard}.json`;
  await logInfo(`[Cache] Loading asset shard ${shard} from file: ${cacheFile}`);

  let cache: AssetCache | null = null;
  try {
    cache = await plugin.loadData(cacheFile);

    if (cache) {
      const keyCount = Object.keys(cache).length;
      await logInfo(`[Cache] Asset shard ${shard} loaded successfully (${keyCount} entries)`);
    } else {
      await logInfo(`[Cache] Asset shard ${shard} file not found or empty`);
    }
  } catch (error) {
    await logError(`[Cache] Failed to load asset shard ${shard}`, error);
  }

  const result = cache || {};
  const finalKeyCount = Object.keys(result).length;
  await logInfo(`[Cache] Asset shard ${shard} final result: ${finalKeyCount} entries`);

  // Store in memory cache
  assetCacheMemory.set(shard, result);

  return result;
}

/**
 * Save asset cache for a specific shard
 * 同时更新内存缓存
 */
async function saveAssetCacheShard(
  plugin: Plugin,
  shard: number,
  cache: AssetCache
): Promise<void> {
  const cacheFile = `assets-${shard}.json`;
  await plugin.saveData(cacheFile, cache);

  // Update memory cache
  assetCacheMemory.set(shard, cache);
}

/**
 * Get cache entry for a specific asset
 *
 * 优化：扫描所有shard文件，避免shard计算不一致导致的缓存miss
 * 这样可以兼容不同版本创建的缓存文件
 */
export async function getAssetCacheEntry(
  plugin: Plugin,
  assetPath: string
): Promise<AssetCacheEntry | null> {
  // 1. 先尝试计算的shard（快速路径）
  const expectedShard = await getAssetShard(assetPath);
  const expectedCache = await loadAssetCacheShard(plugin, expectedShard);

  if (expectedCache[assetPath]) {
    await logInfo(`[Cache] Asset cache HIT: ${assetPath} (shard ${expectedShard})`);
    return expectedCache[assetPath];
  }

  // 2. 如果在计算的shard中没找到，扫描所有其他shard（兼容路径）
  await logInfo(`[Cache] Asset not found in expected shard ${expectedShard}, scanning all shards...`);

  for (let shard = 0; shard < ASSET_SHARD_COUNT; shard++) {
    if (shard === expectedShard) continue; // 已经查过了

    const cache = await loadAssetCacheShard(plugin, shard);
    if (cache[assetPath]) {
      await logInfo(`[Cache] Asset cache HIT: ${assetPath} (found in shard ${shard}, expected ${expectedShard})`);
      return cache[assetPath];
    }
  }

  // 3. 所有shard都没找到
  await logInfo(`[Cache] Asset cache MISS: ${assetPath} - NOT found in any of ${ASSET_SHARD_COUNT} shards`);
  return null;
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

/**
 * Clear ALL cache (documents, assets, and sync meta)
 * Use this for a fresh full sync
 */
export async function clearAllCache(plugin: Plugin): Promise<void> {
  // Clear sync meta to get list of notebooks
  const meta = await loadSyncMeta(plugin);

  // Clear all notebook document caches
  for (const notebookId of Object.keys(meta.notebooks)) {
    const cacheFile = getNotebookCacheFile(notebookId);
    await plugin.removeData(cacheFile);
  }

  // Clear all asset caches
  await clearAllAssetCache(plugin);

  // Clear sync meta
  await plugin.removeData(SYNC_META_FILE);

  // Clear last asset sync time
  await plugin.removeData("last-asset-sync-time");
}
