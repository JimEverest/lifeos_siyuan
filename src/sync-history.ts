/**
 * Sync History Manager
 *
 * 同步历史记录管理器
 * - 记录每次同步的详细信息
 * - 最多保存100条记录
 * - 支持按设备、时间筛选
 */

import type { Plugin } from "siyuan";
import type { SyncHistoryRecord, SyncHistoryData, SyncStatistics, IncrementalSyncResult } from "./types";
import { logInfo, logError } from "./logger";
import { getFullIdentity, isBrowserEnvironment } from "./device-manager";

const HISTORY_FILE = "sync-history.json";
const STATS_FILE = "sync-stats.json";
const MAX_RECORDS = 100;

// ============================================================================
// History Data Management
// ============================================================================

/**
 * 加载同步历史数据
 */
export async function loadSyncHistory(plugin: Plugin): Promise<SyncHistoryData> {
  try {
    const data = await plugin.loadData(HISTORY_FILE);
    if (data && data.records) {
      return data as SyncHistoryData;
    }
  } catch (error) {
    await logError("[SyncHistory] Failed to load history", error);
  }

  // 返回默认值
  return {
    records: [],
    maxRecords: MAX_RECORDS,
    lastUpdated: Date.now()
  };
}

/**
 * 保存同步历史数据
 */
export async function saveSyncHistory(plugin: Plugin, history: SyncHistoryData): Promise<void> {
  try {
    history.lastUpdated = Date.now();
    await plugin.saveData(HISTORY_FILE, history);
  } catch (error) {
    await logError("[SyncHistory] Failed to save history", error);
  }
}

/**
 * 添加一条同步记录
 */
export async function addSyncRecord(
  plugin: Plugin,
  result: IncrementalSyncResult | null,
  triggerType: 'auto' | 'manual' | 'force',
  skippedReason?: string,
  errorMessage?: string
): Promise<void> {
  const history = await loadSyncHistory(plugin);
  const identity = getFullIdentity();
  const isBrowser = isBrowserEnvironment();

  // 记录 ID：包含 Tab ID 以确保唯一性
  const recordId = isBrowser
    ? `${Date.now()}-${identity.device.deviceId.substring(0, 8)}-${identity.tab.tabId}`
    : `${Date.now()}-${identity.device.deviceId.substring(0, 8)}`;

  const record: SyncHistoryRecord = {
    id: recordId,
    timestamp: Date.now(),
    deviceId: identity.device.deviceId,
    deviceName: identity.displayName,  // 包含Tab标识，如 "Browser-192.168.1.1 #3"
    tabId: isBrowser ? identity.tab.tabId : undefined,
    tabName: isBrowser ? identity.tab.tabName : undefined,
    triggerType: triggerType,

    docsScanned: result?.docsScanned ?? 0,
    docsChanged: result?.docsChanged ?? 0,
    docsUploaded: result?.docsUploaded ?? 0,
    docsSkipped: result?.docsSkipped ?? 0,
    docsFailed: result?.docsFailed ?? 0,

    assetsScanned: result?.assetsScanned ?? 0,
    assetsChanged: result?.assetsChanged ?? 0,
    assetsUploaded: result?.assetsUploaded ?? 0,
    assetsSkipped: result?.assetsSkipped ?? 0,
    assetsFailed: result?.assetsFailed ?? 0,

    duration: result?.totalTime ?? 0,
    success: result !== null && !errorMessage,
    skippedReason: skippedReason,
    errorMessage: errorMessage
  };

  // 添加到历史记录开头
  history.records.unshift(record);

  // 限制记录数量
  if (history.records.length > history.maxRecords) {
    history.records = history.records.slice(0, history.maxRecords);
  }

  await saveSyncHistory(plugin, history);
  await logInfo(`[SyncHistory] Record added: ${record.id}, success=${record.success}`);

  // 同时更新统计数据
  await updateStatistics(plugin, record);
}

/**
 * 获取最近的同步记录
 */
export async function getRecentRecords(
  plugin: Plugin,
  limit: number = 20
): Promise<SyncHistoryRecord[]> {
  const history = await loadSyncHistory(plugin);
  return history.records.slice(0, limit);
}

/**
 * 获取指定设备的同步记录
 */
export async function getRecordsByDevice(
  plugin: Plugin,
  deviceId: string
): Promise<SyncHistoryRecord[]> {
  const history = await loadSyncHistory(plugin);
  return history.records.filter(r => r.deviceId === deviceId);
}

/**
 * 清空同步历史
 */
export async function clearSyncHistory(plugin: Plugin): Promise<void> {
  const emptyHistory: SyncHistoryData = {
    records: [],
    maxRecords: MAX_RECORDS,
    lastUpdated: Date.now()
  };
  await saveSyncHistory(plugin, emptyHistory);
  await logInfo("[SyncHistory] History cleared");
}

