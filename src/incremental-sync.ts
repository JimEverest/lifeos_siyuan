/**
 * Incremental Sync Module
 *
 * 实现基于时间戳的增量同步，避免全量扫描
 */

import type { Plugin } from "siyuan";
import type { Settings, IncrementalSyncResult, DocMetadata, AssetMetadata } from "./types";
import { logInfo, logError } from "./logger";
import { getDocCacheEntry, updateDocCacheEntry } from "./cache-manager";
import { getAssetCacheEntry, updateAssetCacheEntry } from "./cache-manager";
import { exportCurrentDocToGit } from "./exporter";
import { uploadAssetWithCache } from "./assets-sync";
import { listNotebooks, getDocInfo } from "./siyuan-api";

// ============================================================================
// 文档增量扫描
// ============================================================================

/**
 * 获取所有文档的元数据（轻量级查询）
 */
async function getAllDocMetadata(): Promise<DocMetadata[]> {
  await logInfo("[IncrementalSync] Fetching all document metadata");

  // 使用 SiYuan SQL API 批量查询文档元数据
  const response = await fetch("/api/query/sql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stmt: `SELECT id, box, path, hpath, content AS name, updated
             FROM blocks
             WHERE type = 'd'
             ORDER BY updated DESC`
    })
  });

  const result = await response.json();

  if (result.code !== 0) {
    await logError(`Failed to query documents: ${result.msg}`);
    return [];
  }

  const docs: DocMetadata[] = (result.data || [])
    .filter((row: any) => {
      // 过滤掉无效的文档
      if (!row.id || !row.box) return false;
      // 只过滤掉特殊的 plugins box
      if (row.box === 'plugins') return false;
      // 过滤掉没有有效时间戳的文档
      if (!row.updated || typeof row.updated !== 'string') return false;
      return true;
    })
    .map((row: any) => ({
      id: row.id,
      box: row.box,
      path: row.path,
      hpath: row.hpath,
      name: row.name,
      updated: row.updated
    }));

  await logInfo(`[IncrementalSync] Found ${docs.length} documents`);
  return docs;
}

/**
 * 筛选需要同步的文档（基于时间戳）
 */
export async function getChangedDocuments(plugin: Plugin, allDocs: DocMetadata[]): Promise<DocMetadata[]> {
  const startTime = Date.now();
  const changedDocs: DocMetadata[] = [];

  await logInfo(`[IncrementalSync] Scanning ${allDocs.length} documents for changes`);

  for (const doc of allDocs) {
    try {
      // 查询缓存
      const cached = await getDocCacheEntry(plugin, doc.box, doc.id);

      if (!cached) {
        // 缓存不存在 → 新文档
        changedDocs.push(doc);
        await logInfo(`[IncrementalSync] New doc: ${doc.id}`);
        continue;
      }

      // 比较时间戳
      if (doc.updated > cached.siyuanUpdated) {
        // SiYuan 更新时间晚于缓存 → 文档已修改
        changedDocs.push(doc);
        // 安全的时间格式化
        let timeStr = 'unknown';
        if (doc.updated) {
          try {
            timeStr = new Date(doc.updated).toISOString();
          } catch (e) {
            timeStr = 'invalid';
          }
        }
        await logInfo(`[IncrementalSync] Modified doc: ${doc.id} (${timeStr})`);
      }
      // else: 文档未修改 → 跳过
    } catch (error) {
      await logError(`[IncrementalSync] Error checking doc ${doc.id}: ${error}`);
      // 出错时保守处理：认为文档已变化
      changedDocs.push(doc);
    }
  }

  const scanTime = Date.now() - startTime;
  await logInfo(
    `[IncrementalSync] Scan complete: ${changedDocs.length}/${allDocs.length} changed (${scanTime}ms)`
  );

  return changedDocs;
}

// ============================================================================
// 资源增量扫描
// ============================================================================

/**
 * 获取所有资源的元数据（带时间戳）
 */
async function getAllAssetMetadata(): Promise<AssetMetadata[]> {
  await logInfo("[IncrementalSync] Fetching all asset metadata");

  const response = await fetch("/api/file/readDir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "/data/assets" })
  });

  const result = await response.json();

  if (result.code !== 0) {
    await logError(`Failed to read assets: ${result.msg}`);
    return [];
  }

  const assets: AssetMetadata[] = (result.data || [])
    .filter((file: any) => !file.isDir)
    .map((file: any) => ({
      path: file.name,
      size: file.size || 0,
      mtime: file.updated || Date.now()  // 文件修改时间
    }));

  await logInfo(`[IncrementalSync] Found ${assets.length} assets`);
  return assets;
}

/**
 * 筛选需要同步的资源（基于时间戳）
 */
export async function getChangedAssets(
  plugin: Plugin,
  allAssets: AssetMetadata[],
  lastSyncTime: number
): Promise<AssetMetadata[]> {
  const startTime = Date.now();
  const changedAssets: AssetMetadata[] = [];

  // 安全的时间格式化
  let lastSyncTimeStr = 'never';
  if (typeof lastSyncTime === 'number' && lastSyncTime > 0 && !isNaN(lastSyncTime)) {
    try {
      lastSyncTimeStr = new Date(lastSyncTime).toISOString();
    } catch (e) {
      lastSyncTimeStr = 'invalid';
    }
  }
  await logInfo(`[IncrementalSync] Scanning ${allAssets.length} assets for changes since ${lastSyncTimeStr}`);

  for (const asset of allAssets) {
    try {
      // 检查文件修改时间
      if (asset.mtime > lastSyncTime) {
        // 文件修改时间晚于上次同步 → 新增或修改
        changedAssets.push(asset);
        await logInfo(`[IncrementalSync] Changed asset: ${asset.path}`);
        continue;
      }

      // 双重检查：查询缓存确认
      const cached = await getAssetCacheEntry(plugin, asset.path);
      if (!cached) {
        // 缓存不存在但文件存在 → 新文件
        changedAssets.push(asset);
        await logInfo(`[IncrementalSync] New asset: ${asset.path}`);
      }
    } catch (error) {
      await logError(`[IncrementalSync] Error checking asset ${asset.path}: ${error}`);
      // 出错时保守处理：认为资源已变化
      changedAssets.push(asset);
    }
  }

  const scanTime = Date.now() - startTime;
  await logInfo(
    `[IncrementalSync] Asset scan complete: ${changedAssets.length}/${allAssets.length} changed (${scanTime}ms)`
  );

  return changedAssets;
}

// ============================================================================
// 增量同步主函数
// ============================================================================

/**
 * 执行增量同步
 */
export async function performIncrementalSync(
  plugin: Plugin,
  settings: Settings,
  onProgress?: (message: string) => void
): Promise<IncrementalSyncResult> {
  const startTime = Date.now();
  const result: IncrementalSyncResult = {
    docsScanned: 0,
    docsChanged: 0,
    docsUploaded: 0,
    docsSkipped: 0,
    docsFailed: 0,
    assetsScanned: 0,
    assetsChanged: 0,
    assetsUploaded: 0,
    assetsSkipped: 0,
    assetsFailed: 0,
    totalTime: 0,
    errors: []
  };

  await logInfo("[IncrementalSync] Starting incremental sync");
  onProgress?.("Starting incremental sync...");

  try {
    // ========== 第一阶段: 同步文档 ==========
    if (settings.autoSync.syncDocs) {
      // Step 1/6: Scan documents
      onProgress?.("[Step 1/6 Scan documents] Loading document metadata...");
      const allDocs = await getAllDocMetadata();
      result.docsScanned = allDocs.length;
      await logInfo(`[IncrementalSync] Step 1/6: Scanned ${allDocs.length} documents`);

      // Step 2/6: Check document changes (use allDocs from Step 1)
      onProgress?.("[Step 2/6 Check changes] Comparing documents with cache...");
      const changedDocs = await getChangedDocuments(plugin, allDocs);
      result.docsChanged = changedDocs.length;
      await logInfo(`[IncrementalSync] Step 2/6: Found ${changedDocs.length} changed documents`);

      // Step 3/6: Upload documents
      if (changedDocs.length > 0) {
        onProgress?.(`[Step 3/6 Upload docs] Uploading ${changedDocs.length} documents...`);

        for (let i = 0; i < changedDocs.length; i++) {
          const doc = changedDocs[i];
          try {
            onProgress?.(`[Step 3/6] [${i + 1}/${changedDocs.length}] ${doc.name}`);

            // 调用现有的导出函数（跳过assets，会在后面统一处理）
            await exportCurrentDocToGit(
              plugin,
              doc.id,
              doc.id,
              settings,
              (msg) => onProgress?.(`  ${msg}`),
              true // skipAssets = true
            );

            result.docsUploaded++;
          } catch (error) {
            result.docsFailed++;
            result.errors.push({
              path: `doc:${doc.id}`,
              error: error.message || String(error)
            });
            await logError(`[IncrementalSync] Failed to sync doc ${doc.id}: ${error}`);
          }
        }
        await logInfo(`[IncrementalSync] Step 3/6: Uploaded ${result.docsUploaded}/${changedDocs.length} documents`);
      } else {
        onProgress?.("[Step 3/6 Upload docs] No documents to upload");
        await logInfo("[IncrementalSync] Step 3/6: No document changes detected");
      }
    } else {
      onProgress?.("[Step 1-3/6] Document sync disabled");
      await logInfo("[IncrementalSync] Steps 1-3/6: Document sync disabled in settings");
    }

    // ========== 第二阶段: 同步资源 ==========
    if (settings.autoSync.syncAssets) {
      // Step 4/6: Scan assets
      onProgress?.("[Step 4/6 Scan assets] Loading asset metadata...");
      const allAssets = await getAllAssetMetadata();
      result.assetsScanned = allAssets.length;
      await logInfo(`[IncrementalSync] Step 4/6: Scanned ${allAssets.length} assets`);

      // Step 5/6: Check asset changes (use allAssets from Step 4)
      onProgress?.("[Step 5/6 Check changes] Comparing assets with cache...");
      const lastAssetSyncTime = await getLastAssetSyncTime(plugin);
      const changedAssets = await getChangedAssets(plugin, allAssets, lastAssetSyncTime);
      result.assetsChanged = changedAssets.length;
      await logInfo(`[IncrementalSync] Step 5/6: Found ${changedAssets.length} changed assets`);

      // Step 6/6: Upload assets
      if (changedAssets.length > 0) {
        onProgress?.(`[Step 6/6 Upload assets] Uploading ${changedAssets.length} assets...`);

        // 并发控制
        const CONCURRENCY = settings.autoSync.maxConcurrency || 5;
        for (let i = 0; i < changedAssets.length; i += CONCURRENCY) {
          const batch = changedAssets.slice(i, i + CONCURRENCY);

          const batchResults = await Promise.allSettled(
            batch.map((asset, idx) => {
              onProgress?.(`[Step 6/6] [${i + idx + 1}/${changedAssets.length}] ${asset.path}`);
              return uploadAssetWithCache(
                plugin,
                { path: asset.path, size: asset.size },
                settings
              );
            })
          );

          for (let j = 0; j < batchResults.length; j++) {
            const batchResult = batchResults[j];
            const asset = batch[j];

            if (batchResult.status === "fulfilled") {
              if (batchResult.value) {
                result.assetsUploaded++;
              } else {
                result.assetsSkipped++;
              }
            } else {
              result.assetsFailed++;
              result.errors.push({
                path: `asset:${asset.path}`,
                error: batchResult.reason?.message || "Unknown error"
              });
            }
          }
        }

        // 更新资源同步时间
        await updateLastAssetSyncTime(plugin, Date.now());
        await logInfo(`[IncrementalSync] Step 6/6: Uploaded ${result.assetsUploaded}/${changedAssets.length} assets`);
      } else {
        onProgress?.("[Step 6/6 Upload assets] No assets to upload");
        await logInfo("[IncrementalSync] Step 6/6: No asset changes detected");
      }
    } else {
      onProgress?.("[Step 4-6/6] Asset sync disabled");
      await logInfo("[IncrementalSync] Steps 4-6/6: Asset sync disabled in settings");
    }

    result.totalTime = Date.now() - startTime;

    await logInfo(
      `[IncrementalSync] Complete: ` +
      `Docs(${result.docsUploaded}/${result.docsChanged}), ` +
      `Assets(${result.assetsUploaded}/${result.assetsChanged}), ` +
      `Time: ${result.totalTime}ms`
    );

    return result;

  } catch (error) {
    await logError(`[IncrementalSync] Sync failed: ${error}`);
    throw error;
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

const LAST_ASSET_SYNC_KEY = "last-asset-sync-time";

async function getLastAssetSyncTime(plugin: Plugin): Promise<number> {
  const time = await plugin.loadData(LAST_ASSET_SYNC_KEY);
  return time || 0;
}

async function updateLastAssetSyncTime(plugin: Plugin, time: number): Promise<void> {
  await plugin.saveData(LAST_ASSET_SYNC_KEY, time);
}
