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
