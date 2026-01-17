"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  default: () => LifeosSyncPlugin
});
module.exports = __toCommonJS(src_exports);
var import_siyuan = require("siyuan");

// src/constants.ts
var SETTINGS_FILE = "settings.json";
var LOG_FILE_PATH = "temp/lifeos_sync.log";
var DEFAULT_EXPORT_ROOT = "";
var DEFAULT_ASSETS_DIR = "assets";
var DEFAULT_EXPORT_ALL_ASSETS = false;

// src/settings.ts
var DEFAULT_SETTINGS = {
  repoUrl: "",
  branch: "main",
  token: "",
  exportRoot: DEFAULT_EXPORT_ROOT,
  assetsDir: DEFAULT_ASSETS_DIR,
  cleanFrontmatter: true,
  exportAllAssets: DEFAULT_EXPORT_ALL_ASSETS,
  ignoreNotebooks: [],
  ignorePaths: [],
  ignoreTags: []
};
async function loadSettings(plugin) {
  const data = await plugin.loadData(SETTINGS_FILE);
  return { ...DEFAULT_SETTINGS, ...data ?? {} };
}
async function saveSettings(plugin, settings) {
  await plugin.saveData(SETTINGS_FILE, settings);
}

// src/git.ts
function parseRepoUrl(url) {
  const cleaned = (url || "").trim().replace(/\.git$/, "");
  const https = cleaned.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)$/);
  if (https) {
    return { owner: https[1], repo: https[2] };
  }
  const ssh = cleaned.match(/^git@[^:]+:([^/]+)\/([^/]+)$/);
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2] };
  }
  return null;
}
function base64FromUtf8(text) {
  return btoa(unescape(encodeURIComponent(text)));
}
function base64FromArrayBuffer(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
async function proxyFetch(url, options) {
  const headers = [];
  if (options.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => {
        headers.push({ [key]: value });
      });
    } else if (Array.isArray(options.headers)) {
      for (const [key, value] of options.headers) {
        headers.push({ [key]: value });
      }
    } else {
      for (const [key, value] of Object.entries(options.headers)) {
        headers.push({ [key]: value });
      }
    }
  }
  let payload = null;
  if (options.body) {
    if (typeof options.body === "string") {
      try {
        payload = JSON.parse(options.body);
      } catch {
        payload = options.body;
      }
    } else {
      payload = options.body;
    }
  }
  const proxyRes = await fetch("/api/network/forwardProxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url,
      method: options.method || "GET",
      headers,
      payload,
      timeout: 3e4
      // 30 seconds
    })
  });
  if (!proxyRes.ok) {
    const errorText = await proxyRes.text();
    throw new Error(`SiYuan proxy request failed: ${errorText}`);
  }
  const proxyData = await proxyRes.json();
  if (proxyData.code !== 0) {
    throw new Error(`SiYuan proxy error: ${proxyData.msg || "Unknown error"}`);
  }
  const responseData = proxyData.data;
  if (!responseData) {
    console.error("lifeos_sync: forwardProxy returned null data. Full response:", proxyData);
    throw new Error("SiYuan forwardProxy returned null data");
  }
  return {
    ok: responseData.status >= 200 && responseData.status < 300,
    status: responseData.status,
    statusText: responseData.statusText || "",
    headers: new Headers(responseData.headers || {}),
    text: async () => responseData.body || "",
    json: async () => {
      try {
        return JSON.parse(responseData.body || "{}");
      } catch {
        return {};
      }
    },
    blob: async () => new Blob([responseData.body || ""]),
    arrayBuffer: async () => new TextEncoder().encode(responseData.body || "").buffer,
    clone: function() {
      return this;
    },
    bodyUsed: false,
    body: null,
    type: "basic",
    url,
    redirected: false,
    formData: async () => {
      throw new Error("Not implemented");
    }
  };
}
async function getFileSha(opts) {
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/contents/${opts.path}?ref=${opts.branch}`;
  const res = await proxyFetch(url, {
    method: "GET",
    headers: {
      Authorization: `token ${opts.token}`,
      Accept: "application/vnd.github+json"
    }
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub get file failed: ${text}`);
  }
  const data = await res.json();
  return data && data.sha ? data.sha : null;
}
async function createOrUpdateTextFile(opts, content) {
  const sha = await getFileSha(opts);
  const body = {
    message: opts.message,
    content: base64FromUtf8(content),
    branch: opts.branch,
    sha: sha ?? void 0
  };
  await writeFile(opts, body);
}
async function createOrUpdateBinaryFile(opts, buffer) {
  const sha = await getFileSha(opts);
  const body = {
    message: opts.message,
    content: base64FromArrayBuffer(buffer),
    branch: opts.branch,
    sha: sha ?? void 0
  };
  await writeFile(opts, body);
}
async function writeFile(opts, body) {
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/contents/${opts.path}`;
  const res = await proxyFetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${opts.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub write failed: ${text}`);
  }
}

