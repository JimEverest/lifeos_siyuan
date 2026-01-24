/**
 * Incremental Sync Module
 *
 * 实现基于时间戳的增量同步，避免全量扫描
 * v0.4.3: 添加分布式锁机制，防止多设备同时同步
 */

import type { Plugin } from "siyuan";
import type { Settings, IncrementalSyncResult, DocMetadata, AssetMetadata, SyncLockConfig } from "./types";
import { logInfo, logError, flushAllLogs } from "./logger";
import { getDocCacheEntry, updateDocCacheEntry, clearMemoryCache } from "./cache-manager";
import { getAssetCacheEntry, updateAssetCacheEntry } from "./cache-manager";
import { exportCurrentDocToGit } from "./exporter";
import { uploadAssetWithCache } from "./assets-sync";
import { listNotebooks, getDocInfo, clearNotebooksCache } from "./siyuan-api";
import {
  acquireSyncLock,
  releaseSyncLock,
  createSyncLock,
  SyncLockCheckResult
} from "./sync-lock";
import { getDeviceName } from "./device-manager";
import {
  showJitterCountdown,
  showSyncSkippedStatus,
  showSyncCompleteStatus,
  showSyncErrorStatus,
  showForceSyncStatus
} from "./ui";
import { addSyncRecord } from "./sync-history";

// ============================================================================
// 文档增量扫描
// ============================================================================

/**
 * 获取所有文档的元数据（轻量级查询）
 */
