import type { Plugin } from "siyuan";

import { DEFAULT_ASSETS_DIR } from "./constants";
import { createOrUpdateBinaryFile, createOrUpdateTextFile, parseRepoUrl } from "./git";
import { logError, logInfo } from "./logger";
import {
  exportMarkdown,
  getDocFromBlock,
  getBlockInfo,
  getBlockAttrs,
  getDocInfo,
  getFileBlob,
  listNotebooks,
  readDir,
  getRootIdByBlockId,
} from "./siyuan-api";
import type { Settings } from "./types";
import { getDocCacheEntry, updateDocCacheEntry } from "./cache-manager";
import { calculateHash } from "./hash-utils";

function sanitizeName(name: string): string {
  const cleaned = (name || "").replace(/[<>:"/\\|?*]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "untitled";
}

function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part) => part.replace(/^[\\/]+|[\\/]+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function removeFrontmatter(markdown: string): string {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*/, "");
}

function collectAssetPathsFromMarkdown(markdown: string): string[] {
  const assets = new Set<string>();
  const regex = /!?(\[[^\]]*\])\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown))) {
    const url = match[2];
    const idx = url.indexOf("assets/");
    if (idx >= 0) {
      const rel = url.slice(idx);
      assets.add(rel);
    }
  }
  return Array.from(assets);
}

function rewriteAssetLinks(markdown: string, relativePrefix: string): string {
  return markdown.replace(/(!?)(\[[^\]]*\])\(([^)]+)\)/g, (full, exclaim, label, url) => {
    const idx = url.indexOf("assets/");
    if (idx < 0) {
      return full;
    }
    // Skip "assets/" prefix to avoid double prefix (assets/assets/)
    const rel = url.slice(idx + "assets/".length);
    const next = `${relativePrefix}${rel}`;
    return `${exclaim}${label}(${next})`;
  });
}

function toPatterns(list: string[] | undefined): string[] {
  return (list || []).map((item) => (item || "").trim()).filter(Boolean);
}

function wildcardMatch(value: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return value === pattern;
  }
  const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  return regex.test(value);
}

function matchAny(value: string, patterns: string[]): boolean {
  return patterns.some((p) => wildcardMatch(value, p));
}

function extractTags(info: any): string[] {
  const raw = info?.ial;
  if (typeof raw !== "string") {
    return [];
  }
  const tags: string[] = [];
  const match = raw.match(/tags::\s*([^\n]+)/i);
  if (match && match[1]) {
    match[1]
      .split(/[, \t]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => tags.push(t));
  }
  return Array.from(new Set(tags));
}

function shouldIgnoreDoc(params: {
  notebookName: string;
  hpathParts: string[];
  tags: string[];
  settings: Settings;
}): { ignored: boolean; reason?: string } {
  const { notebookName, hpathParts, tags, settings } = params;
  const ignoresNotebook = matchAny(notebookName, toPatterns(settings.ignoreNotebooks));
  if (ignoresNotebook) {
    return { ignored: true, reason: "notebook" };
  }
  const hpath = hpathParts.join("/");
  const ignoresPath = matchAny(hpath, toPatterns(settings.ignorePaths));
  if (ignoresPath) {
    return { ignored: true, reason: "path" };
  }
  if (tags && tags.length > 0 && settings.ignoreTags?.length) {
    const patterns = toPatterns(settings.ignoreTags);
    const hit = tags.some((t) => matchAny(t, patterns));
    if (hit) {
      return { ignored: true, reason: "tag" };
    }
  }
  return { ignored: false };
}