// src/siyuan-api.ts
async function apiPost(url, data) {
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(data ?? {})
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.msg || `Request failed: ${url}`);
  }
  return json.data;
}
async function apiPostForm(url, formData) {
  const res = await fetch(url, {
    method: "POST",
    body: formData
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.msg || `Request failed: ${url}`);
  }
  return json.data;
}
async function getFileBlob(path) {
  const res = await fetch("/api/file/getFile", {
    method: "POST",
    body: JSON.stringify({ path })
  });
  if (!res.ok) {
    return null;
  }
  return await res.blob();
}
async function putFile(path, content) {
  const form = new FormData();
  form.append("path", path);
  form.append("isDir", "false");
  form.append("modTime", Date.now().toString());
  form.append("file", content, "file");
  await apiPostForm("/api/file/putFile", form);
}
async function readTextFile(path) {
  const blob = await getFileBlob(path);
  if (!blob) {
    return "";
  }
  return await blob.text();
}
async function readDir(path) {
  return await apiPost("/api/file/readDir", { path });
}
async function listNotebooks() {
  return await apiPost("/api/notebook/lsNotebooks", {});
}
async function getDocInfo(docId) {
  const stmt = `select * from blocks where id = '${docId}'`;
  const rows = await apiPost("/api/query/sql", { stmt });
  return rows && rows.length > 0 ? rows[0] : null;
}
async function exportMarkdown(docId) {
  return await apiPost("/api/export/exportMdContent", { id: docId });
}
async function getDocFromBlock(blockId) {
  try {
    return await apiPost("/api/block/getDoc", { id: blockId });
  } catch {
    return null;
  }
}
async function getBlockInfo(blockId) {
  try {
    return await apiPost("/api/block/getBlockInfo", { id: blockId });
  } catch {
    return null;
  }
}
async function getBlockAttrs(blockId) {
  try {
    return await apiPost("/api/block/getBlockAttrs", { id: blockId });
  } catch {
    return null;
  }
}
async function querySql(stmt) {
  return await apiPost("/api/query/sql", { stmt });
}
async function getRootIdByBlockId(blockId) {
  try {
    const rows = await querySql(
      `select root_id, box from blocks where id='${blockId}' limit 1`
    );
    if (rows && rows.length > 0) {
      return { root_id: rows[0].root_id ?? null, box: rows[0].box ?? null };
    }
  } catch {
  }
  return { root_id: null, box: null };
}
function getActiveDocRefFromDOM() {
  const looksLikeDoc = (v) => !!v && /^\d{14}-[a-z0-9]{7}$/i.test(v);
  const scanDomForDocId = () => {
    const selectors = [
      "[data-doc-id]",
      "[data-root-id]",
      "[data-node-id]",
      ".protyle-content",
      ".protyle-title"
    ];
    for (const sel of selectors) {
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        const candidates = [
          el.getAttribute("data-doc-id"),
          el.getAttribute("data-root-id"),
          el.getAttribute("data-node-id"),
          el.getAttribute("data-id")
        ];
        for (const c of candidates) {
          if (looksLikeDoc(c)) return c;
        }
      }
    }
    return null;
  };
  const app = window?.siyuan?.ws?.app;
  if (app?.tabs?.getCurrentTab) {
    try {
      const tab = app.tabs.getCurrentTab();
      console.info("lifeos_sync: [Priority 1] Tab API result:", {
        "tab.panel?.doc?.id": tab?.panel?.doc?.id,
        "tab.panel?.head?.dataset?.docId": tab?.panel?.head?.dataset?.docId,
        "tab.panel?.protyle?.block?.id": tab?.panel?.protyle?.block?.id,
        "tab.panel?.protyle?.block?.rootID": tab?.panel?.protyle?.block?.rootID
      });
      const docId = tab?.panel?.doc?.id || tab?.panel?.head?.dataset?.docId || tab?.panel?.protyle?.block?.rootID || tab?.panel?.protyle?.block?.id;
      const blockId = tab?.panel?.protyle?.block?.id || tab?.panel?.protyle?.block?.rootID || null;
      if (docId || blockId) {
        console.info("lifeos_sync: \u2713 Using Tab API docId:", docId, "blockId:", blockId);
        return { docId: docId ?? null, blockId };
      }
    } catch (err) {
      console.warn("lifeos_sync: Tab API failed:", err);
    }
  } else {
    console.info("lifeos_sync: [Priority 1] Tab API not available");
  }
  const visibleProtyles = Array.from(
    document.querySelectorAll(".protyle:not(.fn__none)")
  );
  console.info("lifeos_sync: [Priority 2] Found", visibleProtyles.length, "visible protyles");
  for (const protyle of visibleProtyles) {
    const titleNode = protyle.querySelector(".protyle-title[data-node-id]");
    const titleId = titleNode?.getAttribute("data-node-id");
    console.info("lifeos_sync: [Priority 2] Protyle title data-node-id:", titleId);
    if (looksLikeDoc(titleId)) {
      console.info("lifeos_sync: \u2713 Using protyle title docId:", titleId);
      return { docId: titleId, blockId: titleId };
    }
  }
  if (visibleProtyles.length > 0) {
    const el = visibleProtyles[0];
    console.info("lifeos_sync: [Priority 3] Visible protyle attrs:", {
      "data-doc-id": el.getAttribute("data-doc-id"),
      "data-id": el.getAttribute("data-id"),
      "data-root-id": el.getAttribute("data-root-id"),
      "data-node-id": el.getAttribute("data-node-id")
    });
    const docId = el.getAttribute("data-doc-id") || el.getAttribute("data-root-id") || el.getAttribute("data-node-id") || el.getAttribute("data-id");
    const blockId = el.getAttribute("data-id") || docId;
    if (looksLikeDoc(docId)) {
      console.info("lifeos_sync: \u2713 Using visible protyle docId:", docId);
      return { docId, blockId: blockId ?? docId };
    }
    if (docId || blockId) {
      console.info("lifeos_sync: \u2713 Using visible protyle (not doc-like) docId:", docId, "blockId:", blockId);
      return { docId, blockId };
    }
  }
  const anyTitle = document.querySelector(".protyle-title[data-node-id]");
  const anyTitleId = anyTitle?.getAttribute("data-node-id");
  console.info("lifeos_sync: [Priority 4] Any protyle title data-node-id:", anyTitleId);
  if (looksLikeDoc(anyTitleId)) {
    console.info("lifeos_sync: \u2713 Using any title docId:", anyTitleId);
    return { docId: anyTitleId, blockId: anyTitleId };
  }
  const any = document.querySelector(".protyle[data-doc-id], .protyle[data-id]");
  if (any) {
    console.info("lifeos_sync: [Priority 5] Any protyle attrs:", {
      "data-doc-id": any.getAttribute("data-doc-id"),
      "data-id": any.getAttribute("data-id"),
      "data-root-id": any.getAttribute("data-root-id"),
      "data-node-id": any.getAttribute("data-node-id")
    });
    const docId = any.getAttribute("data-doc-id") || any.getAttribute("data-id") || any.getAttribute("data-root-id") || any.getAttribute("data-node-id");
    const blockId = any.getAttribute("data-id") || docId;
    if (looksLikeDoc(docId)) {
      console.info("lifeos_sync: \u2713 Using any protyle docId:", docId);
      return { docId, blockId: blockId ?? docId };
    }
    if (docId || blockId) {
      console.info("lifeos_sync: \u2713 Using any protyle (not doc-like) docId:", docId, "blockId:", blockId);
      return { docId, blockId };
    }
  }
  console.info("lifeos_sync: [Priority 6] Running deep DOM scan...");
  const domDoc = scanDomForDocId();
  if (domDoc) {
    console.info("lifeos_sync: \u2713 Using DOM scan docId:", domDoc);
    return { docId: domDoc, blockId: domDoc };
  }
  const treeFocused = document.querySelector(".file-tree .b3-list-item--focus[data-node-id]");
  const treeId = treeFocused?.getAttribute("data-node-id");
  console.info("lifeos_sync: [Priority 7] File tree selection data-node-id:", treeId);
  if (looksLikeDoc(treeId)) {
    console.warn("lifeos_sync: \u26A0 Using file tree fallback docId:", treeId);
    return { docId: treeId, blockId: treeId };
  }
  console.error("lifeos_sync: \u2717 No doc ID found through any method");
  return { docId: null, blockId: null };
}