async function getAllDocMetadata(): Promise<DocMetadata[]> {
  await logInfo("[IncrementalSync] Fetching all document metadata");

  // 使用 SiYuan SQL API 批量查询文档元数据
  // 注意：必须明确指定LIMIT，否则API默认只返回64条
  const response = await fetch("/api/query/sql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stmt: `SELECT id, box, path, hpath, content AS name, updated
             FROM blocks
             WHERE type = 'd'
             ORDER BY updated DESC
             LIMIT 999999`
    })
  });

  const result = await response.json();

  if (result.code !== 0) {
    await logError(`Failed to query documents: ${result.msg}`);
    return [];
  }

  const rawData = result.data || [];
  await logInfo(`[IncrementalSync] SQL returned ${rawData.length} rows`);

  // Debug: Count filter reasons
  let filteredNoId = 0;
  let filteredPlugins = 0;
  let filteredNoTimestamp = 0;
  let passed = 0;

  const docs: DocMetadata[] = rawData
    .filter((row: any) => {
      // 过滤掉无效的文档
      if (!row.id || !row.box) {
        filteredNoId++;
        return false;
      }
      // 只过滤掉特殊的 plugins box
      if (row.box === 'plugins') {
        filteredPlugins++;
        return false;
      }
      // 过滤掉没有有效时间戳的文档
      if (!row.updated || typeof row.updated !== 'string') {
        filteredNoTimestamp++;
        return false;
      }
      passed++;
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

  await logInfo(`[IncrementalSync] Filter results: ${rawData.length} total → ${filteredNoId} no id/box, ${filteredPlugins} plugins, ${filteredNoTimestamp} no timestamp → ${passed} passed`);
  await logInfo(`[IncrementalSync] Found ${docs.length} documents`);

  // Debug: Log first 10 box IDs to see what notebooks we have
  const boxIds = new Set(docs.map(d => d.box));
  await logInfo(`[IncrementalSync] Unique notebooks (${boxIds.size}): ${Array.from(boxIds).slice(0, 20).join(', ')}`);

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
 * 筛选需要同步的资源
 *
 * 注意：不再使用mtime判断，因为多端同步时mtime会不同，导致重复上传
 * 改为只检查缓存是否存在：
 * - 缓存不存在 → 新文件，需要上传
 * - 缓存存在 → 跳过（由uploadAssetWithCache的hash检查作为二次验证）
 */
export async function getChangedAssets(
  plugin: Plugin,
  allAssets: AssetMetadata[],
  lastSyncTime: number
): Promise<AssetMetadata[]> {
  const startTime = Date.now();
  const changedAssets: AssetMetadata[] = [];

  await logInfo(`[IncrementalSync] Checking ${allAssets.length} assets (cache-only, no mtime check)`);

  for (const asset of allAssets) {
    try {
      // 只检查缓存是否存在，不检查mtime
      const cached = await getAssetCacheEntry(plugin, asset.path);
      if (!cached) {
        // 缓存不存在 → 新文件，需要上传
        changedAssets.push(asset);
        await logInfo(`[IncrementalSync] New asset (no cache): ${asset.path}`);
      }
      // 如果缓存存在，跳过（相信缓存记录）
      // uploadAssetWithCache内部还会做hash检查作为二次验证
    } catch (error) {
      await logError(`[IncrementalSync] Error checking asset ${asset.path}: ${error}`);
      // 出错时保守处理：认为资源已变化
      changedAssets.push(asset);
    }
  }

  const scanTime = Date.now() - startTime;
  await logInfo(
    `[IncrementalSync] Asset scan complete: ${changedAssets.length}/${allAssets.length} new assets (${scanTime}ms)`
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

  // 清空内存缓存，确保本次sync使用新鲜数据
  clearMemoryCache();
  clearNotebooksCache();
  await logInfo("[IncrementalSync] Memory cache cleared");

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
            // 调用现有的导出函数（跳过assets，会在后面统一处理）
            // 将进度信息传递到exporter内部的每个步骤
            const progressPrefix = `[Step 3/6] [${i + 1}/${changedDocs.length}]`;
            await exportCurrentDocToGit(
              plugin,
              doc.id,
              doc.id,
              settings,
              (msg) => onProgress?.(`${progressPrefix} ${msg}`),
              true // skipAssets = true
            );

            result.docsUploaded++;
          } catch (error) {
            result.docsFailed++;
            const errorMsg = error instanceof Error ? error.message : String(error);
            result.errors.push({
              path: `doc:${doc.id}`,
              error: errorMsg
            });
            await logError(`[IncrementalSync] Failed to sync doc ${doc.id}: ${errorMsg}`);
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

    // Flush logs to file (one-time write)
    await flushAllLogs();

    return result;

  } catch (error) {
    await logError(`[IncrementalSync] Sync failed: ${error}`);

    // Flush logs even on error
    await flushAllLogs();

    throw error;
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

const LAST_ASSET_SYNC_KEY = "last-asset-sync-time";

async function getLastAssetSyncTime(plugin: Plugin): Promise<number> {
  const time = await plugin.loadData(LAST_ASSET_SYNC_KEY) as number | null | undefined;
  return time || 0;
}

async function updateLastAssetSyncTime(plugin: Plugin, time: number): Promise<void> {
  await plugin.saveData(LAST_ASSET_SYNC_KEY, time);
}

// ============================================================================
// 带分布式锁的增量同步
// ============================================================================

/**
 * 带锁的增量同步结果
 */
export interface LockedSyncResult {
  executed: boolean;           // 同步是否执行
  skippedReason?: string;      // 跳过原因（如果未执行）
  result?: IncrementalSyncResult;  // 同步结果（如果执行了）
  error?: string;              // 错误信息
}

/**
 * 带分布式锁的增量同步
 *
 * 工作流程：
 * 1. 检查锁和最近 commit 时间
 * 2. 随机等待（jitter）
 * 3. 二次检查
 * 4. 创建锁文件
 * 5. 执行同步
 * 6. 释放锁文件
 */
export async function performIncrementalSyncWithLock(
  plugin: Plugin,
  settings: Settings,
  statusBarEl: HTMLElement | null,
  onProgress?: (message: string) => void
): Promise<LockedSyncResult> {
  const deviceName = getDeviceName();
  await logInfo(`[IncrementalSync] Starting sync with lock for device: ${deviceName}`);

  // 获取锁配置
  const lockSettings: SyncLockConfig = settings.syncLock || {
    enabled: true,
    lockTtl: 10 * 60 * 1000,
    firstCheckThreshold: 10 * 60 * 1000,
    secondCheckThreshold: 5 * 60 * 1000,
    jitterRange: 15 * 1000
  };

  // 如果锁机制禁用，直接执行同步
  if (!lockSettings.enabled) {
    await logInfo(`[IncrementalSync] Lock mechanism disabled, proceeding directly`);
    try {
      const result = await performIncrementalSync(plugin, settings, onProgress);
      return { executed: true, result };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      showSyncErrorStatus(statusBarEl, errorMsg);
      return { executed: false, error: errorMsg };
    }
  }

  // 尝试获取锁
  const lockResult = await acquireSyncLock(
    settings,
    lockSettings,
    onProgress,
    (remaining) => showJitterCountdown(statusBarEl, remaining)
  );

  if (!lockResult.canSync) {
    // 无法获取锁，显示原因并返回
    const reason = lockResult.reason || "Unknown reason";
    await logInfo(`[IncrementalSync] Sync skipped: ${reason}`);
    showSyncSkippedStatus(statusBarEl, reason);

    // 记录跳过的同步
    await addSyncRecord(plugin, null, 'auto', reason);

    return { executed: false, skippedReason: reason };
  }

  // 成功获取锁，执行同步
  try {
    await logInfo(`[IncrementalSync] Lock acquired, starting sync`);
    const result = await performIncrementalSync(plugin, settings, onProgress);

    // 显示完成状态
    const timeSeconds = result.totalTime / 1000;
    showSyncCompleteStatus(statusBarEl, result.docsUploaded, result.assetsUploaded, timeSeconds);

    // 记录成功的同步
    await addSyncRecord(plugin, result, 'auto');

    return { executed: true, result };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await logError(`[IncrementalSync] Sync failed: ${errorMsg}`);
    showSyncErrorStatus(statusBarEl, errorMsg);

    // 记录失败的同步
    await addSyncRecord(plugin, null, 'auto', undefined, errorMsg);

    return { executed: false, error: errorMsg };

  } finally {
    // 始终释放锁
    await logInfo(`[IncrementalSync] Releasing lock`);
    await releaseSyncLock(settings);
  }
}

/**
 * 强制同步（无视锁和时间检查）
 */
export async function performForceSyncWithLock(
  plugin: Plugin,
  settings: Settings,
  statusBarEl: HTMLElement | null,
  onProgress?: (message: string) => void
): Promise<LockedSyncResult> {
  const deviceName = getDeviceName();
  await logInfo(`[IncrementalSync] Starting FORCE sync for device: ${deviceName}`);

  showForceSyncStatus(statusBarEl);

  // 获取锁配置
  const lockSettings: SyncLockConfig = settings.syncLock || {
    enabled: true,
    lockTtl: 10 * 60 * 1000,
    firstCheckThreshold: 10 * 60 * 1000,
    secondCheckThreshold: 5 * 60 * 1000,
    jitterRange: 15 * 1000
  };

  // 强制创建锁（覆盖现有锁）
  if (lockSettings.enabled) {
    await logInfo(`[IncrementalSync] Force creating lock`);
    await createSyncLock(settings, lockSettings);
  }

  // 执行同步
  try {
    const result = await performIncrementalSync(plugin, settings, onProgress);

    // 显示完成状态
    const timeSeconds = result.totalTime / 1000;
    showSyncCompleteStatus(statusBarEl, result.docsUploaded, result.assetsUploaded, timeSeconds);

    // 记录强制同步
    await addSyncRecord(plugin, result, 'force');

    return { executed: true, result };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await logError(`[IncrementalSync] Force sync failed: ${errorMsg}`);
    showSyncErrorStatus(statusBarEl, errorMsg);

    // 记录强制同步失败
    await addSyncRecord(plugin, null, 'force', undefined, errorMsg);

    return { executed: false, error: errorMsg };

  } finally {
    // 始终释放锁
    if (lockSettings.enabled) {
      await logInfo(`[IncrementalSync] Releasing lock after force sync`);
      await releaseSyncLock(settings);
    }
  }
}
