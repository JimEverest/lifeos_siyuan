export interface Settings {
  repoUrl: string;
  branch: string;
  token: string;
  exportRoot: string;
  assetsDir: string;
  cleanFrontmatter: boolean;
  exportAllAssets: boolean;
  ignoreNotebooks: string[];
  ignorePaths: string[];
  ignoreTags: string[];
  autoSync: AutoSyncConfig;      // 自动同步配置
  syncLock: SyncLockConfig;      // 分布式锁配置
}

export interface RepoInfo {
  owner: string;
  repo: string;
}

export interface GitWriteOptions {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  path: string;
  contentBase64: string;
  message: string;
}

export interface DocInfo {
  docId: string;
  title: string;
  notebookId: string;
  hpath: string;
}

// ============================================================================
// Cache Types
// ============================================================================

export interface DocCacheEntry {
  docId: string;
  notebookId: string;
  githubPath: string;
  contentHash: string;
  githubSHA: string;
  lastSyncTime: number;
  siyuanUpdated: number;
}

export interface NotebookDocCache {
  [docId: string]: DocCacheEntry;
}

export interface AssetCacheEntry {
  assetPath: string;
  contentHash: string;
  githubSHA: string;
  lastSyncTime: number;
  fileSize: number;
}

export interface AssetCache {
  [assetPath: string]: AssetCacheEntry;
}

export interface NotebookMeta {
  notebookId: string;
  notebookName: string;
  docCount: number;
  lastSyncTime: number;
}

export interface SyncMeta {
  lastFullSync: number;
  notebooks: {
    [notebookId: string]: NotebookMeta;
  };
}

export interface AssetFile {
  path: string;
  size: number;
}

export interface AssetSyncResult {
  total: number;
  uploaded: number;
  skipped: number;
  failed: number;
  errors: Array<{ path: string; error: string }>;
}

// ============================================================================
// Auto Sync Types
// ============================================================================

export interface AutoSyncConfig {
  enabled: boolean;              // 是否启用自动同步
  interval: number;              // 同步间隔（分钟）
  syncDocs: boolean;             // 同步文档
  syncAssets: boolean;           // 同步资源
  onlyWhenIdle: boolean;         // 仅在空闲时同步
  maxConcurrency: number;        // 最大并发数
}

// ============================================================================
// Sync Lock Types (分布式锁)
// ============================================================================

export interface SyncLockConfig {
  enabled: boolean;              // 是否启用分布式锁
  lockTtl: number;               // 锁超时时间（毫秒），默认 600000 (10分钟)
  firstCheckThreshold: number;   // 第一次检查阈值（毫秒），默认 600000 (10分钟)
  secondCheckThreshold: number;  // 第二次检查阈值（毫秒），默认 300000 (5分钟)
  jitterRange: number;           // 随机等待范围（毫秒），默认 15000 (15秒)
}

export interface IncrementalSyncResult {
  docsScanned: number;           // 扫描的文档数
  docsChanged: number;           // 变化的文档数
  docsUploaded: number;          // 上传的文档数
  docsSkipped: number;           // 跳过的文档数
  docsFailed: number;            // 失败的文档数
  assetsScanned: number;         // 扫描的资源数
  assetsChanged: number;         // 变化的资源数
  assetsUploaded: number;        // 上传的资源数
  assetsSkipped: number;         // 跳过的资源数
  assetsFailed: number;          // 失败的资源数
  totalTime: number;             // 总耗时（毫秒）
  errors: Array<{ path: string; error: string }>;
}

export interface DocMetadata {
  id: string;
  box: string;
  path: string;
  hpath: string;
  name: string;
  updated: number;               // SiYuan 更新时间戳
}

export interface AssetMetadata {
  path: string;
  size: number;
  mtime: number;                 // 文件修改时间戳
}

// ============================================================================
// Sync History Types (同步历史)
// ============================================================================

export interface SyncHistoryRecord {
  id: string;                    // 唯一ID (timestamp-deviceId-tabId)
  timestamp: number;             // 同步开始时间戳
  deviceId: string;              // 设备ID
  deviceName: string;            // 设备名称（含Tab标识，如 "Browser-192.168.1.1 #3"）
  tabId?: string;                // Tab会话ID（仅浏览器环境）
  tabName?: string;              // Tab名称（如 "#3"）
  triggerType: 'auto' | 'manual' | 'force';  // 触发类型

  // 同步结果
  docsScanned: number;
  docsChanged: number;
  docsUploaded: number;
  docsSkipped: number;
  docsFailed: number;

  assetsScanned: number;
  assetsChanged: number;
  assetsUploaded: number;
  assetsSkipped: number;
  assetsFailed: number;

  duration: number;              // 同步耗时（毫秒）
  success: boolean;              // 是否成功
  skippedReason?: string;        // 跳过原因（如被锁阻止）
  errorMessage?: string;         // 错误信息
}

export interface SyncHistoryData {
  records: SyncHistoryRecord[];
  maxRecords: number;            // 最大保存记录数
  lastUpdated: number;           // 最后更新时间
}

// ============================================================================
// Sync Statistics Types (同步统计)
// ============================================================================

export interface SyncStatistics {
  // 累计统计
  totalDocsUploaded: number;
  totalAssetsUploaded: number;
  totalSyncCount: number;
  totalSyncTime: number;         // 累计同步时间（毫秒）

  // 缓存统计
  cacheHits: number;
  cacheMisses: number;

  // 设备统计
  deviceSyncStats: {
    [deviceId: string]: {
      deviceName: string;
      lastSyncTime: number;
      syncCount: number;
    };
  };

  // 最近统计（过去24小时）
  recentDocsUploaded: number;
  recentAssetsUploaded: number;
  recentSyncCount: number;

  // 元数据
  firstSyncTime: number;
  lastSyncTime: number;
  lastUpdated: number;
}