async function listAllAssets(): Promise<string[]> {
  const base = "data/assets";
  const results: string[] = [];
  async function walk(path: string): Promise<void> {
    const entries = await readDir(path);
    for (const entry of entries) {
      const full = `${path}/${entry.name}`;
      if (entry.isDir) {
        await walk(full);
      } else {
        const rel = full.replace(/^data\//, "");
        results.push(rel);
      }
    }
  }
  try {
    await walk(base);
  } catch {
    // best-effort; return what we have
  }
  return results;
}

async function resolveDocId(docId: string | null, blockId: string | null): Promise<string | null> {
  if (docId) return docId;
  if (!blockId) return null;
  const doc = await getDocFromBlock(blockId);
  const resolved = doc?.id || doc?.rootID || doc?.block?.rootID;
  if (resolved) return resolved;
  const info = await getBlockInfo(blockId);
  if (info?.rootID) return info.rootID;
  const attrs = await getBlockAttrs(blockId);
  await logInfo(`Resolve doc via attrs: ${JSON.stringify(attrs)}`);
  if (attrs?.rootID) return attrs.rootID;
  // SQL fallback: map UUID to root_id
  const { root_id } = await getRootIdByBlockId(blockId);
  if (root_id) return root_id;
  return blockId;
}

async function fetchDocRecord(docId: string): Promise<{ info: any | null; usedId: string }> {
  let info = await getDocInfo(docId);
  if (info) {
    return { info, usedId: docId };
  }
  // Fallback: treat docId as blockId, ask getDocFromBlock
  const doc = await getDocFromBlock(docId);
  await logInfo(`Doc fetch fallback via getDocFromBlock: doc=${JSON.stringify(doc)}`);
  const altId = doc?.id || doc?.rootID || doc?.block?.rootID;
  if (altId && altId !== docId) {
    info = await getDocInfo(altId);
    if (info) {
      return { info, usedId: altId };
    }
  }
  // Fallback: getBlockInfo (may have rootID/hpath/box/name)
  const blk = await getBlockInfo(docId);
  await logInfo(`Doc fetch fallback via getBlockInfo: info=${JSON.stringify(blk)}`);
  if (blk?.rootID) {
    const used = blk.rootID;
    return { info: blk, usedId: used };
  }
  return { info: blk ?? null, usedId: docId };
}

export async function exportCurrentDocToGit(
  plugin: Plugin,
  docId: string | null,
  blockId: string | null,
  settings: Settings,
  onProgress?: (message: string) => void,
  skipAssets: boolean = false, // 增量同步时跳过assets（会在后面统一处理）
): Promise<void> {
  await logInfo(`Export start, docId=${docId}, blockId=${blockId}`);
  onProgress?.("Resolving document ID...");

  const resolvedDocId = await resolveDocId(docId, blockId);
  if (!resolvedDocId) {
    await logError("No docId/blockId available");
    throw new Error("Doc not found");
  }
  const docIdToUse = resolvedDocId;

  onProgress?.("Parsing repository URL...");
  const repo = parseRepoUrl(settings.repoUrl);
  if (!repo) {
    throw new Error("Invalid repoUrl");
  }

  onProgress?.("Fetching document info...");
  const { info, usedId } = await fetchDocRecord(docIdToUse);
  if (!info) {
    await logError(`Doc not found in DB, docId=${docIdToUse}`);
    throw new Error("Doc not found");
  }
  await logInfo(
    `Doc info: usedId=${usedId}, box=${info.box}, hpath=${info.hpath}, name=${info.name}, content=${info.content}`,
  );

  const notebooksRaw = await listNotebooks();
  const notebooks = Array.isArray(notebooksRaw)
    ? notebooksRaw
    : Array.isArray((notebooksRaw as any)?.notebooks)
      ? (notebooksRaw as any).notebooks
      : [];
  const notebook = notebooks.find((item: any) => item.id === info.box);
  const notebookName = sanitizeName(notebook ? notebook.name : info.box || "notebook");
  let hpathParts = (info.hpath || "").split("/").filter(Boolean).map(sanitizeName);
  const title = sanitizeName(info.content || info.name || docId);
  if (hpathParts.length > 0) {
    const last = hpathParts[hpathParts.length - 1];
    if (last === title) {
      hpathParts = hpathParts.slice(0, -1);
    }
  }
  const tags = extractTags(info);

  const hpath = hpathParts.join("/");
  const ignoreResult = shouldIgnoreDoc({
    notebookName,
    hpathParts,
    tags,
    settings,
  });
  if (ignoreResult.ignored) {
    await logInfo(`Skip export ${docId} due to ignore (${ignoreResult.reason})`);
    onProgress?.(`Skipped (ignored by ${ignoreResult.reason})`);
    return;
  }

  const filePath = joinPath(
    settings.exportRoot,
    sanitizeName(notebookName),
    ...hpathParts.map(p => sanitizeName(p)),
    `${sanitizeName(title)}.md`
  );

  onProgress?.("Exporting markdown...");
  const markdownRaw = await exportMarkdown(docId);
  let markdown = markdownRaw.content || "";
  if (settings.cleanFrontmatter) {
    markdown = removeFrontmatter(markdown);
  }

  const depth = filePath.split("/").length - 1;
  const assetsDir = settings.assetsDir || DEFAULT_ASSETS_DIR;
  const relativePrefix = "../".repeat(depth) + assetsDir + "/";
  markdown = rewriteAssetLinks(markdown, relativePrefix);

  // Fix image links: add ! prefix to make [image](...) display as images in GitHub/VSCode
  // Use negative lookbehind (?<!!) to avoid adding ! if it already exists
  markdown = markdown.replace(/(?<!!)\[([^\]]*?)\]\((\.\.\/assets\/[^)]+)\)/g, '![$1]($2)');
  await logInfo(`[Export] Fixed image link format for: ${docId}`);

  // Calculate content hash for cache check
  const contentHash = await calculateHash(markdown);

  // Check cache to see if content has changed
  const cached = await getDocCacheEntry(plugin, info.box, usedId);

  if (cached && cached.contentHash === contentHash) {
    await logInfo(`[Cache] Doc content unchanged, skipping upload: ${docId}`);
    onProgress?.("Content unchanged, skipping upload");
    return;
  }

  onProgress?.("Uploading markdown to GitHub...");
  const message = `Export doc ${docIdToUse}`;
  const uploadResult = await createOrUpdateTextFile(
    {
      owner: repo.owner,
      repo: repo.repo,
      branch: settings.branch,
      token: settings.token,
      path: filePath,
      contentBase64: "",
      message,
    },
    markdown,
  );

  // 调试日志：查看返回结构
  await logInfo(`[GitHub] Upload response: ${JSON.stringify(uploadResult).substring(0, 200)}`);

  // 提取 GitHub SHA
  let githubSHA: string;
  if (uploadResult && uploadResult.content && uploadResult.content.sha) {
    githubSHA = uploadResult.content.sha;
  } else if (uploadResult && uploadResult.sha) {
    // 有些情况下SHA可能在顶层
    githubSHA = uploadResult.sha;
  } else {
    await logError(`[GitHub] Invalid response structure: ${JSON.stringify(uploadResult)}`);
    throw new Error(`GitHub upload failed: no SHA returned for ${filePath}`);
  }

  await logInfo(`[GitHub] File uploaded, SHA: ${githubSHA}`);

  // Update cache after successful upload
  const cacheEntry = {
    docId: usedId,
    notebookId: info.box,
    githubPath: filePath,
    contentHash,
    githubSHA: githubSHA,
    lastSyncTime: Date.now(),
    siyuanUpdated: info.updated || Date.now(),
  };
  await logInfo(`[Exporter] About to update cache with entry: ${JSON.stringify(cacheEntry)}`);
  await updateDocCacheEntry(plugin, info.box, usedId, cacheEntry);

  // 如果是增量同步，跳过assets上传（会在后面统一处理）
  if (!skipAssets) {
    let assets: string[] = [];
    if (settings.exportAllAssets) {
      onProgress?.("Collecting all assets...");
      assets = (await listAllAssets()).map((a) => a.replace(/^assets\//, ""));
    } else {
      onProgress?.("Collecting referenced assets...");
      assets = collectAssetPathsFromMarkdown(markdown).map((a) => a.replace(/^assets\//, ""));
    }

    if (assets.length > 0) {
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        onProgress?.(`Uploading asset ${i + 1}/${assets.length}: ${asset.split("/").pop()}...`);

        const normalized = asset.replace(/^assets\//, "");
        const assetPath = joinPath(settings.exportRoot, assetsDir, normalized);
        const blob = await getFileBlob(`data/assets/${normalized}`);
        if (!blob) {
          continue;
        }
        const buffer = await blob.arrayBuffer();
        await createOrUpdateBinaryFile(
          {
            owner: repo.owner,
            repo: repo.repo,
            branch: settings.branch,
            token: settings.token,
            path: assetPath,
            contentBase64: "",
            message: `Export asset ${asset}`,
          },
          buffer,
        );
      }
    }

    await logInfo(`Exported doc ${docId} to ${filePath}`);
    onProgress?.(`Done: 1 doc, ${assets.length} asset${assets.length !== 1 ? "s" : ""}`);
  } else {
    await logInfo(`Exported doc ${docId} to ${filePath} (assets skipped - will sync separately)`);
    onProgress?.("Document uploaded (assets will sync separately)");
  }
}
