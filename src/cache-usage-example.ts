/**
 * Cache Manager Usage Examples
 *
 * This file demonstrates how to use the cache manager in different scenarios
 */

import type { Plugin } from "siyuan";
import {
  getDocCacheEntry,
  updateDocCacheEntry,
  getAssetCacheEntry,
  updateAssetCacheEntry,
  loadSyncMeta,
  updateNotebookMeta,
} from "./cache-manager";
import crypto from "crypto";

// ============================================================================
// Example 1: Export Single Document with Cache Check
// ============================================================================

export async function exportDocumentWithCache(
  plugin: Plugin,
  docId: string,
  notebookId: string,
  markdownContent: string,
  githubPath: string
): Promise<boolean> {
  // 1. Calculate content hash
  const contentHash = crypto.createHash("md5").update(markdownContent).digest("hex");

  // 2. Check cache
  const cached = await getDocCacheEntry(plugin, notebookId, docId);

  if (cached && cached.contentHash === contentHash) {
    console.log(`[Cache Hit] Document ${docId} unchanged, skipping upload`);
    return false; // No upload needed
  }

  // 3. Upload to GitHub (pseudo code)
  console.log(`[Cache Miss] Uploading document ${docId} to GitHub...`);
  const githubSHA = await uploadToGitHub(markdownContent, githubPath);

  // 4. Update cache
  await updateDocCacheEntry(plugin, notebookId, docId, {
    docId,
    notebookId,
    githubPath,
    contentHash,
    githubSHA,
    lastSyncTime: Date.now(),
    siyuanUpdated: Date.now(),
  });

  console.log(`[Cache Updated] Document ${docId} cached`);
  return true; // Upload completed
}

// ============================================================================
// Example 2: Export Asset with Cache Check
// ============================================================================

export async function exportAssetWithCache(
  plugin: Plugin,
  assetPath: string,
  fileContent: Buffer,
  githubPath: string
): Promise<boolean> {
  // 1. Calculate content hash
  const contentHash = crypto.createHash("md5").update(fileContent).digest("hex");

  // 2. Check cache
  const cached = await getAssetCacheEntry(plugin, assetPath);

  if (cached && cached.contentHash === contentHash) {
    console.log(`[Cache Hit] Asset ${assetPath} unchanged, skipping upload`);
    return false;
  }

  // 3. Upload to GitHub
  console.log(`[Cache Miss] Uploading asset ${assetPath} to GitHub...`);
  const githubSHA = await uploadAssetToGitHub(fileContent, githubPath);

  // 4. Update cache
  await updateAssetCacheEntry(plugin, assetPath, {
    assetPath,
    contentHash,
    githubSHA,
    lastSyncTime: Date.now(),
    fileSize: fileContent.length,
  });

  console.log(`[Cache Updated] Asset ${assetPath} cached`);
  return true;
}

// ============================================================================
// Example 3: Sync Entire Notebook (Batch Operation)
// ============================================================================

export async function syncNotebook(
  plugin: Plugin,
  notebookId: string,
  notebookName: string,
  documents: Array<{ docId: string; content: string; githubPath: string }>
): Promise<{ uploaded: number; skipped: number }> {
  let uploaded = 0;
  let skipped = 0;

  console.log(`[Sync Start] Notebook ${notebookName} (${documents.length} docs)`);

  for (const doc of documents) {
    const wasUploaded = await exportDocumentWithCache(
      plugin,
      doc.docId,
      notebookId,
      doc.content,
      doc.githubPath
    );

    if (wasUploaded) {
      uploaded++;
    } else {
      skipped++;
    }
  }

  // Update notebook metadata
  await updateNotebookMeta(plugin, notebookId, notebookName, documents.length);

  console.log(`[Sync Complete] Uploaded: ${uploaded}, Skipped: ${skipped}`);
  return { uploaded, skipped };
}

// ============================================================================
// Example 4: Parallel Sync Multiple Notebooks
// ============================================================================

export async function syncAllNotebooks(
  plugin: Plugin,
  notebooks: Array<{
    notebookId: string;
    notebookName: string;
    documents: Array<{ docId: string; content: string; githubPath: string }>;
  }>
): Promise<void> {
  console.log(`[Full Sync] Starting sync for ${notebooks.length} notebooks`);

  // Sync notebooks in parallel
  const results = await Promise.all(
    notebooks.map((nb) =>
      syncNotebook(plugin, nb.notebookId, nb.notebookName, nb.documents)
    )
  );

  const totalUploaded = results.reduce((sum, r) => sum + r.uploaded, 0);
  const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);

  console.log(`[Full Sync Complete] Uploaded: ${totalUploaded}, Skipped: ${totalSkipped}`);
}

// Pseudo functions (to be implemented)
async function uploadToGitHub(content: string, path: string): Promise<string> {
  // Implementation in git.ts
  return "github_sha_placeholder";
}

async function uploadAssetToGitHub(content: Buffer, path: string): Promise<string> {
  // Implementation in git.ts
  return "github_sha_placeholder";
}
