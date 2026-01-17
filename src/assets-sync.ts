/**
 * Assets Sync Module
 *
 * Handles syncing of assets (images, PDFs, etc.) from data/assets/ to GitHub
 */

import type { Plugin } from "siyuan";
import { getAssetCacheEntry, updateAssetCacheEntry } from "./cache-manager";
import type { Settings, AssetFile, AssetSyncResult } from "./types";
import { createOrUpdateBinaryFile, parseRepoUrl } from "./git";
import { logInfo, logError } from "./logger";
import { calculateFileHash } from "./hash-utils";

// ============================================================================
// Get Assets List from SiYuan
// ============================================================================

/**
 * Get all assets from data/assets/ directory using SiYuan API
 */
export async function getAllAssets(): Promise<AssetFile[]> {
  await logInfo("[Assets] Scanning data/assets directory");
  // Use SiYuan's kernel API to list files
  const response = await fetch("/api/file/readDir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "/data/assets",
    }),
  });

  const result = await response.json();

  if (result.code !== 0) {
    await logError(`Failed to read assets directory: ${result.msg}`);
    throw new Error(`Failed to read assets directory: ${result.msg}`);
  }

  const assets: AssetFile[] = [];

  for (const file of result.data || []) {
    if (file.isDir) continue; // Skip directories

    assets.push({
      path: file.name,
      size: file.size || 0,
    });
  }

  await logInfo(`[Assets] Found ${assets.length} asset files`);
  return assets;
}

// ============================================================================
// Read Asset File and Calculate Hash
// ============================================================================

/**
 * Read asset file content using SiYuan API
 */
export async function readAssetFile(assetPath: string): Promise<ArrayBuffer> {
  const response = await fetch("/api/file/getFile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: `/data/assets/${assetPath}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to read asset file: ${assetPath}`);
  }

  return await response.arrayBuffer();
}

// ============================================================================
// Upload Single Asset with Cache Check
// ============================================================================

/**
 * Upload a single asset to GitHub with cache check
 * Returns true if uploaded, false if skipped (cache hit)
 */
export async function uploadAssetWithCache(
  plugin: Plugin,
  asset: AssetFile,
  settings: Settings,
  onProgress?: (message: string) => void
): Promise<boolean> {
  try {
    // 1. Read file content
    onProgress?.(`Reading ${asset.path}...`);
    const content = await readAssetFile(asset.path);

    // 2. Calculate hash
    const contentHash = await calculateFileHash(content);

    // 3. Check cache
    const cached = await getAssetCacheEntry(plugin, asset.path);

    if (cached && cached.contentHash === contentHash) {
      onProgress?.(`[Cache Hit] ${asset.path} unchanged, skipping`);
      return false; // Skip upload
    }

    // 4. Upload to GitHub
    onProgress?.(`[Uploading] ${asset.path} (${formatFileSize(asset.size)})`);
    const githubPath = `${settings.assetsDir}/${asset.path}`;
    const githubSHA = await uploadFileToGitHub(
      Buffer.from(content),
      githubPath,
      settings
    );

    // 5. Update cache
    await updateAssetCacheEntry(plugin, asset.path, {
      assetPath: asset.path,
      contentHash,
      githubSHA,
      lastSyncTime: Date.now(),
      fileSize: asset.size,
    });

    onProgress?.(`[Uploaded] ${asset.path}`);
    return true; // Upload completed

  } catch (error) {
    onProgress?.(`[Error] ${asset.path}: ${error.message}`);
    throw error;
  }
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Upload file to GitHub using existing git.ts logic
 */
async function uploadFileToGitHub(
  content: Buffer,
  path: string,
  settings: Settings
): Promise<string> {
  const repo = parseRepoUrl(settings.repoUrl);
  if (!repo) {
    throw new Error("Invalid repoUrl");
  }

  await logInfo(`[Assets] Uploading to GitHub: ${path}`);

  const result = await createOrUpdateBinaryFile(
    {
      owner: repo.owner,
      repo: repo.repo,
      branch: settings.branch,
      token: settings.token,
      path,
      contentBase64: "",
      message: `Upload asset ${path.split("/").pop()}`,
    },
    content.buffer
  );

  await logInfo(`[Assets] Upload completed: ${path}`);
  return result?.content?.sha || "unknown";
}

// ============================================================================
// Batch Upload Assets with Concurrency Control
// ============================================================================

/**
 * Upload multiple assets to GitHub with concurrency control
 */
export async function syncAllAssets(
  plugin: Plugin,
  settings: Settings,
  onProgress?: (message: string) => void
): Promise<AssetSyncResult> {
  const result: AssetSyncResult = {
    total: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  try {
    // 1. Get all assets
    onProgress?.("Loading assets list...");
    const assets = await getAllAssets();
    result.total = assets.length;

    onProgress?.(`Found ${assets.length} assets`);

    // 2. Upload assets with concurrency control (5 at a time)
    const CONCURRENCY = 5;
    for (let i = 0; i < assets.length; i += CONCURRENCY) {
      const batch = assets.slice(i, i + CONCURRENCY);

      const batchResults = await Promise.allSettled(
        batch.map((asset) => uploadAssetWithCache(plugin, asset, settings, onProgress))
      );

      // Process results
      for (let j = 0; j < batchResults.length; j++) {
        const batchResult = batchResults[j];
        const asset = batch[j];

        if (batchResult.status === "fulfilled") {
          if (batchResult.value) {
            result.uploaded++;
          } else {
            result.skipped++;
          }
        } else {
          result.failed++;
          result.errors.push({
            path: asset.path,
            error: batchResult.reason?.message || "Unknown error",
          });
        }
      }

      // Progress report
      const processed = Math.min(i + CONCURRENCY, assets.length);
      onProgress?.(
        `Progress: ${processed}/${assets.length} ` +
        `(Uploaded: ${result.uploaded}, Skipped: ${result.skipped}, Failed: ${result.failed})`
      );
    }

    onProgress?.("Assets sync completed");
    return result;

  } catch (error) {
    onProgress?.(`Assets sync failed: ${error.message}`);
    throw error;
  }
}