// src/logger.ts
var enabled = false;
function initLogger() {
  enabled = true;
}
function formatLine(level, message) {
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  return `[${ts}] [${level}] ${message}
`;
}
async function appendLog(level, message) {
  if (!enabled) {
    return;
  }
  try {
    const existing = await readTextFile(LOG_FILE_PATH);
    const next = existing + formatLine(level, message);
    await putFile(LOG_FILE_PATH, new Blob([next], { type: "text/plain" }));
  } catch (err) {
    console.warn("lifeos_sync log append failed", err);
  }
}
async function logInfo(message) {
  console.info(`lifeos_sync: ${message}`);
  await appendLog("INFO", message);
}
async function logError(message, err) {
  console.error(`lifeos_sync: ${message}`, err);
  const detail = err instanceof Error ? `${message} :: ${err.message}` : message;
  await appendLog("ERROR", detail);
}

// src/hash-utils.ts
function simpleHash(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function simpleHashBuffer(buffer) {
  const view = new Uint8Array(buffer);
  let hash = 2166136261;
  for (let i = 0; i < view.length; i++) {
    hash ^= view[i];
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
async function calculateHash(text) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      console.warn("[Hash] crypto.subtle failed, using fallback:", e);
    }
  }
  return simpleHash(text);
}
async function calculateFileHash(content) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const hashBuffer = await crypto.subtle.digest("SHA-256", content);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      console.warn("[Hash] crypto.subtle failed, using fallback:", e);
    }
  }
  return simpleHashBuffer(content);
}
async function calculateShardHash(text) {
  return calculateHash(text);
}

