"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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

// src/constants.ts
var SETTINGS_FILE, LOG_FILE_PATH, DEFAULT_EXPORT_ROOT, DEFAULT_ASSETS_DIR, DEFAULT_EXPORT_ALL_ASSETS;
var init_constants = __esm({
  "src/constants.ts"() {
    "use strict";
    SETTINGS_FILE = "settings.json";
    LOG_FILE_PATH = "temp/lifeos_sync.log";
    DEFAULT_EXPORT_ROOT = "";
    DEFAULT_ASSETS_DIR = "assets";
    DEFAULT_EXPORT_ALL_ASSETS = false;
  }
});

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
var init_siyuan_api = __esm({
  "src/siyuan-api.ts"() {
    "use strict";
  }
});

// src/logger.ts
var logger_exports = {};
__export(logger_exports, {
  flushAllLogs: () => flushAllLogs,
  initLogger: () => initLogger,
  logError: () => logError,
  logInfo: () => logInfo
});
function initLogger() {
  enabled = true;
}
function formatLine(level, message) {
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  return `[${ts}] [${level}] ${message}
`;
}
async function flushLogs() {
  if (logBuffer.length === 0) {
    return;
  }
  try {
    const toFlush = logBuffer.join("");
    logBuffer = [];
    const existing = await readTextFile(LOG_FILE_PATH);
    const next = existing + toFlush;
    await putFile(LOG_FILE_PATH, new Blob([next], { type: "text/plain" }));
  } catch (err) {
    console.warn("lifeos_sync log flush failed", err);
  }
}
function scheduleFlush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    void flushLogs();
    flushTimer = null;
  }, FLUSH_INTERVAL_MS);
}
async function appendLog(level, message) {
  if (!enabled) {
    return;
  }
  logBuffer.push(formatLine(level, message));
  if (logBuffer.length >= MAX_BUFFER_SIZE) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushLogs();
  } else {
    scheduleFlush();
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
async function flushAllLogs() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushLogs();
}
var enabled, logBuffer, flushTimer, FLUSH_INTERVAL_MS, MAX_BUFFER_SIZE;
var init_logger = __esm({
  "src/logger.ts"() {
    "use strict";
    init_constants();
    init_siyuan_api();
    enabled = false;
    logBuffer = [];
    flushTimer = null;
    FLUSH_INTERVAL_MS = 5e3;
    MAX_BUFFER_SIZE = 100;
  }
});

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
var init_hash_utils = __esm({
  "src/hash-utils.ts"() {
    "use strict";
  }
});