// ============================================================================
// Statistics Management
// ============================================================================

/**
 * 加载同步统计数据
 */
export async function loadSyncStatistics(plugin: Plugin): Promise<SyncStatistics> {
  try {
    const data = await plugin.loadData(STATS_FILE);
    if (data && typeof data.totalSyncCount === 'number') {
      return data as SyncStatistics;
    }
  } catch (error) {
    await logError("[SyncHistory] Failed to load statistics", error);
  }

  // 返回默认值
  return {
    totalDocsUploaded: 0,
    totalAssetsUploaded: 0,
    totalSyncCount: 0,
    totalSyncTime: 0,
    cacheHits: 0,
    cacheMisses: 0,
    deviceSyncStats: {},
    recentDocsUploaded: 0,
    recentAssetsUploaded: 0,
    recentSyncCount: 0,
    firstSyncTime: 0,
    lastSyncTime: 0,
    lastUpdated: Date.now()
  };
}

/**
 * 保存同步统计数据
 */
export async function saveSyncStatistics(plugin: Plugin, stats: SyncStatistics): Promise<void> {
  try {
    stats.lastUpdated = Date.now();
    await plugin.saveData(STATS_FILE, stats);
  } catch (error) {
    await logError("[SyncHistory] Failed to save statistics", error);
  }
}

/**
 * 更新统计数据
 */
async function updateStatistics(plugin: Plugin, record: SyncHistoryRecord): Promise<void> {
  const stats = await loadSyncStatistics(plugin);

  // 累计统计
  if (record.success) {
    stats.totalDocsUploaded += record.docsUploaded;
    stats.totalAssetsUploaded += record.assetsUploaded;
    stats.totalSyncCount += 1;
    stats.totalSyncTime += record.duration;

    // 缓存统计
    stats.cacheHits += record.docsSkipped + record.assetsSkipped;
    stats.cacheMisses += record.docsUploaded + record.assetsUploaded;
  }

  // 设备统计
  if (!stats.deviceSyncStats[record.deviceId]) {
    stats.deviceSyncStats[record.deviceId] = {
      deviceName: record.deviceName,
      lastSyncTime: 0,
      syncCount: 0
    };
  }
  stats.deviceSyncStats[record.deviceId].deviceName = record.deviceName;
  stats.deviceSyncStats[record.deviceId].lastSyncTime = record.timestamp;
  stats.deviceSyncStats[record.deviceId].syncCount += 1;

  // 首次同步时间
  if (stats.firstSyncTime === 0) {
    stats.firstSyncTime = record.timestamp;
  }
  stats.lastSyncTime = record.timestamp;

  // 更新最近统计（需要重新计算）
  await recalculateRecentStats(plugin, stats);

  await saveSyncStatistics(plugin, stats);
}

/**
 * 重新计算最近24小时的统计数据
 */
async function recalculateRecentStats(plugin: Plugin, stats: SyncStatistics): Promise<void> {
  const history = await loadSyncHistory(plugin);
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  let recentDocs = 0;
  let recentAssets = 0;
  let recentCount = 0;

  for (const record of history.records) {
    if (record.timestamp >= oneDayAgo && record.success) {
      recentDocs += record.docsUploaded;
      recentAssets += record.assetsUploaded;
      recentCount += 1;
    }
  }

  stats.recentDocsUploaded = recentDocs;
  stats.recentAssetsUploaded = recentAssets;
  stats.recentSyncCount = recentCount;
}

/**
 * 增加缓存命中计数
 */
export async function incrementCacheHit(plugin: Plugin, count: number = 1): Promise<void> {
  const stats = await loadSyncStatistics(plugin);
  stats.cacheHits += count;
  await saveSyncStatistics(plugin, stats);
}

/**
 * 增加缓存未命中计数
 */
export async function incrementCacheMiss(plugin: Plugin, count: number = 1): Promise<void> {
  const stats = await loadSyncStatistics(plugin);
  stats.cacheMisses += count;
  await saveSyncStatistics(plugin, stats);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * 格式化持续时间
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * 格式化时间戳为可读时间
 */
export function formatTimestamp(timestamp: number): string {
  if (timestamp === 0) return "Never";
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * 格式化相对时间（如"5分钟前"）
 */
export function formatRelativeTime(timestamp: number): string {
  if (timestamp === 0) return "Never";

  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    return "Just now";
  } else if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  } else if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  } else {
    const days = Math.floor(diff / 86400000);
    return `${days}d ago`;
  }
}

/**
 * 计算缓存命中率
 */
export function calculateCacheHitRate(stats: SyncStatistics): string {
  const total = stats.cacheHits + stats.cacheMisses;
  if (total === 0) return "N/A";
  const rate = (stats.cacheHits / total) * 100;
  return `${rate.toFixed(1)}%`;
}