// src/cache-manager.ts
var ASSET_SHARD_COUNT = 16;
function getNotebookCacheFile(notebookId) {
  return `notebook-${notebookId}-docs.json`;
}
async function getAssetShard(assetPath) {
  const hash = await calculateShardHash(assetPath);
  return parseInt(hash.substring(0, 2), 16) % ASSET_SHARD_COUNT;
}
async function loadNotebookDocCache(plugin, notebookId) {
  const cacheFile = getNotebookCacheFile(notebookId);
  const cache = await plugin.loadData(cacheFile);
  return cache || {};
}
async function saveNotebookDocCache(plugin, notebookId, cache) {
  const cacheFile = getNotebookCacheFile(notebookId);
  await plugin.saveData(cacheFile, cache);
}
async function getDocCacheEntry(plugin, notebookId, docId) {
  const cache = await loadNotebookDocCache(plugin, notebookId);
  const entry = cache[docId] || null;
  if (entry) {
    await logInfo(`[Cache] Doc cache hit: ${docId}`);
  } else {
    await logInfo(`[Cache] Doc cache miss: ${docId}`);
  }
  return entry;
}
async function updateDocCacheEntry(plugin, notebookId, docId, entry) {
  await logInfo(`[Cache] Updating doc cache: ${docId} -> ${entry.githubPath}`);
  const cache = await loadNotebookDocCache(plugin, notebookId);
  cache[docId] = entry;
  await saveNotebookDocCache(plugin, notebookId, cache);
}
async function loadAssetCacheShard(plugin, shard) {
  const cacheFile = `assets-${shard}.json`;
  const cache = await plugin.loadData(cacheFile);
  return cache || {};
}
async function saveAssetCacheShard(plugin, shard, cache) {
  const cacheFile = `assets-${shard}.json`;
  await plugin.saveData(cacheFile, cache);
}
async function getAssetCacheEntry(plugin, assetPath) {
  const shard = await getAssetShard(assetPath);
  const cache = await loadAssetCacheShard(plugin, shard);
  const entry = cache[assetPath] || null;
  if (entry) {
    await logInfo(`[Cache] Asset cache hit: ${assetPath} (shard ${shard})`);
  }
  return entry;
}
async function updateAssetCacheEntry(plugin, assetPath, entry) {
  const shard = await getAssetShard(assetPath);
  await logInfo(`[Cache] Updating asset cache: ${assetPath} (shard ${shard})`);
  const cache = await loadAssetCacheShard(plugin, shard);
  cache[assetPath] = entry;
  await saveAssetCacheShard(plugin, shard, cache);
}

