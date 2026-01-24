/**
 * Cache Rebuild Module
 *
 * 从 GitHub 重建本地缓存
 * - 获取 GitHub 上的文件树
 * - 与本地文档/资源比较
 * - 重建缓存文件（无需重新上传）
 */

import type { Plugin } from "siyuan";
import type { Settings, DocCacheEntry, AssetCacheEntry, DocMetadata } from "./types";
import { logInfo, logError, flushAllLogs } from "./logger";
import { calculateGitBlobSHA, calculateGitBlobSHABinary, getGitHubFileTree, parseRepoUrl, isFallbackHash } from "./git-utils";
import { exportMarkdown, readDir, getFileBlob } from "./siyuan-api";
import {
  loadNotebookDocCache,
  saveNotebookDocCache,
  clearMemoryCache,
} from "./cache-manager";
import { calculateHash, calculateShardHash } from "./hash-utils";

// ============================================================================
// Types
// ============================================================================

export interface RebuildProgress {
  phase: "init" | "fetch-tree" | "scan-docs" | "scan-assets" | "complete" | "error";
  current: number;
  total: number;
  message: string;
  docsMatched: number;
  docsPending: number;
  assetsMatched: number;
  assetsPending: number;
}

export interface RebuildResult {
  success: boolean;
  docsMatched: number;
  docsPending: number;
  assetsMatched: number;
  assetsPending: number;
  duration: number;
  error?: string;
  truncated?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 获取所有文档的元数据
 * 复用自 incremental-sync.ts 的逻辑
 */
async function getAllDocMetadataForRebuild(): Promise<DocMetadata[]> {
  await logInfo("[CacheRebuild] Fetching all document metadata");

  const response = await fetch("/api/query/sql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stmt: `SELECT id, box, path, hpath, content as name, updated
             FROM blocks
             WHERE type = 'd'
             LIMIT 50000`,
    }),
  });

  const result = await response.json();
  const rawData = result.data || [];

  const docs: DocMetadata[] = rawData
    .filter((row: any) => {
      if (!row.id || !row.box) return false;
      if (!row.updated || row.updated === "0" || row.updated === 0) return false;
      return true;
    })
    .map((row: any) => ({
      id: row.id,
      box: row.box,
      path: row.path || "",
      hpath: row.hpath || "",
      name: row.name || "untitled",
      updated: parseInt(row.updated, 10) || 0,
    }));

  await logInfo(`[CacheRebuild] Found ${docs.length} documents`);
  return docs;
}

/**
 * 构建文档在 GitHub 上的路径
 */
function buildGitHubDocPath(
  doc: DocMetadata,
  exportRoot: string,
  notebookName: string
): string {
  const sanitize = (s: string) => (s || "").replace(/[<>:"/\\|?*]/g, "_").trim() || "untitled";

  const hpathParts = (doc.hpath || "")
    .split("/")
    .filter(Boolean)
    .slice(0, -1); // Remove last part (it's the doc title)

  const title = doc.name || "untitled";

  const parts = [
    exportRoot,
    sanitize(notebookName),
    ...hpathParts.map(sanitize),
    `${sanitize(title)}.md`,
  ].filter(Boolean);

  return parts.join("/");
}

/**
 * 获取所有资源文件
 */
async function getAllAssets(): Promise<Array<{ path: string; name: string }>> {
  await logInfo("[CacheRebuild] Scanning assets directory");

  try {
    const files = await readDir("/data/assets");
    const assets = files
      .filter((f: any) => !f.isDir)
      .map((f: any) => ({
        path: f.name,  // 使用文件名，与 assets-sync.ts 保持一致
        name: f.name,
      }));

    await logInfo(`[CacheRebuild] Found ${assets.length} assets`);
    return assets;
  } catch (error) {
    await logError("[CacheRebuild] Failed to scan assets", error);
    return [];
  }
}

/**
 * 获取笔记本名称映射
 */
async function getNotebookNameMap(): Promise<Map<string, string>> {
  const response = await fetch("/api/notebook/lsNotebooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const result = await response.json();
  const notebooks = result.data?.notebooks || [];

  const map = new Map<string, string>();
  for (const nb of notebooks) {
    map.set(nb.id, nb.name);
  }

  return map;
}

// ============================================================================
// Main Rebuild Function
// ============================================================================

/**
 * 从 GitHub 重建缓存
 *
 * @param plugin 插件实例
 * @param settings 设置
 * @param onProgress 进度回调
 * @returns 重建结果
 */
export async function rebuildCacheFromGitHub(
  plugin: Plugin,
  settings: Settings,
  onProgress?: (progress: RebuildProgress) => void
): Promise<RebuildResult> {
  const startTime = Date.now();
  let result: RebuildResult = {
    success: false,
    docsMatched: 0,
    docsPending: 0,
    assetsMatched: 0,
    assetsPending: 0,
    duration: 0,
  };

  try {
    // Clear memory cache
    clearMemoryCache();

    // ========================================================================
    // Phase 1: Parse settings and validate
    // ========================================================================
    onProgress?.({
      phase: "init",
      current: 0,
      total: 100,
      message: "Validating settings...",
      docsMatched: 0,
      docsPending: 0,
      assetsMatched: 0,
      assetsPending: 0,
    });

    const repoInfo = parseRepoUrl(settings.repoUrl);
    if (!repoInfo) {
      throw new Error("Invalid repository URL");
    }

    const { owner, repo } = repoInfo;
    const branch = settings.branch || "main";
    const token = settings.token;

    if (!token) {
      throw new Error("GitHub token is required");
    }

    await logInfo(`[CacheRebuild] Starting rebuild for ${owner}/${repo}@${branch}`);

    // ========================================================================
    // Phase 2: Fetch GitHub file tree
    // ========================================================================
    onProgress?.({
      phase: "fetch-tree",
      current: 5,
      total: 100,
      message: "Fetching file tree from GitHub...",
      docsMatched: 0,
      docsPending: 0,
      assetsMatched: 0,
      assetsPending: 0,
    });

    const { files: remoteFiles, truncated } = await getGitHubFileTree(owner, repo, branch, token);
    result.truncated = truncated;

    await logInfo(`[CacheRebuild] Remote file tree: ${remoteFiles.size} files`);

    if (truncated) {
      await logError("[CacheRebuild] Warning: File tree was truncated, some files may be missing");
    }

    // ========================================================================
    // Phase 3: Scan and match documents
    // ========================================================================
    onProgress?.({
      phase: "scan-docs",
      current: 10,
      total: 100,
      message: "Scanning local documents...",
      docsMatched: 0,
      docsPending: 0,
      assetsMatched: 0,
      assetsPending: 0,
    });

    const allDocs = await getAllDocMetadataForRebuild();
    const notebookNames = await getNotebookNameMap();
    const exportRoot = settings.exportRoot || "";

    // Group documents by notebook for batch cache updates
    const docsByNotebook = new Map<string, DocMetadata[]>();
    for (const doc of allDocs) {
      const list = docsByNotebook.get(doc.box) || [];
      list.push(doc);
      docsByNotebook.set(doc.box, list);
    }

    let docsProcessed = 0;
    const totalDocs = allDocs.length;

    for (const [notebookId, docs] of docsByNotebook) {
      const notebookName = notebookNames.get(notebookId) || notebookId;
      const cache = await loadNotebookDocCache(plugin, notebookId);

      for (const doc of docs) {
        docsProcessed++;

        // Update progress every 50 docs
        if (docsProcessed % 50 === 0) {
          const progress = 10 + Math.floor((docsProcessed / totalDocs) * 40);
          onProgress?.({
            phase: "scan-docs",
            current: progress,
            total: 100,
            message: `Processing document ${docsProcessed}/${totalDocs}...`,
            docsMatched: result.docsMatched,
            docsPending: result.docsPending,
            assetsMatched: result.assetsMatched,
            assetsPending: result.assetsPending,
          });
        }

        try {
          // Build expected GitHub path
          const githubPath = buildGitHubDocPath(doc, exportRoot, notebookName);

          // Check if file exists on GitHub
          const remoteSHA = remoteFiles.get(githubPath);

          if (!remoteSHA) {
            // File doesn't exist on GitHub, mark as pending
            result.docsPending++;
            continue;
          }

          // Export markdown and calculate Git Blob SHA
          const markdownResult = await exportMarkdown(doc.id);
          let markdown = markdownResult.content || "";

          // Apply the same transformations as in exporter
          if (settings.cleanFrontmatter) {
            markdown = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*/, "");
          }

          // Calculate Git Blob SHA
          const localSHA = await calculateGitBlobSHA(markdown);

          if (isFallbackHash(localSHA)) {
            // Fallback hash means we can't reliably compare
            result.docsPending++;
            continue;
          }

          if (localSHA === remoteSHA) {
            // Match! Create cache entry
            const contentHash = await calculateHash(markdown);

            const cacheEntry: DocCacheEntry = {
              docId: doc.id,
              notebookId: notebookId,
              githubPath: githubPath,
              contentHash: contentHash,
              githubSHA: remoteSHA,
              lastSyncTime: Date.now(),
              siyuanUpdated: doc.updated,
            };

            cache[doc.id] = cacheEntry;
            result.docsMatched++;
          } else {
            // Content differs, mark as pending
            result.docsPending++;
          }
        } catch (error) {
          await logError(`[CacheRebuild] Error processing doc ${doc.id}`, error);
          result.docsPending++;
        }
      }

      // Save notebook cache
      await saveNotebookDocCache(plugin, notebookId, cache);
    }

    await logInfo(`[CacheRebuild] Documents: ${result.docsMatched} matched, ${result.docsPending} pending`);

    // ========================================================================
    // Phase 4: Scan and match assets
    // ========================================================================
    onProgress?.({
      phase: "scan-assets",
      current: 55,
      total: 100,
      message: "Scanning local assets...",
      docsMatched: result.docsMatched,
      docsPending: result.docsPending,
      assetsMatched: 0,
      assetsPending: 0,
    });

    const allAssets = await getAllAssets();
    const assetsDir = settings.assetsDir || "assets";

    // Asset cache is sharded by hash
    const assetCacheShards = new Map<number, Record<string, AssetCacheEntry>>();

    let assetsProcessed = 0;
    const totalAssets = allAssets.length;

    for (const asset of allAssets) {
      assetsProcessed++;

      // Update progress every 100 assets
      if (assetsProcessed % 100 === 0) {
        const progress = 55 + Math.floor((assetsProcessed / totalAssets) * 40);
        onProgress?.({
          phase: "scan-assets",
          current: progress,
          total: 100,
          message: `Processing asset ${assetsProcessed}/${totalAssets}...`,
          docsMatched: result.docsMatched,
          docsPending: result.docsPending,
          assetsMatched: result.assetsMatched,
          assetsPending: result.assetsPending,
        });
      }

      try {
        // Build expected GitHub path
        const githubPath = `${assetsDir}/${asset.name}`;

        // Check if file exists on GitHub
        const remoteSHA = remoteFiles.get(githubPath);

        if (!remoteSHA) {
          // File doesn't exist on GitHub
          result.assetsPending++;
          continue;
        }

        // Get asset content (asset.path 是文件名，需要加上 assets/ 前缀)
        const blob = await getFileBlob(`/data/assets/${asset.path}`);
        if (!blob) {
          result.assetsPending++;
          continue;
        }

        const arrayBuffer = await blob.arrayBuffer();

        // Calculate Git Blob SHA for binary content
        const localSHA = await calculateGitBlobSHABinary(arrayBuffer);

        if (isFallbackHash(localSHA)) {
          result.assetsPending++;
          continue;
        }

        if (localSHA === remoteSHA) {
          // Match! Create cache entry
          const contentHash = await calculateHash(new Uint8Array(arrayBuffer));

          const cacheEntry: AssetCacheEntry = {
            assetPath: asset.path,
            contentHash: contentHash,
            githubSHA: remoteSHA,
            lastSyncTime: Date.now(),
            fileSize: arrayBuffer.byteLength,
          };

          // Determine shard
          const shardHash = await calculateShardHash(asset.path);
          const shard = parseInt(shardHash.substring(0, 2), 16) % 16;

          if (!assetCacheShards.has(shard)) {
            // Load existing shard
            try {
              const existing = await plugin.loadData(`assets-${shard}.json`);
              assetCacheShards.set(shard, existing || {});
            } catch {
              assetCacheShards.set(shard, {});
            }
          }

          assetCacheShards.get(shard)![asset.path] = cacheEntry;
          result.assetsMatched++;
        } else {
          result.assetsPending++;
        }
      } catch (error) {
        await logError(`[CacheRebuild] Error processing asset ${asset.path}`, error);
        result.assetsPending++;
      }
    }

    // Save all asset cache shards
    for (const [shard, cache] of assetCacheShards) {
      await plugin.saveData(`assets-${shard}.json`, cache);
    }

    await logInfo(`[CacheRebuild] Assets: ${result.assetsMatched} matched, ${result.assetsPending} pending`);

    // ========================================================================
    // Phase 5: Complete
    // ========================================================================
    result.success = true;
    result.duration = Date.now() - startTime;

    onProgress?.({
      phase: "complete",
      current: 100,
      total: 100,
      message: "Cache rebuild complete!",
      docsMatched: result.docsMatched,
      docsPending: result.docsPending,
      assetsMatched: result.assetsMatched,
      assetsPending: result.assetsPending,
    });

    await logInfo(`[CacheRebuild] Complete: ${result.docsMatched} docs, ${result.assetsMatched} assets matched in ${result.duration}ms`);

  } catch (error) {
    result.success = false;
    result.error = error instanceof Error ? error.message : String(error);
    result.duration = Date.now() - startTime;

    await logError("[CacheRebuild] Failed", error);

    onProgress?.({
      phase: "error",
      current: 0,
      total: 100,
      message: `Error: ${result.error}`,
      docsMatched: result.docsMatched,
      docsPending: result.docsPending,
      assetsMatched: result.assetsMatched,
      assetsPending: result.assetsPending,
    });
  }

  await flushAllLogs();
  return result;
}