// src/cache-manager.ts
var cache_manager_exports = {};
__export(cache_manager_exports, {
  clearAllAssetCache: () => clearAllAssetCache,
  clearAllCache: () => clearAllCache,
  clearNotebookCache: () => clearNotebookCache,
  getAssetCacheEntry: () => getAssetCacheEntry,
  getDocCacheEntry: () => getDocCacheEntry,
  getNotebookDocIds: () => getNotebookDocIds,
  getTotalCachedAssets: () => getTotalCachedAssets,
  getTotalCachedDocs: () => getTotalCachedDocs,
  loadNotebookDocCache: () => loadNotebookDocCache,
  loadSyncMeta: () => loadSyncMeta,
  removeAssetCacheEntry: () => removeAssetCacheEntry,
  removeDocCacheEntry: () => removeDocCacheEntry,
  saveNotebookDocCache: () => saveNotebookDocCache,
  saveSyncMeta: () => saveSyncMeta,
  updateAssetCacheEntry: () => updateAssetCacheEntry,
  updateDocCacheEntry: () => updateDocCacheEntry,
  updateNotebookMeta: () => updateNotebookMeta
});
function getNotebookCacheFile(notebookId) {
  return `notebook-${notebookId}-docs.json`;
}
async function getAssetShard(assetPath) {
  const hash = await calculateShardHash(assetPath);
  return parseInt(hash.substring(0, 2), 16) % ASSET_SHARD_COUNT;
}
async function loadSyncMeta(plugin) {
  const meta = await plugin.loadData(SYNC_META_FILE);
  return meta || {
    lastFullSync: 0,
    notebooks: {}
  };
}
async function saveSyncMeta(plugin, meta) {
  await plugin.saveData(SYNC_META_FILE, meta);
}
async function updateNotebookMeta(plugin, notebookId, notebookName, docCount) {
  await logInfo(`[Cache] Updating notebook meta: ${notebookName} (${docCount} docs)`);
  const meta = await loadSyncMeta(plugin);
  meta.notebooks[notebookId] = {
    notebookId,
    notebookName,
    docCount,
    lastSyncTime: Date.now()
  };
  await saveSyncMeta(plugin, meta);
}
async function loadNotebookDocCache(plugin, notebookId) {
  const cacheFile = getNotebookCacheFile(notebookId);
  const cache = await plugin.loadData(cacheFile);
  return cache || {};
}
async function saveNotebookDocCache(plugin, notebookId, cache) {
  const cacheFile = getNotebookCacheFile(notebookId);
  const preview = JSON.stringify(cache).substring(0, 500);
  await logInfo(`[Cache] Saving to ${cacheFile}: ${preview}...`);
  await plugin.saveData(cacheFile, cache);
  await logInfo(`[Cache] Save completed for ${cacheFile}`);
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
  await logInfo(`[Cache] Entry data: ${JSON.stringify(entry)}`);
  const cache = await loadNotebookDocCache(plugin, notebookId);
  cache[docId] = entry;
  await saveNotebookDocCache(plugin, notebookId, cache);
}
async function removeDocCacheEntry(plugin, notebookId, docId) {
  const cache = await loadNotebookDocCache(plugin, notebookId);
  delete cache[docId];
  await saveNotebookDocCache(plugin, notebookId, cache);
}
async function getNotebookDocIds(plugin, notebookId) {
  const cache = await loadNotebookDocCache(plugin, notebookId);
  return Object.keys(cache);
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
async function removeAssetCacheEntry(plugin, assetPath) {
  const shard = await getAssetShard(assetPath);
  const cache = await loadAssetCacheShard(plugin, shard);
  delete cache[assetPath];
  await saveAssetCacheShard(plugin, shard, cache);
}
async function getTotalCachedDocs(plugin) {
  const meta = await loadSyncMeta(plugin);
  return Object.values(meta.notebooks).reduce((sum, nb) => sum + nb.docCount, 0);
}
async function getTotalCachedAssets(plugin) {
  let total = 0;
  for (let shard = 0; shard < ASSET_SHARD_COUNT; shard++) {
    const cache = await loadAssetCacheShard(plugin, shard);
    total += Object.keys(cache).length;
  }
  return total;
}
async function clearNotebookCache(plugin, notebookId) {
  const cacheFile = getNotebookCacheFile(notebookId);
  await plugin.removeData(cacheFile);
  const meta = await loadSyncMeta(plugin);
  delete meta.notebooks[notebookId];
  await saveSyncMeta(plugin, meta);
}
async function clearAllAssetCache(plugin) {
  for (let shard = 0; shard < ASSET_SHARD_COUNT; shard++) {
    const cacheFile = `assets-${shard}.json`;
    await plugin.removeData(cacheFile);
  }
}
async function clearAllCache(plugin) {
  const meta = await loadSyncMeta(plugin);
  for (const notebookId of Object.keys(meta.notebooks)) {
    const cacheFile = getNotebookCacheFile(notebookId);
    await plugin.removeData(cacheFile);
  }
  await clearAllAssetCache(plugin);
  await plugin.removeData(SYNC_META_FILE);
  await plugin.removeData("last-asset-sync-time");
}
var SYNC_META_FILE, ASSET_SHARD_COUNT;
var init_cache_manager = __esm({
  "src/cache-manager.ts"() {
    "use strict";
    init_logger();
    init_hash_utils();
    SYNC_META_FILE = "sync-meta.json";
    ASSET_SHARD_COUNT = 16;
  }
});

// src/index.ts
var src_exports = {};
__export(src_exports, {
  default: () => LifeosSyncPlugin
});
module.exports = __toCommonJS(src_exports);
var import_siyuan = require("siyuan");

// src/settings.ts
init_constants();
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
  ignoreTags: [],
  autoSync: {
    enabled: false,
    // 默认禁用自动同步
    interval: 30,
    // 默认30分钟
    syncDocs: true,
    // 同步文档
    syncAssets: true,
    // 同步资源
    onlyWhenIdle: false,
    // 不限制空闲时
    maxConcurrency: 5
    // 最大并发数
  }
};
async function loadSettings(plugin) {
  const data = await plugin.loadData(SETTINGS_FILE);
  return { ...DEFAULT_SETTINGS, ...data ?? {} };
}
async function saveSettings(plugin, settings) {
  await plugin.saveData(SETTINGS_FILE, settings);
}