// src/exporter.ts
function sanitizeName(name) {
  const cleaned = (name || "").replace(/[<>:"/\\|?*]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "untitled";
}
function joinPath(...parts) {
  return parts.filter(Boolean).map((part) => part.replace(/^[\\/]+|[\\/]+$/g, "")).filter(Boolean).join("/");
}
function removeFrontmatter(markdown) {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*/, "");
}
function collectAssetPathsFromMarkdown(markdown) {
  const assets = /* @__PURE__ */ new Set();
  const regex = /!?(\[[^\]]*\])\(([^)]+)\)/g;
  let match;
  while (match = regex.exec(markdown)) {
    const url = match[2];
    const idx = url.indexOf("assets/");
    if (idx >= 0) {
      const rel = url.slice(idx);
      assets.add(rel);
    }
  }
  return Array.from(assets);
}
function rewriteAssetLinks(markdown, relativePrefix) {
  return markdown.replace(/!?(\[[^\]]*\])\(([^)]+)\)/g, (full, label, url) => {
    const idx = url.indexOf("assets/");
    if (idx < 0) {
      return full;
    }
    const rel = url.slice(idx + "assets/".length);
    const next = `${relativePrefix}${rel}`;
    return `${label}(${next})`;
  });
}
function toPatterns(list) {
  return (list || []).map((item) => (item || "").trim()).filter(Boolean);
}
function wildcardMatch(value, pattern) {
  if (!pattern.includes("*")) {
    return value === pattern;
  }
  const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  return regex.test(value);
}
function matchAny(value, patterns) {
  return patterns.some((p) => wildcardMatch(value, p));
}
function extractTags(info) {
  const raw = info?.ial;
  if (typeof raw !== "string") {
    return [];
  }
  const tags = [];
  const match = raw.match(/tags::\s*([^\n]+)/i);
  if (match && match[1]) {
    match[1].split(/[, \t]+/).map((t) => t.trim()).filter(Boolean).forEach((t) => tags.push(t));
  }
  return Array.from(new Set(tags));
}
function shouldIgnoreDoc(params) {
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
async function listAllAssets() {
  const base = "data/assets";
  const results = [];
  async function walk(path) {
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
  }
  return results;
}
async function resolveDocId(docId, blockId) {
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
  const { root_id } = await getRootIdByBlockId(blockId);
  if (root_id) return root_id;
  return blockId;
}
async function fetchDocRecord(docId) {
  let info = await getDocInfo(docId);
  if (info) {
    return { info, usedId: docId };
  }
  const doc = await getDocFromBlock(docId);
  await logInfo(`Doc fetch fallback via getDocFromBlock: doc=${JSON.stringify(doc)}`);
  const altId = doc?.id || doc?.rootID || doc?.block?.rootID;
  if (altId && altId !== docId) {
    info = await getDocInfo(altId);
    if (info) {
      return { info, usedId: altId };
    }
  }
  const blk = await getBlockInfo(docId);
  await logInfo(`Doc fetch fallback via getBlockInfo: info=${JSON.stringify(blk)}`);
  if (blk?.rootID) {
    const used = blk.rootID;
    return { info: blk, usedId: used };
  }
  return { info: blk ?? null, usedId: docId };
}
async function exportCurrentDocToGit(plugin, docId, blockId, settings, onProgress) {
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
    `Doc info: usedId=${usedId}, box=${info.box}, hpath=${info.hpath}, name=${info.name}, content=${info.content}`
  );
  const notebooksRaw = await listNotebooks();
  const notebooks = Array.isArray(notebooksRaw) ? notebooksRaw : Array.isArray(notebooksRaw?.notebooks) ? notebooksRaw.notebooks : [];
  const notebook = notebooks.find((item) => item.id === info.box);
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
    settings
  });
  if (ignoreResult.ignored) {
    await logInfo(`Skip export ${docId} due to ignore (${ignoreResult.reason})`);
    onProgress?.(`Skipped (ignored by ${ignoreResult.reason})`);
    return;
  }
  const filePath = joinPath(settings.exportRoot, notebookName, ...hpathParts, `${title}.md`);
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
  const contentHash = await calculateHash(markdown);
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
      message
    },
    markdown
  );
  await updateDocCacheEntry(plugin, info.box, usedId, {
    docId: usedId,
    notebookId: info.box,
    githubPath: filePath,
    contentHash,
    githubSHA: uploadResult?.content?.sha || "unknown",
    lastSyncTime: Date.now(),
    siyuanUpdated: info.updated || Date.now()
  });
  let assets = [];
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
          message: `Export asset ${asset}`
        },
        buffer
      );
    }
  }
  await logInfo(`Exported doc ${docId} to ${filePath}`);
  onProgress?.(`Done: 1 doc, ${assets.length} asset${assets.length !== 1 ? "s" : ""}`);
}

