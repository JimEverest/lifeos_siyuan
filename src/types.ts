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