// src/exporter.ts
init_constants();

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
      timeout: 3e5
      // 300 seconds (5 minutes) for large files
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
  return await writeFile(opts, body);
}
async function createOrUpdateBinaryFile(opts, buffer) {
  const sha = await getFileSha(opts);
  const body = {
    message: opts.message,
    content: base64FromArrayBuffer(buffer),
    branch: opts.branch,
    sha: sha ?? void 0
  };
  return await writeFile(opts, body);
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
    try {
      const errorData = JSON.parse(text);
      if (res.status === 409 && errorData.status === "409") {
        console.warn(`lifeos_sync: 409 conflict for ${opts.path}, retrying with fresh SHA`);
        const freshSha = await getFileSha(opts);
        body.sha = freshSha ?? void 0;
        const retryRes = await proxyFetch(url, {
          method: "PUT",
          headers: {
            Authorization: `token ${opts.token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
        if (!retryRes.ok) {
          const retryText = await retryRes.text();
          throw new Error(`GitHub write failed after retry: ${retryText}`);
        }
        const retryData = await retryRes.json();
        return retryData;
      }
    } catch (parseError) {
    }
    throw new Error(`GitHub write failed: ${text}`);
  }
  const responseData = await res.json();
  return responseData;
}

// src/exporter.ts
init_logger();
init_siyuan_api();
init_cache_manager();
init_hash_utils();
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
async function exportCurrentDocToGit(plugin, docId, blockId, settings, onProgress, skipAssets = false) {
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
  const filePath = joinPath(
    settings.exportRoot,
    sanitizeName(notebookName),
    ...hpathParts.map((p) => sanitizeName(p)),
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
  await logInfo(`[GitHub] Upload response: ${JSON.stringify(uploadResult).substring(0, 200)}`);
  let githubSHA;
  if (uploadResult && uploadResult.content && uploadResult.content.sha) {
    githubSHA = uploadResult.content.sha;
  } else if (uploadResult && uploadResult.sha) {
    githubSHA = uploadResult.sha;
  } else {
    await logError(`[GitHub] Invalid response structure: ${JSON.stringify(uploadResult)}`);
    throw new Error(`GitHub upload failed: no SHA returned for ${filePath}`);
  }
  await logInfo(`[GitHub] File uploaded, SHA: ${githubSHA}`);
  const cacheEntry = {
    docId: usedId,
    notebookId: info.box,
    githubPath: filePath,
    contentHash,
    githubSHA,
    lastSyncTime: Date.now(),
    siyuanUpdated: info.updated || Date.now()
  };
  await logInfo(`[Exporter] About to update cache with entry: ${JSON.stringify(cacheEntry)}`);
  await updateDocCacheEntry(plugin, info.box, usedId, cacheEntry);
  if (!skipAssets) {
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
  } else {
    await logInfo(`Exported doc ${docId} to ${filePath} (assets skipped - will sync separately)`);
    onProgress?.("Document uploaded (assets will sync separately)");
  }
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
  void el.offsetHeight;
}

// src/index.ts
init_logger();
init_siyuan_api();

// src/assets-sync.ts
init_cache_manager();
init_logger();
init_hash_utils();
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
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    if (asset.size > MAX_FILE_SIZE) {
      const sizeMB2 = (asset.size / (1024 * 1024)).toFixed(2);
      const msg = `[Skipped] ${asset.path} too large (${sizeMB2} MB > 100 MB limit)`;
      onProgress?.(msg);
      await logInfo(`[Assets] ${msg}`);
      return false;
    }
    onProgress?.(`[Reading] ${asset.path} (${formatFileSize(asset.size)})`);
    const content = await readAssetFile(asset.path);
    onProgress?.(`[Hashing] ${asset.path} (${formatFileSize(asset.size)})`);
    const contentHash = await calculateFileHash(content);
    const cached = await getAssetCacheEntry(plugin, asset.path);
    if (cached && cached.contentHash === contentHash) {
      onProgress?.(`[Cache Hit] ${asset.path} unchanged, skipping`);
      return false;
    }
    const sizeMB = (asset.size / (1024 * 1024)).toFixed(2);
    onProgress?.(`[Uploading] ${asset.path} (${sizeMB} MB)`);
    const githubPath = `${settings.assetsDir}/${asset.path}`;
    const githubSHA = await uploadFileToGitHub(
      Buffer.from(content),
      githubPath,
      settings
    );
    const cacheEntry = {
      assetPath: asset.path,
      contentHash,
      githubSHA,
      lastSyncTime: Date.now(),
      fileSize: asset.size
    };
    await logInfo(`[Assets] About to update cache with entry: ${JSON.stringify(cacheEntry)}`);
    await updateAssetCacheEntry(plugin, asset.path, cacheEntry);
    onProgress?.(`[\u2713 Uploaded] ${asset.path} (${sizeMB} MB)`);
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
  let githubSHA;
  if (result && result.content && result.content.sha) {
    githubSHA = result.content.sha;
  } else if (result && result.sha) {
    githubSHA = result.sha;
  } else {
    await logError(`[Assets] Invalid GitHub response for ${path}: ${JSON.stringify(result).substring(0, 200)}`);
    throw new Error(`GitHub upload failed: no SHA returned for ${path}`);
  }
  await logInfo(`[Assets] Upload completed: ${path}, SHA: ${githubSHA}`);
  return githubSHA;
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

// src/auto-sync-scheduler.ts
init_logger();

// src/incremental-sync.ts
init_logger();
init_cache_manager();
init_cache_manager();
async function getAllDocMetadata() {
  await logInfo("[IncrementalSync] Fetching all document metadata");
  const response = await fetch("/api/query/sql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stmt: `SELECT id, box, path, hpath, content AS name, updated
             FROM blocks
             WHERE type = 'd'
             ORDER BY updated DESC`
    })
  });
  const result = await response.json();
  if (result.code !== 0) {
    await logError(`Failed to query documents: ${result.msg}`);
    return [];
  }
  const docs = (result.data || []).filter((row) => {
    if (!row.id || !row.box) return false;
    if (row.box === "plugins") return false;
    if (!row.updated || typeof row.updated !== "string") return false;
    return true;
  }).map((row) => ({
    id: row.id,
    box: row.box,
    path: row.path,
    hpath: row.hpath,
    name: row.name,
    updated: row.updated
  }));
  await logInfo(`[IncrementalSync] Found ${docs.length} documents`);
  return docs;
}
async function getChangedDocuments(plugin, allDocs) {
  const startTime = Date.now();
  const changedDocs = [];
  await logInfo(`[IncrementalSync] Scanning ${allDocs.length} documents for changes`);
  for (const doc of allDocs) {
    try {
      const cached = await getDocCacheEntry(plugin, doc.box, doc.id);
      if (!cached) {
        changedDocs.push(doc);
        await logInfo(`[IncrementalSync] New doc: ${doc.id}`);
        continue;
      }
      if (doc.updated > cached.siyuanUpdated) {
        changedDocs.push(doc);
        let timeStr = "unknown";
        if (doc.updated) {
          try {
            timeStr = new Date(doc.updated).toISOString();
          } catch (e) {
            timeStr = "invalid";
          }
        }
        await logInfo(`[IncrementalSync] Modified doc: ${doc.id} (${timeStr})`);
      }
    } catch (error) {
      await logError(`[IncrementalSync] Error checking doc ${doc.id}: ${error}`);
      changedDocs.push(doc);
    }
  }
  const scanTime = Date.now() - startTime;
  await logInfo(
    `[IncrementalSync] Scan complete: ${changedDocs.length}/${allDocs.length} changed (${scanTime}ms)`
  );
  return changedDocs;
}
async function getAllAssetMetadata() {
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
  const assets = (result.data || []).filter((file) => !file.isDir).map((file) => ({
    path: file.name,
    size: file.size || 0,
    mtime: file.updated || Date.now()
    // 文件修改时间
  }));
  await logInfo(`[IncrementalSync] Found ${assets.length} assets`);
  return assets;
}
async function getChangedAssets(plugin, allAssets, lastSyncTime) {
  const startTime = Date.now();
  const changedAssets = [];
  let lastSyncTimeStr = "never";
  if (typeof lastSyncTime === "number" && lastSyncTime > 0 && !isNaN(lastSyncTime)) {
    try {
      lastSyncTimeStr = new Date(lastSyncTime).toISOString();
    } catch (e) {
      lastSyncTimeStr = "invalid";
    }
  }
  await logInfo(`[IncrementalSync] Scanning ${allAssets.length} assets for changes since ${lastSyncTimeStr}`);
  for (const asset of allAssets) {
    try {
      if (asset.mtime > lastSyncTime) {
        changedAssets.push(asset);
        await logInfo(`[IncrementalSync] Changed asset: ${asset.path}`);
        continue;
      }
      const cached = await getAssetCacheEntry(plugin, asset.path);
      if (!cached) {
        changedAssets.push(asset);
        await logInfo(`[IncrementalSync] New asset: ${asset.path}`);
      }
    } catch (error) {
      await logError(`[IncrementalSync] Error checking asset ${asset.path}: ${error}`);
      changedAssets.push(asset);
    }
  }
  const scanTime = Date.now() - startTime;
  await logInfo(
    `[IncrementalSync] Asset scan complete: ${changedAssets.length}/${allAssets.length} changed (${scanTime}ms)`
  );
  return changedAssets;
}
async function performIncrementalSync(plugin, settings, onProgress) {
  const startTime = Date.now();
  const result = {
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
  try {
    if (settings.autoSync.syncDocs) {
      onProgress?.("[Step 1/6 Scan documents] Loading document metadata...");
      const allDocs = await getAllDocMetadata();
      result.docsScanned = allDocs.length;
      await logInfo(`[IncrementalSync] Step 1/6: Scanned ${allDocs.length} documents`);
      onProgress?.("[Step 2/6 Check changes] Comparing documents with cache...");
      const changedDocs = await getChangedDocuments(plugin, allDocs);
      result.docsChanged = changedDocs.length;
      await logInfo(`[IncrementalSync] Step 2/6: Found ${changedDocs.length} changed documents`);
      if (changedDocs.length > 0) {
        onProgress?.(`[Step 3/6 Upload docs] Uploading ${changedDocs.length} documents...`);
        for (let i = 0; i < changedDocs.length; i++) {
          const doc = changedDocs[i];
          try {
            onProgress?.(`[Step 3/6] [${i + 1}/${changedDocs.length}] ${doc.name}`);
            await exportCurrentDocToGit(
              plugin,
              doc.id,
              doc.id,
              settings,
              (msg) => onProgress?.(`  ${msg}`),
              true
              // skipAssets = true
            );
            result.docsUploaded++;
          } catch (error) {
            result.docsFailed++;
            result.errors.push({
              path: `doc:${doc.id}`,
              error: error.message || String(error)
            });
            await logError(`[IncrementalSync] Failed to sync doc ${doc.id}: ${error}`);
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
    if (settings.autoSync.syncAssets) {
      onProgress?.("[Step 4/6 Scan assets] Loading asset metadata...");
      const allAssets = await getAllAssetMetadata();
      result.assetsScanned = allAssets.length;
      await logInfo(`[IncrementalSync] Step 4/6: Scanned ${allAssets.length} assets`);
      onProgress?.("[Step 5/6 Check changes] Comparing assets with cache...");
      const lastAssetSyncTime = await getLastAssetSyncTime(plugin);
      const changedAssets = await getChangedAssets(plugin, allAssets, lastAssetSyncTime);
      result.assetsChanged = changedAssets.length;
      await logInfo(`[IncrementalSync] Step 5/6: Found ${changedAssets.length} changed assets`);
      if (changedAssets.length > 0) {
        onProgress?.(`[Step 6/6 Upload assets] Uploading ${changedAssets.length} assets...`);
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
      `[IncrementalSync] Complete: Docs(${result.docsUploaded}/${result.docsChanged}), Assets(${result.assetsUploaded}/${result.assetsChanged}), Time: ${result.totalTime}ms`
    );
    return result;
  } catch (error) {
    await logError(`[IncrementalSync] Sync failed: ${error}`);
    throw error;
  }
}
var LAST_ASSET_SYNC_KEY = "last-asset-sync-time";
async function getLastAssetSyncTime(plugin) {
  const time = await plugin.loadData(LAST_ASSET_SYNC_KEY);
  return time || 0;
}
async function updateLastAssetSyncTime(plugin, time) {
  await plugin.saveData(LAST_ASSET_SYNC_KEY, time);
}

// src/auto-sync-scheduler.ts
var AutoSyncScheduler = class _AutoSyncScheduler {
  constructor(plugin, settings, onProgress) {
    this.timerId = null;
    this.isRunning = false;
    if (_AutoSyncScheduler.globalInstance) {
      void _AutoSyncScheduler.globalInstance.stop();
      _AutoSyncScheduler.globalInstance = null;
    }
    this.plugin = plugin;
    this.settings = settings;
    this.onProgress = onProgress;
    _AutoSyncScheduler.globalInstance = this;
  }
  static {
    this.globalInstance = null;
  }
  /**
   * 启动自动同步
   */
  async start() {
    if (!this.settings.autoSync.enabled) {
      await logInfo("[AutoSync] Auto sync is disabled");
      return;
    }
    if (this.timerId) {
      await logInfo("[AutoSync] Already running");
      return;
    }
    const intervalMs = this.settings.autoSync.interval * 60 * 1e3;
    await logInfo(`[AutoSync] Starting auto sync (interval: ${this.settings.autoSync.interval} minutes)`);
    void this.runSync();
    this.timerId = setInterval(() => {
      void this.runSync();
    }, intervalMs);
    await logInfo("[AutoSync] Scheduler started");
  }
  /**
   * 停止自动同步
   */
  async stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      await logInfo("[AutoSync] Scheduler stopped");
    }
  }
  /**
   * 强制停止同步（包括正在运行的任务）
   */
  async forceStop() {
    await this.stop();
    if (this.isRunning) {
      await logInfo("[AutoSync] Force stopping running sync");
      this.isRunning = false;
    }
  }
  /**
   * 获取同步状态
   */
  getIsRunning() {
    return this.isRunning;
  }
  /**
   * 执行一次同步
   */
  async runSync() {
    if (this.isRunning) {
      await logInfo("[AutoSync] Sync already running, skipping");
      return;
    }
    this.isRunning = true;
    try {
      await logInfo("[AutoSync] Starting sync cycle");
      this.onProgress?.("[AutoSync] Starting...");
      const result = await performIncrementalSync(
        this.plugin,
        this.settings,
        this.onProgress
      );
      await this.logSyncResult(result);
      this.onProgress?.(this.formatSyncResult(result));
    } catch (error) {
      await logError(`[AutoSync] Sync failed: ${error}`);
      this.onProgress?.(`[AutoSync] Failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }
  /**
   * 更新配置
   */
  updateSettings(settings) {
    this.settings = settings;
  }
  /**
   * 重启调度器（配置变更后）
   */
  async restart() {
    await this.stop();
    await this.start();
  }
  /**
   * 记录同步结果
   */
  async logSyncResult(result) {
    await logInfo(
      `[AutoSync] Sync complete:
  Documents: ${result.docsUploaded} uploaded, ${result.docsSkipped} skipped, ${result.docsFailed} failed (${result.docsScanned} scanned, ${result.docsChanged} changed)
  Assets: ${result.assetsUploaded} uploaded, ${result.assetsSkipped} skipped, ${result.assetsFailed} failed (${result.assetsScanned} scanned, ${result.assetsChanged} changed)
  Time: ${(result.totalTime / 1e3).toFixed(1)}s`
    );
    if (result.errors.length > 0) {
      await logError(`[AutoSync] ${result.errors.length} errors occurred:
${result.errors.map((e) => `  ${e.path}: ${e.error}`).join("\n")}`);
    }
  }
  /**
   * 格式化同步结果（用于状态栏显示）
   */
  formatSyncResult(result) {
    const docs = result.docsUploaded > 0 ? `${result.docsUploaded} docs` : "";
    const assets = result.assetsUploaded > 0 ? `${result.assetsUploaded} assets` : "";
    const parts = [docs, assets].filter(Boolean);
    if (parts.length === 0) {
      return "[AutoSync] No changes";
    }
    return `[AutoSync] Synced: ${parts.join(", ")} (${(result.totalTime / 1e3).toFixed(1)}s)`;
  }
  /**
   * 获取调度器状态
   */
  isActive() {
    return this.timerId !== null;
  }
  /**
   * 手动触发一次同步
   */
  async triggerSync() {
    await logInfo("[AutoSync] Manual sync triggered");
    this.onProgress?.("[AutoSync] Manual sync...");
    const result = await performIncrementalSync(
      this.plugin,
      this.settings,
      this.onProgress
    );
    await this.logSyncResult(result);
    return result;
  }
};

// src/index.ts
var LifeosSyncPlugin = class extends import_siyuan.Plugin {
  constructor() {
    super(...arguments);
    this.settings = null;
    this.statusBarEl = null;
    this.autoSyncScheduler = null;
  }
  async onload() {
    this.settings = await loadSettings(this);
    initLogger();
    await logInfo("plugin loaded v0.3.3");
    this.statusBarEl = createStatusBar(this);
    this.addTopBar({
      icon: "iconSync",
      title: "LifeOS Sync",
      callback: (event) => this.openMenu(event)
    });
    if (this.settings.autoSync.enabled) {
      this.autoSyncScheduler = new AutoSyncScheduler(
        this,
        this.settings,
        (message) => updateStatusBar(this.statusBarEl, message)
      );
      await this.autoSyncScheduler.start();
      await logInfo("Auto sync scheduler started");
    }
    await logInfo("plugin loaded");
  }
  async onunload() {
    if (this.autoSyncScheduler) {
      await this.autoSyncScheduler.stop();
      this.autoSyncScheduler = null;
    }
    const { flushAllLogs: flushAllLogs2 } = await Promise.resolve().then(() => (init_logger(), logger_exports));
    await flushAllLogs2();
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
      label: `Auto sync: ${this.settings?.autoSync.enabled ? "ON" : "OFF"}`,
      icon: "iconRefresh",
      click: () => {
        void this.toggleAutoSync();
      }
    });
    menu.addItem({
      label: "\u{1F504} Clear cache & full sync",
      icon: "iconTrashcan",
      click: () => {
        void this.clearCacheAndFullSync();
      }
    });
    if (this.autoSyncScheduler?.getIsRunning()) {
      menu.addItem({
        label: "\u26A0\uFE0F Force Stop Sync",
        icon: "iconClose",
        click: () => {
          void this.forceStopSync();
        }
      });
    }
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
        <span style="opacity:0.6; font-size:12px;">v0.3.3</span>
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
      <h4 style="margin-top:16px;margin-bottom:8px;">Auto Sync</h4>
      <label class="b3-label">
        <div class="fn__flex">
          <div class="fn__flex-1">
            Enable auto sync
            <div class="b3-label__text">Automatically sync changes to GitHub at regular intervals</div>
          </div>
          <span class="fn__space"></span>
          <input class="b3-switch fn__flex-center" type="checkbox" id="${dialogId}-autosync" ${s.autoSync.enabled ? "checked" : ""}>
        </div>
      </label>
      <label class="b3-label">Sync interval (minutes)
        <input class="b3-text-field fn__block" type="number" id="${dialogId}-interval" value="${s.autoSync.interval}" min="1" max="1440">
      </label>
      <label class="b3-label">
        <div class="fn__flex">
          <div class="fn__flex-1">
            Sync documents
          </div>
          <span class="fn__space"></span>
          <input class="b3-switch fn__flex-center" type="checkbox" id="${dialogId}-syncdocs" ${s.autoSync.syncDocs ? "checked" : ""}>
        </div>
      </label>
      <label class="b3-label">
        <div class="fn__flex">
          <div class="fn__flex-1">
            Sync assets
          </div>
          <span class="fn__space"></span>
          <input class="b3-switch fn__flex-center" type="checkbox" id="${dialogId}-syncassets" ${s.autoSync.syncAssets ? "checked" : ""}>
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
      const oldAutoSyncEnabled = this.settings.autoSync.enabled;
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
        ignoreTags: (q(`#${dialogId}-ignt`).value || "").split(",").map((v) => v.trim()).filter(Boolean),
        autoSync: {
          enabled: q(`#${dialogId}-autosync`).checked,
          interval: parseInt(q(`#${dialogId}-interval`).value) || 30,
          syncDocs: q(`#${dialogId}-syncdocs`).checked,
          syncAssets: q(`#${dialogId}-syncassets`).checked,
          onlyWhenIdle: false,
          maxConcurrency: 5
        }
      };
      await saveSettings(this, this.settings);
      if (this.settings.autoSync.enabled !== oldAutoSyncEnabled || this.settings.autoSync.enabled) {
        if (this.autoSyncScheduler) {
          await this.autoSyncScheduler.stop();
          this.autoSyncScheduler = null;
        }
        if (this.settings.autoSync.enabled) {
          this.autoSyncScheduler = new AutoSyncScheduler(
            this,
            this.settings,
            (message) => updateStatusBar(this.statusBarEl, message)
          );
          await this.autoSyncScheduler.start();
        }
      } else if (this.autoSyncScheduler) {
        this.autoSyncScheduler.updateSettings(this.settings);
        await this.autoSyncScheduler.restart();
      }
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
  async forceStopSync() {
    if (this.autoSyncScheduler) {
      await this.autoSyncScheduler.forceStop();
      updateStatusBar(this.statusBarEl, "Sync force stopped");
      await logInfo("Sync force stopped by user");
    }
  }
  async clearCacheAndFullSync() {
    try {
      updateStatusBar(this.statusBarEl, "Clearing cache...");
      await logInfo("[ClearCache] Starting to clear all cache");
      const { clearAllCache: clearAllCache2 } = await Promise.resolve().then(() => (init_cache_manager(), cache_manager_exports));
      await clearAllCache2(this);
      await logInfo("[ClearCache] All cache cleared successfully");
      updateStatusBar(this.statusBarEl, "Cache cleared. Starting full sync...");
      if (this.autoSyncScheduler) {
        await this.autoSyncScheduler.stop();
        this.autoSyncScheduler = null;
      }
      this.autoSyncScheduler = new AutoSyncScheduler(
        this,
        this.settings,
        (message) => updateStatusBar(this.statusBarEl, message)
      );
      await this.autoSyncScheduler.start();
      await logInfo("[ClearCache] Full sync triggered");
    } catch (error) {
      await logError(`[ClearCache] Failed: ${error}`);
      updateStatusBar(this.statusBarEl, `Clear cache failed: ${error.message}`);
    }
  }
  async toggleAutoSync() {
    if (!this.settings) {
      return;
    }
    this.settings.autoSync.enabled = !this.settings.autoSync.enabled;
    await saveSettings(this, this.settings);
    if (this.settings.autoSync.enabled) {
      this.autoSyncScheduler = new AutoSyncScheduler(
        this,
        this.settings,
        (message) => updateStatusBar(this.statusBarEl, message)
      );
      await this.autoSyncScheduler.start();
      await logInfo("Auto sync enabled");
      updateStatusBar(this.statusBarEl, "Auto sync: ON");
    } else {
      if (this.autoSyncScheduler) {
        await this.autoSyncScheduler.stop();
        this.autoSyncScheduler = null;
      }
      await logInfo("Auto sync disabled");
      updateStatusBar(this.statusBarEl, "Auto sync: OFF");
    }
  }
};