// src/ui.ts
function createStatusBar(plugin) {
  const el = document.createElement("span");
  el.className = "lifeos-sync-status";
  el.textContent = "";
  if (plugin && typeof plugin.addStatusBar === "function") {
    plugin.addStatusBar({ element: el });
    return el;
  }
  const host = document.querySelector("#status") || document.querySelector(".status");
  if (host) {
    host.appendChild(el);
    return el;
  }
  document.body.appendChild(el);
  return el;
}
function updateStatusBar(el, message) {
  if (!el) {
    return;
  }
  el.textContent = message;
}

// src/assets-sync.ts
async function getAllAssets() {
  await logInfo("[Assets] Scanning data/assets directory");
  const response = await fetch("/api/file/readDir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "/data/assets"
    })
  });
  const result = await response.json();
  if (result.code !== 0) {
    await logError(`Failed to read assets directory: ${result.msg}`);
    throw new Error(`Failed to read assets directory: ${result.msg}`);
  }
  const assets = [];
  for (const file of result.data || []) {
    if (file.isDir) continue;
    assets.push({
      path: file.name,
      size: file.size || 0
    });
  }
  await logInfo(`[Assets] Found ${assets.length} asset files`);
  return assets;
}
async function readAssetFile(assetPath) {
  const response = await fetch("/api/file/getFile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: `/data/assets/${assetPath}`
    })
  });
  if (!response.ok) {
    throw new Error(`Failed to read asset file: ${assetPath}`);
  }
  return await response.arrayBuffer();
}
async function uploadAssetWithCache(plugin, asset, settings, onProgress) {
  try {
    onProgress?.(`Reading ${asset.path}...`);
    const content = await readAssetFile(asset.path);
    const contentHash = await calculateFileHash(content);
    const cached = await getAssetCacheEntry(plugin, asset.path);
    if (cached && cached.contentHash === contentHash) {
      onProgress?.(`[Cache Hit] ${asset.path} unchanged, skipping`);
      return false;
    }
    onProgress?.(`[Uploading] ${asset.path} (${formatFileSize(asset.size)})`);
    const githubPath = `${settings.assetsDir}/${asset.path}`;
    const githubSHA = await uploadFileToGitHub(
      Buffer.from(content),
      githubPath,
      settings
    );
    await updateAssetCacheEntry(plugin, asset.path, {
      assetPath: asset.path,
      contentHash,
      githubSHA,
      lastSyncTime: Date.now(),
      fileSize: asset.size
    });
    onProgress?.(`[Uploaded] ${asset.path}`);
    return true;
  } catch (error) {
    onProgress?.(`[Error] ${asset.path}: ${error.message}`);
    throw error;
  }
}
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
async function uploadFileToGitHub(content, path, settings) {
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
      message: `Upload asset ${path.split("/").pop()}`
    },
    content.buffer
  );
  await logInfo(`[Assets] Upload completed: ${path}`);
  return result?.content?.sha || "unknown";
}
async function syncAllAssets(plugin, settings, onProgress) {
  const result = {
    total: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };
  try {
    onProgress?.("Loading assets list...");
    const assets = await getAllAssets();
    result.total = assets.length;
    onProgress?.(`Found ${assets.length} assets`);
    const CONCURRENCY = 5;
    for (let i = 0; i < assets.length; i += CONCURRENCY) {
      const batch = assets.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map((asset) => uploadAssetWithCache(plugin, asset, settings, onProgress))
      );
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
            error: batchResult.reason?.message || "Unknown error"
          });
        }
      }
      const processed = Math.min(i + CONCURRENCY, assets.length);
      onProgress?.(
        `Progress: ${processed}/${assets.length} (Uploaded: ${result.uploaded}, Skipped: ${result.skipped}, Failed: ${result.failed})`
      );
    }
    onProgress?.("Assets sync completed");
    return result;
  } catch (error) {
    onProgress?.(`Assets sync failed: ${error.message}`);
    throw error;
  }
}

// src/index.ts
var LifeosSyncPlugin = class extends import_siyuan.Plugin {
  constructor() {
    super(...arguments);
    this.settings = null;
    this.statusBarEl = null;
  }
  async onload() {
    this.settings = await loadSettings(this);
    initLogger();
    await logInfo("plugin loaded v0.2.0");
    this.statusBarEl = createStatusBar(this);
    this.addTopBar({
      icon: "iconSync",
      title: "LifeOS Sync",
      callback: (event) => this.openMenu(event)
    });
    await logInfo("plugin loaded");
  }
  async onunload() {
    if (this.statusBarEl) {
      this.statusBarEl.remove();
      this.statusBarEl = null;
    }
    await logInfo("plugin unloaded");
  }
  openMenu(event) {
    const menu = new import_siyuan.Menu();
    menu.addItem({
      label: "Export current doc",
      icon: "iconUpload",
      click: () => {
        void this.exportCurrentDoc();
      }
    });
    menu.addItem({
      label: "Sync all assets",
      icon: "iconImage",
      click: () => {
        void this.syncAllAssets();
      }
    });
    menu.addItem({
      label: "Configure...",
      icon: "iconSettings",
      click: () => {
        void this.openSettingsDialog();
      }
    });
    const rect = event.currentTarget.getBoundingClientRect();
    menu.open({ x: rect.right, y: rect.bottom, isLeft: true });
  }
  async openSettingsDialog() {
    if (!this.settings) {
      this.settings = await loadSettings(this);
    }
    const s = this.settings;
    const dialogId = `lifeos-settings-${Date.now()}`;
    const overlay = document.createElement("div");
    overlay.id = dialogId;
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.4)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    const card = document.createElement("div");
    card.style.width = "520px";
    card.style.maxWidth = "90vw";
    card.style.background = "var(--b3-theme-surface,#fff)";
    card.style.color = "var(--b3-theme-on-surface,#000)";
    card.style.borderRadius = "8px";
    card.style.padding = "16px";
    card.style.boxShadow = "0 6px 24px rgba(0,0,0,0.2)";
    card.style.maxHeight = "80vh";
    card.style.overflow = "auto";
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h3 style="margin:0;">LifeOS Sync Settings</h3>
        <span style="opacity:0.6; font-size:12px;">v0.2.0</span>
      </div>
      <label class="b3-label">Repo URL
        <input class="b3-text-field fn__block" id="${dialogId}-repo" value="${s.repoUrl}">
      </label>
      <label class="b3-label">Branch
        <input class="b3-text-field fn__block" id="${dialogId}-branch" value="${s.branch}">
      </label>
      <label class="b3-label">Token (PAT)
        <input class="b3-text-field fn__block" id="${dialogId}-token" type="password" value="${s.token}">
      </label>
      <label class="b3-label">Export root (empty = repo root)
        <input class="b3-text-field fn__block" id="${dialogId}-root" value="${s.exportRoot}">
      </label>
      <label class="b3-label">Assets dir
        <input class="b3-text-field fn__block" id="${dialogId}-assets" value="${s.assetsDir}">
      </label>
      <label class="b3-label">Ignore notebooks (*, comma separated)
        <input class="b3-text-field fn__block" id="${dialogId}-ignb" value="${s.ignoreNotebooks.join(", ")}">
      </label>
      <label class="b3-label">Ignore paths (*, comma separated)
        <input class="b3-text-field fn__block" id="${dialogId}-ignp" value="${s.ignorePaths.join(", ")}">
      </label>
      <label class="b3-label">Ignore tags (*, comma separated)
        <input class="b3-text-field fn__block" id="${dialogId}-ignt" value="${s.ignoreTags.join(", ")}">
      </label>
      <div class="fn__space"></div>
      <label class="b3-label">
        <div class="fn__flex">
          <div class="fn__flex-1">
            Export all assets
            <div class="b3-label__text">Export all assets from data/assets (if unchecked, only exports assets referenced in the document)</div>
          </div>
          <span class="fn__space"></span>
          <input class="b3-switch fn__flex-center" type="checkbox" id="${dialogId}-allassets" ${s.exportAllAssets ? "checked" : ""}>
        </div>
      </label>
      <label class="b3-label">
        <div class="fn__flex">
          <div class="fn__flex-1">
            Clean frontmatter
            <div class="b3-label__text">Remove YAML frontmatter from exported markdown</div>
          </div>
          <span class="fn__space"></span>
          <input class="b3-switch fn__flex-center" type="checkbox" id="${dialogId}-cleanfm" ${s.cleanFrontmatter ? "checked" : ""}>
        </div>
      </label>
      <div class="fn__space"></div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="b3-button b3-button--cancel" id="${dialogId}-cancel">Cancel</button>
        <button class="b3-button b3-button--primary" id="${dialogId}-save">Save</button>
      </div>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const q = (sel) => card.querySelector(sel);
    const destroy = () => {
      overlay.remove();
    };
    const doSave = async () => {
      this.settings = {
        ...s,
        repoUrl: (q(`#${dialogId}-repo`).value || "").trim(),
        branch: (q(`#${dialogId}-branch`).value || "").trim(),
        token: (q(`#${dialogId}-token`).value || "").trim(),
        exportRoot: (q(`#${dialogId}-root`).value || "").trim(),
        assetsDir: (q(`#${dialogId}-assets`).value || s.assetsDir).trim(),
        exportAllAssets: q(`#${dialogId}-allassets`).checked,
        cleanFrontmatter: q(`#${dialogId}-cleanfm`).checked,
        ignoreNotebooks: (q(`#${dialogId}-ignb`).value || "").split(",").map((v) => v.trim()).filter(Boolean),
        ignorePaths: (q(`#${dialogId}-ignp`).value || "").split(",").map((v) => v.trim()).filter(Boolean),
        ignoreTags: (q(`#${dialogId}-ignt`).value || "").split(",").map((v) => v.trim()).filter(Boolean)
      };
      await saveSettings(this, this.settings);
      await logInfo("Settings saved");
      destroy();
    };
    q(`#${dialogId}-save`)?.addEventListener("click", () => {
      void doSave();
    });
    q(`#${dialogId}-cancel`)?.addEventListener("click", () => destroy());
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) destroy();
    });
  }
  async exportCurrentDoc() {
    if (!this.settings) {
      return;
    }
    const { docId, blockId } = getActiveDocRefFromDOM();
    updateStatusBar(this.statusBarEl, "Export: starting...");
    try {
      await logInfo(`Active doc ref: docId=${docId}, blockId=${blockId}`);
      await exportCurrentDocToGit(this, docId, blockId, this.settings, (message) => {
        updateStatusBar(this.statusBarEl, `Export: ${message}`);
      });
      updateStatusBar(this.statusBarEl, "Export: done");
    } catch (err) {
      updateStatusBar(this.statusBarEl, "Export: failed");
      await logError("Export failed", err);
    }
  }
  async syncAllAssets() {
    if (!this.settings) {
      await logError("Settings not loaded");
      return;
    }
    updateStatusBar(this.statusBarEl, "Assets sync: starting...");
    await logInfo("[Assets] Starting full assets sync");
    try {
      const result = await syncAllAssets(
        this,
        this.settings,
        (message) => {
          updateStatusBar(this.statusBarEl, `Assets: ${message}`);
        }
      );
      const summary = `Assets sync done: ${result.uploaded} uploaded, ${result.skipped} skipped`;
      updateStatusBar(this.statusBarEl, summary);
      await logInfo(`[Assets] ${summary}, ${result.failed} failed`);
      if (result.failed > 0) {
        await logError(`[Assets] ${result.failed} assets failed to upload`, result.errors);
      }
    } catch (err) {
      updateStatusBar(this.statusBarEl, "Assets sync: failed");
      await logError("[Assets] Assets sync failed", err);
    }
  }
};
