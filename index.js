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
async function readDir(path) {
  return await apiPost("/api/file/readDir", { path });
}
function clearNotebooksCache() {
  notebooksCache = null;
}
async function listNotebooks() {
  if (notebooksCache !== null) {
    return notebooksCache;
  }
  notebooksCache = await apiPost("/api/notebook/lsNotebooks", {});
  return notebooksCache;
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
var notebooksCache;
var init_siyuan_api = __esm({
  "src/siyuan-api.ts"() {
    "use strict";
    notebooksCache = null;
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
  logBuffer = [];
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
    const lines = logBuffer.slice(-MAX_LOG_LINES);
    const content = lines.join("");
    await putFile(LOG_FILE_PATH, new Blob([content], { type: "text/plain" }));
    logBuffer = [];
  } catch (err) {
    console.warn("lifeos_sync log flush failed", err);
  }
}
async function appendLog(level, message) {
  if (!enabled) {
    return;
  }
  logBuffer.push(formatLine(level, message));
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
  await flushLogs();
}
var enabled, logBuffer, MAX_LOG_LINES;
var init_logger = __esm({
  "src/logger.ts"() {
    "use strict";
    init_constants();
    init_siyuan_api();
    enabled = false;
    logBuffer = [];
    MAX_LOG_LINES = 1e3;
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
  clearMemoryCache: () => clearMemoryCache,
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
function clearMemoryCache() {
  notebookCacheMemory.clear();
  assetCacheMemory.clear();
}
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
  if (notebookCacheMemory.has(notebookId)) {
    const memCache = notebookCacheMemory.get(notebookId);
    const keyCount = Object.keys(memCache).length;
    await logInfo(`[Cache] Notebook ${notebookId} loaded from memory (${keyCount} docs)`);
    return memCache;
  }
  const cacheFile = getNotebookCacheFile(notebookId);
  await logInfo(`[Cache] Loading notebook ${notebookId} from file: ${cacheFile}`);
  let cache = null;
  try {
    cache = await plugin.loadData(cacheFile);
    if (cache) {
      const keyCount = Object.keys(cache).length;
      await logInfo(`[Cache] Notebook ${notebookId} loaded successfully (${keyCount} docs)`);
    } else {
      await logInfo(`[Cache] Notebook ${notebookId} file not found or empty`);
    }
  } catch (error) {
    await logError(`[Cache] Failed to load notebook ${notebookId}`, error);
  }
  const result = cache || {};
  const finalKeyCount = Object.keys(result).length;
  await logInfo(`[Cache] Notebook ${notebookId} final result: ${finalKeyCount} docs`);
  notebookCacheMemory.set(notebookId, result);
  return result;
}
async function saveNotebookDocCache(plugin, notebookId, cache) {
  const cacheFile = getNotebookCacheFile(notebookId);
  const preview = JSON.stringify(cache).substring(0, 500);
  await logInfo(`[Cache] Saving to ${cacheFile}: ${preview}...`);
  await plugin.saveData(cacheFile, cache);
  await logInfo(`[Cache] Save completed for ${cacheFile}`);
  notebookCacheMemory.set(notebookId, cache);
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
  if (assetCacheMemory.has(shard)) {
    const memCache = assetCacheMemory.get(shard);
    const keyCount = Object.keys(memCache).length;
    await logInfo(`[Cache] Asset shard ${shard} loaded from memory (${keyCount} entries)`);
    return memCache;
  }
  const cacheFile = `assets-${shard}.json`;
  await logInfo(`[Cache] Loading asset shard ${shard} from file: ${cacheFile}`);
  let cache = null;
  try {
    cache = await plugin.loadData(cacheFile);
    if (cache) {
      const keyCount = Object.keys(cache).length;
      await logInfo(`[Cache] Asset shard ${shard} loaded successfully (${keyCount} entries)`);
    } else {
      await logInfo(`[Cache] Asset shard ${shard} file not found or empty`);
    }
  } catch (error) {
    await logError(`[Cache] Failed to load asset shard ${shard}`, error);
  }
  const result = cache || {};
  const finalKeyCount = Object.keys(result).length;
  await logInfo(`[Cache] Asset shard ${shard} final result: ${finalKeyCount} entries`);
  assetCacheMemory.set(shard, result);
  return result;
}
async function saveAssetCacheShard(plugin, shard, cache) {
  const cacheFile = `assets-${shard}.json`;
  await plugin.saveData(cacheFile, cache);
  assetCacheMemory.set(shard, cache);
}
async function getAssetCacheEntry(plugin, assetPath) {
  const expectedShard = await getAssetShard(assetPath);
  const expectedCache = await loadAssetCacheShard(plugin, expectedShard);
  if (expectedCache[assetPath]) {
    await logInfo(`[Cache] Asset cache HIT: ${assetPath} (shard ${expectedShard})`);
    return expectedCache[assetPath];
  }
  await logInfo(`[Cache] Asset not found in expected shard ${expectedShard}, scanning all shards...`);
  for (let shard = 0; shard < ASSET_SHARD_COUNT; shard++) {
    if (shard === expectedShard) continue;
    const cache = await loadAssetCacheShard(plugin, shard);
    if (cache[assetPath]) {
      await logInfo(`[Cache] Asset cache HIT: ${assetPath} (found in shard ${shard}, expected ${expectedShard})`);
      return cache[assetPath];
    }
  }
  await logInfo(`[Cache] Asset cache MISS: ${assetPath} - NOT found in any of ${ASSET_SHARD_COUNT} shards`);
  return null;
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
var SYNC_META_FILE, ASSET_SHARD_COUNT, notebookCacheMemory, assetCacheMemory;
var init_cache_manager = __esm({
  "src/cache-manager.ts"() {
    "use strict";
    init_logger();
    init_hash_utils();
    SYNC_META_FILE = "sync-meta.json";
    ASSET_SHARD_COUNT = 16;
    notebookCacheMemory = /* @__PURE__ */ new Map();
    assetCacheMemory = /* @__PURE__ */ new Map();
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
  },
  syncLock: {
    enabled: true,
    // 默认启用分布式锁
    lockTtl: 10 * 60 * 1e3,
    // 10 分钟
    firstCheckThreshold: 10 * 60 * 1e3,
    // 10 分钟
    secondCheckThreshold: 5 * 60 * 1e3,
    // 5 分钟
    jitterRange: 15 * 1e3
    // 15 秒
  }
};
async function loadSettings(plugin) {
  const data = await plugin.loadData(SETTINGS_FILE);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...data ?? {},
    autoSync: {
      ...DEFAULT_SETTINGS.autoSync,
      ...data?.autoSync ?? {}
    },
    syncLock: {
      ...DEFAULT_SETTINGS.syncLock,
      ...data?.syncLock ?? {}
    }
  };
  return settings;
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
  return markdown.replace(/(!?)(\[[^\]]*\])\(([^)]+)\)/g, (full, exclaim, label, url) => {
    const idx = url.indexOf("assets/");
    if (idx < 0) {
      return full;
    }
    const rel = url.slice(idx + "assets/".length);
    const next = `${relativePrefix}${rel}`;
    return `${exclaim}${label}(${next})`;
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
  markdown = markdown.replace(/(?<!!)\[([^\]]*?)\]\((\.\.\/assets\/[^)]+)\)/g, "![$1]($2)");
  await logInfo(`[Export] Fixed image link format for: ${docId}`);
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

// src/sync-lock.ts
init_logger();

// src/device-manager.ts
init_logger();
var STORAGE_KEY_DEVICE_ID = "lifeos-sync-device-id";
var STORAGE_KEY_DEVICE_NAME = "lifeos-sync-device-name";
var STORAGE_KEY_DEVICE_CREATED = "lifeos-sync-device-created";
var SESSION_KEY_TAB_ID = "lifeos-sync-tab-id";
var SESSION_KEY_TAB_NAME = "lifeos-sync-tab-name";
var SESSION_KEY_TAB_CREATED = "lifeos-sync-tab-created";
var STORAGE_KEY_TAB_COUNTER = "lifeos-sync-tab-counter";
function generateDeviceId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function guessDefaultDeviceName() {
  try {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("electron")) {
      if (ua.includes("windows")) return "Desktop-Windows";
      if (ua.includes("mac")) return "Desktop-Mac";
      if (ua.includes("linux")) return "Desktop-Linux";
      return "Desktop";
    }
    if (ua.includes("android")) return "Android";
    if (ua.includes("iphone")) return "iPhone";
    if (ua.includes("ipad")) return "iPad";
    const hostname = window.location.hostname;
    if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        return `Browser-${hostname}`;
      }
      return `Browser-${hostname.split(".")[0]}`;
    }
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "Localhost-Browser";
    }
    return "Unknown-Device";
  } catch (e) {
    return "Unknown-Device";
  }
}
function getDeviceId() {
  try {
    let deviceId = localStorage.getItem(STORAGE_KEY_DEVICE_ID);
    if (!deviceId) {
      deviceId = generateDeviceId();
      localStorage.setItem(STORAGE_KEY_DEVICE_ID, deviceId);
      localStorage.setItem(STORAGE_KEY_DEVICE_CREATED, Date.now().toString());
      if (!localStorage.getItem(STORAGE_KEY_DEVICE_NAME)) {
        const defaultName = guessDefaultDeviceName();
        localStorage.setItem(STORAGE_KEY_DEVICE_NAME, defaultName);
      }
      console.log(`[DeviceManager] Generated new device ID: ${deviceId}`);
    }
    return deviceId;
  } catch (e) {
    console.error("[DeviceManager] localStorage not available, using session ID");
    return `temp-${generateDeviceId()}`;
  }
}
function getDeviceName() {
  try {
    const name = localStorage.getItem(STORAGE_KEY_DEVICE_NAME);
    if (name) {
      return name;
    }
    const defaultName = guessDefaultDeviceName();
    localStorage.setItem(STORAGE_KEY_DEVICE_NAME, defaultName);
    return defaultName;
  } catch (e) {
    return "Unknown-Device";
  }
}
function setDeviceName(name) {
  try {
    const trimmedName = name.trim();
    if (trimmedName) {
      localStorage.setItem(STORAGE_KEY_DEVICE_NAME, trimmedName);
      console.log(`[DeviceManager] Device name set to: ${trimmedName}`);
    }
  } catch (e) {
    console.error("[DeviceManager] Failed to set device name:", e);
  }
}
function getDeviceInfo() {
  const deviceId = getDeviceId();
  const deviceName = getDeviceName();
  let createdAt = 0;
  try {
    const createdStr = localStorage.getItem(STORAGE_KEY_DEVICE_CREATED);
    if (createdStr) {
      createdAt = parseInt(createdStr, 10);
    }
  } catch (e) {
  }
  return {
    deviceId,
    deviceName,
    createdAt
  };
}
function regenerateDeviceId() {
  try {
    const newId = generateDeviceId();
    localStorage.setItem(STORAGE_KEY_DEVICE_ID, newId);
    localStorage.setItem(STORAGE_KEY_DEVICE_CREATED, Date.now().toString());
    console.log(`[DeviceManager] Regenerated device ID: ${newId}`);
    return newId;
  } catch (e) {
    console.error("[DeviceManager] Failed to regenerate device ID:", e);
    return getDeviceId();
  }
}
function getShortDeviceId() {
  const fullId = getDeviceId();
  return fullId.substring(0, 8);
}
function getNextTabNumber() {
  try {
    const currentStr = localStorage.getItem(STORAGE_KEY_TAB_COUNTER);
    const current = currentStr ? parseInt(currentStr, 10) : 0;
    const next = current + 1;
    localStorage.setItem(STORAGE_KEY_TAB_COUNTER, next.toString());
    return next;
  } catch (e) {
    return Math.floor(Math.random() * 1e3) + 1;
  }
}
function generateShortTabId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
function getTabId() {
  try {
    let tabId = sessionStorage.getItem(SESSION_KEY_TAB_ID);
    if (!tabId) {
      tabId = generateShortTabId();
      sessionStorage.setItem(SESSION_KEY_TAB_ID, tabId);
      sessionStorage.setItem(SESSION_KEY_TAB_CREATED, Date.now().toString());
      const tabNumber = getNextTabNumber();
      sessionStorage.setItem(SESSION_KEY_TAB_NAME, `#${tabNumber}`);
      console.log(`[DeviceManager] New tab session: #${tabNumber} (${tabId})`);
    }
    return tabId;
  } catch (e) {
    console.error("[DeviceManager] sessionStorage not available");
    return `temp-${generateShortTabId()}`;
  }
}
function getTabNumber() {
  try {
    const tabName = sessionStorage.getItem(SESSION_KEY_TAB_NAME);
    if (tabName && tabName.startsWith("#")) {
      return parseInt(tabName.substring(1), 10) || 0;
    }
    getTabId();
    const newTabName = sessionStorage.getItem(SESSION_KEY_TAB_NAME);
    if (newTabName && newTabName.startsWith("#")) {
      return parseInt(newTabName.substring(1), 10) || 0;
    }
    return 0;
  } catch (e) {
    return 0;
  }
}
function getTabName() {
  try {
    const name = sessionStorage.getItem(SESSION_KEY_TAB_NAME);
    if (name) {
      return name;
    }
    getTabId();
    return sessionStorage.getItem(SESSION_KEY_TAB_NAME) || "#?";
  } catch (e) {
    return "#?";
  }
}
function getTabInfo() {
  const tabId = getTabId();
  const tabName = getTabName();
  const tabNumber = getTabNumber();
  let createdAt = 0;
  try {
    const createdStr = sessionStorage.getItem(SESSION_KEY_TAB_CREATED);
    if (createdStr) {
      createdAt = parseInt(createdStr, 10);
    }
  } catch (e) {
  }
  return {
    tabId,
    tabName,
    tabNumber,
    createdAt
  };
}
function getFullIdentity() {
  const device = getDeviceInfo();
  const tab = getTabInfo();
  const isElectron = typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("electron");
  const displayName = isElectron ? device.deviceName : `${device.deviceName} ${tab.tabName}`;
  const uniqueId = `${device.deviceId}-tab-${tab.tabId}`;
  return {
    device,
    tab,
    displayName,
    uniqueId
  };
}
function isBrowserEnvironment() {
  try {
    const ua = navigator.userAgent.toLowerCase();
    return !ua.includes("electron");
  } catch (e) {
    return false;
  }
}
async function initDeviceManager() {
  const device = getDeviceInfo();
  const tab = getTabInfo();
  const identity = getFullIdentity();
  await logInfo(`[DeviceManager] Initialized: ${identity.displayName} (device: ${device.deviceId.substring(0, 8)}..., tab: ${tab.tabId})`);
}

// src/sync-lock.ts
var LOCK_FILE_PATH = ".sync-in-progress";
var DEFAULT_SYNC_LOCK_SETTINGS = {
  enabled: true,
  lockTtl: 10 * 60 * 1e3,
  // 10 分钟
  firstCheckThreshold: 10 * 60 * 1e3,
  // 10 分钟
  secondCheckThreshold: 5 * 60 * 1e3,
  // 5 分钟
  jitterRange: 15 * 1e3
  // 15 秒
};
function formatTimeReadable(timestamp) {
  try {
    const date = new Date(timestamp);
    const utc8Offset = 8 * 60 * 60 * 1e3;
    const utc8Date = new Date(date.getTime() + utc8Offset);
    const year = utc8Date.getUTCFullYear();
    const month = String(utc8Date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(utc8Date.getUTCDate()).padStart(2, "0");
    const hours = String(utc8Date.getUTCHours()).padStart(2, "0");
    const minutes = String(utc8Date.getUTCMinutes()).padStart(2, "0");
    const seconds = String(utc8Date.getUTCSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} (UTC+8)`;
  } catch (e) {
    return "Invalid Date";
  }
}
function calculateJitter(deviceId, jitterRange) {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    const char = deviceId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  const absHash = Math.abs(hash);
  return absHash % jitterRange;
}
function formatRemainingTime(milliseconds) {
  if (milliseconds <= 0) return "0s";
  const seconds = Math.ceil(milliseconds / 1e3);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
async function proxyFetch2(url, options) {
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      method: options.method || "GET",
      headers,
      payload,
      timeout: 3e4
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
    }
  };
}
async function getLastCommitTime(settings) {
  const repo = parseRepoUrl(settings.repoUrl);
  if (!repo) {
    throw new Error("Invalid repo URL");
  }
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${settings.branch}`;
  try {
    const res = await proxyFetch2(url, {
      method: "GET",
      headers: {
        Authorization: `token ${settings.token}`,
        Accept: "application/vnd.github+json"
      }
    });
    if (!res.ok) {
      if (res.status === 404) {
        return 0;
      }
      const text = await res.text();
      throw new Error(`Failed to get last commit: ${text}`);
    }
    const data = await res.json();
    if (data && data.commit && data.commit.author && data.commit.author.date) {
      return new Date(data.commit.author.date).getTime();
    }
    return 0;
  } catch (e) {
    await logError(`[SyncLock] Failed to get last commit time: ${e}`);
    return 0;
  }
}
async function getSyncLock(settings) {
  const repo = parseRepoUrl(settings.repoUrl);
  if (!repo) {
    throw new Error("Invalid repo URL");
  }
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${LOCK_FILE_PATH}?ref=${settings.branch}`;
  try {
    const res = await proxyFetch2(url, {
      method: "GET",
      headers: {
        Authorization: `token ${settings.token}`,
        Accept: "application/vnd.github+json"
      }
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get lock file: ${text}`);
    }
    const data = await res.json();
    if (data && data.content) {
      const content = atob(data.content.replace(/\n/g, ""));
      const lockInfo = JSON.parse(content);
      return lockInfo;
    }
    return null;
  } catch (e) {
    await logError(`[SyncLock] Failed to get sync lock: ${e}`);
    return null;
  }
}
async function getLockFileSha(settings) {
  const repo = parseRepoUrl(settings.repoUrl);
  if (!repo) {
    return null;
  }
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${LOCK_FILE_PATH}?ref=${settings.branch}`;
  try {
    const res = await proxyFetch2(url, {
      method: "GET",
      headers: {
        Authorization: `token ${settings.token}`,
        Accept: "application/vnd.github+json"
      }
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return data && data.sha ? data.sha : null;
  } catch (e) {
    return null;
  }
}
async function createSyncLock(settings, lockSettings) {
  const repo = parseRepoUrl(settings.repoUrl);
  if (!repo) {
    throw new Error("Invalid repo URL");
  }
  const deviceId = getDeviceId();
  const deviceName = getDeviceName();
  const now = Date.now();
  const lockInfo = {
    deviceId,
    deviceName,
    startTime: now,
    startTimeReadable: formatTimeReadable(now),
    ttl: lockSettings.lockTtl,
    expiresAt: now + lockSettings.lockTtl,
    expiresAtReadable: formatTimeReadable(now + lockSettings.lockTtl)
  };
  const content = JSON.stringify(lockInfo, null, 2);
  const base64Content = btoa(unescape(encodeURIComponent(content)));
  const existingSha = await getLockFileSha(settings);
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${LOCK_FILE_PATH}`;
  try {
    const body = {
      message: `[LifeOS Sync] Lock acquired by ${deviceName}`,
      content: base64Content,
      branch: settings.branch
    };
    if (existingSha) {
      body.sha = existingSha;
    }
    const res = await proxyFetch2(url, {
      method: "PUT",
      headers: {
        Authorization: `token ${settings.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      await logError(`[SyncLock] Failed to create lock: ${text}`);
      return false;
    }
    await logInfo(`[SyncLock] Lock acquired by ${deviceName} (${deviceId.substring(0, 8)})`);
    return true;
  } catch (e) {
    await logError(`[SyncLock] Failed to create lock: ${e}`);
    return false;
  }
}
async function releaseSyncLock(settings) {
  const repo = parseRepoUrl(settings.repoUrl);
  if (!repo) {
    return false;
  }
  const sha = await getLockFileSha(settings);
  if (!sha) {
    return true;
  }
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${LOCK_FILE_PATH}`;
  const deviceName = getDeviceName();
  try {
    const res = await proxyFetch2(url, {
      method: "DELETE",
      headers: {
        Authorization: `token ${settings.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `[LifeOS Sync] Lock released by ${deviceName}`,
        sha,
        branch: settings.branch
      })
    });
    if (!res.ok) {
      const text = await res.text();
      await logError(`[SyncLock] Failed to release lock: ${text}`);
      return false;
    }
    await logInfo(`[SyncLock] Lock released by ${deviceName}`);
    return true;
  } catch (e) {
    await logError(`[SyncLock] Failed to release lock: ${e}`);
    return false;
  }
}
async function checkCanSync(settings, lockSettings, onStatus) {
  const deviceId = getDeviceId();
  const deviceName = getDeviceName();
  await logInfo(`[SyncLock] Checking sync eligibility for ${deviceName}`);
  onStatus?.("Checking for existing sync lock...");
  const existingLock = await getSyncLock(settings);
  if (existingLock) {
    const now = Date.now();
    if (existingLock.deviceId === deviceId) {
      await logInfo(`[SyncLock] Found stale lock from this device, will override`);
      return { canSync: true };
    }
    if (now < existingLock.expiresAt) {
      const remainingTime = existingLock.expiresAt - now;
      const reason = `${existingLock.deviceName} is syncing (expires in ${formatRemainingTime(remainingTime)})`;
      await logInfo(`[SyncLock] Cannot sync: ${reason}`);
      return {
        canSync: false,
        reason,
        lockInfo: existingLock
      };
    } else {
      await logInfo(`[SyncLock] Found expired lock from ${existingLock.deviceName}, will override`);
    }
  }
  onStatus?.("Checking last commit time...");
  const lastCommitTime = await getLastCommitTime(settings);
  if (lastCommitTime > 0) {
    const timeSinceLastCommit = Date.now() - lastCommitTime;
    if (timeSinceLastCommit < lockSettings.firstCheckThreshold) {
      const threshold = lockSettings.firstCheckThreshold / 6e4;
      const sinceMinutes = Math.floor(timeSinceLastCommit / 6e4);
      const reason = `Last sync ${sinceMinutes}m ago (threshold: ${threshold}m)`;
      await logInfo(`[SyncLock] Cannot sync: ${reason}`);
      return {
        canSync: false,
        reason
      };
    }
  }
  const jitterTime = calculateJitter(deviceId, lockSettings.jitterRange);
  await logInfo(`[SyncLock] Jitter time calculated: ${jitterTime}ms`);
  return {
    canSync: true,
    waitTime: jitterTime
  };
}
async function waitWithCountdown(milliseconds, onCountdown) {
  const startTime = Date.now();
  const endTime = startTime + milliseconds;
  return new Promise((resolve) => {
    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, endTime - now);
      if (remaining > 0) {
        onCountdown?.(remaining);
        setTimeout(tick, 1e3);
      } else {
        onCountdown?.(0);
        resolve();
      }
    };
    tick();
  });
}
async function checkCanSyncAfterJitter(settings, lockSettings, onStatus) {
  const deviceId = getDeviceId();
  const deviceName = getDeviceName();
  await logInfo(`[SyncLock] Second check after jitter for ${deviceName}`);
  onStatus?.("Double-checking for sync lock...");
  const existingLock = await getSyncLock(settings);
  if (existingLock) {
    const now = Date.now();
    if (existingLock.deviceId === deviceId) {
      return { canSync: true };
    }
    if (now < existingLock.expiresAt) {
      const remainingTime = existingLock.expiresAt - now;
      const reason = `${existingLock.deviceName} acquired lock during jitter (expires in ${formatRemainingTime(remainingTime)})`;
      await logInfo(`[SyncLock] Cannot sync after jitter: ${reason}`);
      return {
        canSync: false,
        reason,
        lockInfo: existingLock
      };
    }
  }
  onStatus?.("Double-checking last commit time...");
  const lastCommitTime = await getLastCommitTime(settings);
  if (lastCommitTime > 0) {
    const timeSinceLastCommit = Date.now() - lastCommitTime;
    if (timeSinceLastCommit < lockSettings.secondCheckThreshold) {
      const threshold = lockSettings.secondCheckThreshold / 6e4;
      const sinceMinutes = Math.floor(timeSinceLastCommit / 6e4);
      const reason = `Someone synced during jitter (${sinceMinutes}m ago, threshold: ${threshold}m)`;
      await logInfo(`[SyncLock] Cannot sync after jitter: ${reason}`);
      return {
        canSync: false,
        reason
      };
    }
  }
  await logInfo(`[SyncLock] Second check passed, can proceed with sync`);
  return { canSync: true };
}
async function acquireSyncLock(settings, lockSettings, onStatus, onCountdown) {
  if (!lockSettings.enabled) {
    await logInfo("[SyncLock] Lock mechanism disabled, proceeding with sync");
    return { canSync: true };
  }
  const firstCheck = await checkCanSync(settings, lockSettings, onStatus);
  if (!firstCheck.canSync) {
    return firstCheck;
  }
  if (firstCheck.waitTime && firstCheck.waitTime > 0) {
    onStatus?.(`Waiting ${Math.ceil(firstCheck.waitTime / 1e3)}s to avoid conflicts...`);
    await waitWithCountdown(firstCheck.waitTime, onCountdown);
  }
  const secondCheck = await checkCanSyncAfterJitter(settings, lockSettings, onStatus);
  if (!secondCheck.canSync) {
    return secondCheck;
  }
  onStatus?.("Acquiring sync lock...");
  const lockCreated = await createSyncLock(settings, lockSettings);
  if (!lockCreated) {
    return {
      canSync: false,
      reason: "Failed to create lock file"
    };
  }
  return { canSync: true };
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
function showJitterCountdown(el, remainingMs) {
  const seconds = Math.ceil(remainingMs / 1e3);
  updateStatusBar(el, `\u23F3 Waiting to sync... (${seconds}s)`);
}
function showSyncCompleteStatus(el, docs, assets, timeSeconds) {
  updateStatusBar(el, `\u2705 Sync complete: ${docs} docs, ${assets} assets (${timeSeconds.toFixed(1)}s)`);
}
function showSyncErrorStatus(el, error) {
  const shortError = error.length > 50 ? error.substring(0, 47) + "..." : error;
  updateStatusBar(el, `\u274C Sync failed: ${shortError}`);
}
function showSyncSkippedStatus(el, reason) {
  updateStatusBar(el, `\u23F8\uFE0F Sync skipped: ${reason}`);
}
function showForceSyncStatus(el) {
  updateStatusBar(el, `\u26A0\uFE0F Force sync in progress...`);
}
async function showForceConfirmDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
    `;
    const dialog = document.createElement("div");
    dialog.style.cssText = `
      background: var(--b3-theme-background, #fff);
      border-radius: 8px;
      padding: 20px;
      max-width: 400px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;
    dialog.innerHTML = `
      <h3 style="margin: 0 0 12px 0; color: var(--b3-theme-on-background, #333);">
        \u26A0\uFE0F Force Sync Confirmation
      </h3>
      <p style="margin: 0 0 16px 0; color: var(--b3-theme-on-surface, #666); font-size: 14px;">
        This will override any existing sync lock and ignore commit time checks.<br><br>
        <strong>Type "yes" to confirm:</strong>
      </p>
      <input
        type="text"
        id="force-sync-input"
        style="
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--b3-border-color, #ddd);
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
          margin-bottom: 16px;
        "
        placeholder="Type 'yes' to confirm"
      />
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button
          id="force-sync-cancel"
          style="
            padding: 8px 16px;
            border: 1px solid var(--b3-border-color, #ddd);
            border-radius: 4px;
            background: var(--b3-theme-surface, #f5f5f5);
            cursor: pointer;
          "
        >
          Cancel
        </button>
        <button
          id="force-sync-confirm"
          style="
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            background: #e53935;
            color: white;
            cursor: pointer;
          "
        >
          Force Sync
        </button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const input = dialog.querySelector("#force-sync-input");
    const cancelBtn = dialog.querySelector("#force-sync-cancel");
    const confirmBtn = dialog.querySelector("#force-sync-confirm");
    const cleanup = () => {
      document.body.removeChild(overlay);
    };
    cancelBtn.onclick = () => {
      cleanup();
      resolve(false);
    };
    confirmBtn.onclick = () => {
      const value = input.value.trim().toLowerCase();
      cleanup();
      resolve(value === "yes");
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        confirmBtn.click();
      } else if (e.key === "Escape") {
        cancelBtn.click();
      }
    };
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(false);
      }
    };
    setTimeout(() => input.focus(), 100);
  });
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
    const cached = await getAssetCacheEntry(plugin, asset.path);
    if (cached) {
      onProgress?.(`[Cache Hit] ${asset.path} - skipping (cached)`);
      await logInfo(`[Assets] Cache hit for ${asset.path}, skipping upload`);
      return false;
    }
    await logInfo(`[Assets] Cache miss for ${asset.path}, will upload`);
    onProgress?.(`[Reading] ${asset.path} (${formatFileSize(asset.size)})`);
    const content = await readAssetFile(asset.path);
    onProgress?.(`[Hashing] ${asset.path} (${formatFileSize(asset.size)})`);
    const contentHash = await calculateFileHash(content);
    const sizeMB = (asset.size / (1024 * 1024)).toFixed(2);
    onProgress?.(`[Uploading] ${asset.path} (${sizeMB} MB)`);
    const githubPath = `${settings.assetsDir}/${asset.path}`;
    const githubSHA = await uploadFileToGitHub(
      content,
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
    content
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
init_siyuan_api();

// src/sync-history.ts
init_logger();
var HISTORY_FILE = "sync-history.json";
var STATS_FILE = "sync-stats.json";
var MAX_RECORDS = 100;
async function loadSyncHistory(plugin) {
  try {
    const data = await plugin.loadData(HISTORY_FILE);
    if (data && data.records) {
      return data;
    }
  } catch (error) {
    await logError("[SyncHistory] Failed to load history", error);
  }
  return {
    records: [],
    maxRecords: MAX_RECORDS,
    lastUpdated: Date.now()
  };
}
async function saveSyncHistory(plugin, history) {
  try {
    history.lastUpdated = Date.now();
    await plugin.saveData(HISTORY_FILE, history);
  } catch (error) {
    await logError("[SyncHistory] Failed to save history", error);
  }
}
async function addSyncRecord(plugin, result, triggerType, skippedReason, errorMessage) {
  const history = await loadSyncHistory(plugin);
  const identity = getFullIdentity();
  const isBrowser = isBrowserEnvironment();
  const recordId = isBrowser ? `${Date.now()}-${identity.device.deviceId.substring(0, 8)}-${identity.tab.tabId}` : `${Date.now()}-${identity.device.deviceId.substring(0, 8)}`;
  const record = {
    id: recordId,
    timestamp: Date.now(),
    deviceId: identity.device.deviceId,
    deviceName: identity.displayName,
    // 包含Tab标识，如 "Browser-192.168.1.1 #3"
    tabId: isBrowser ? identity.tab.tabId : void 0,
    tabName: isBrowser ? identity.tab.tabName : void 0,
    triggerType,
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
    skippedReason,
    errorMessage
  };
  history.records.unshift(record);
  if (history.records.length > history.maxRecords) {
    history.records = history.records.slice(0, history.maxRecords);
  }
  await saveSyncHistory(plugin, history);
  await logInfo(`[SyncHistory] Record added: ${record.id}, success=${record.success}`);
  await updateStatistics(plugin, record);
}
async function getRecentRecords(plugin, limit = 20) {
  const history = await loadSyncHistory(plugin);
  return history.records.slice(0, limit);
}
async function clearSyncHistory(plugin) {
  const emptyHistory = {
    records: [],
    maxRecords: MAX_RECORDS,
    lastUpdated: Date.now()
  };
  await saveSyncHistory(plugin, emptyHistory);
  await logInfo("[SyncHistory] History cleared");
}
async function loadSyncStatistics(plugin) {
  try {
    const data = await plugin.loadData(STATS_FILE);
    if (data && typeof data.totalSyncCount === "number") {
      return data;
    }
  } catch (error) {
    await logError("[SyncHistory] Failed to load statistics", error);
  }
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
async function saveSyncStatistics(plugin, stats) {
  try {
    stats.lastUpdated = Date.now();
    await plugin.saveData(STATS_FILE, stats);
  } catch (error) {
    await logError("[SyncHistory] Failed to save statistics", error);
  }
}
async function updateStatistics(plugin, record) {
  const stats = await loadSyncStatistics(plugin);
  if (record.success) {
    stats.totalDocsUploaded += record.docsUploaded;
    stats.totalAssetsUploaded += record.assetsUploaded;
    stats.totalSyncCount += 1;
    stats.totalSyncTime += record.duration;
    stats.cacheHits += record.docsSkipped + record.assetsSkipped;
    stats.cacheMisses += record.docsUploaded + record.assetsUploaded;
  }
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
  if (stats.firstSyncTime === 0) {
    stats.firstSyncTime = record.timestamp;
  }
  stats.lastSyncTime = record.timestamp;
  await recalculateRecentStats(plugin, stats);
  await saveSyncStatistics(plugin, stats);
}
async function recalculateRecentStats(plugin, stats) {
  const history = await loadSyncHistory(plugin);
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1e3;
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
function formatDuration(ms) {
  if (ms < 1e3) {
    return `${ms}ms`;
  } else if (ms < 6e4) {
    return `${(ms / 1e3).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 6e4);
    const seconds = Math.round(ms % 6e4 / 1e3);
    return `${minutes}m ${seconds}s`;
  }
}
function formatTimestamp(timestamp) {
  if (timestamp === 0) return "Never";
  const date = new Date(timestamp);
  return date.toLocaleString();
}
function formatRelativeTime(timestamp) {
  if (timestamp === 0) return "Never";
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 6e4) {
    return "Just now";
  } else if (diff < 36e5) {
    const minutes = Math.floor(diff / 6e4);
    return `${minutes}m ago`;
  } else if (diff < 864e5) {
    const hours = Math.floor(diff / 36e5);
    return `${hours}h ago`;
  } else {
    const days = Math.floor(diff / 864e5);
    return `${days}d ago`;
  }
}
function calculateCacheHitRate(stats) {
  const total = stats.cacheHits + stats.cacheMisses;
  if (total === 0) return "N/A";
  const rate = stats.cacheHits / total * 100;
  return `${rate.toFixed(1)}%`;
}

// src/incremental-sync.ts
async function getAllDocMetadata() {
  await logInfo("[IncrementalSync] Fetching all document metadata");
  const response = await fetch("/api/query/sql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stmt: `SELECT id, box, path, hpath, content AS name, updated
             FROM blocks
             WHERE type = 'd'
             ORDER BY updated DESC
             LIMIT 999999`
    })
  });
  const result = await response.json();
  if (result.code !== 0) {
    await logError(`Failed to query documents: ${result.msg}`);
    return [];
  }
  const rawData = result.data || [];
  await logInfo(`[IncrementalSync] SQL returned ${rawData.length} rows`);
  let filteredNoId = 0;
  let filteredPlugins = 0;
  let filteredNoTimestamp = 0;
  let passed = 0;
  const docs = rawData.filter((row) => {
    if (!row.id || !row.box) {
      filteredNoId++;
      return false;
    }
    if (row.box === "plugins") {
      filteredPlugins++;
      return false;
    }
    if (!row.updated || typeof row.updated !== "string") {
      filteredNoTimestamp++;
      return false;
    }
    passed++;
    return true;
  }).map((row) => ({
    id: row.id,
    box: row.box,
    path: row.path,
    hpath: row.hpath,
    name: row.name,
    updated: row.updated
  }));
  await logInfo(`[IncrementalSync] Filter results: ${rawData.length} total \u2192 ${filteredNoId} no id/box, ${filteredPlugins} plugins, ${filteredNoTimestamp} no timestamp \u2192 ${passed} passed`);
  await logInfo(`[IncrementalSync] Found ${docs.length} documents`);
  const boxIds = new Set(docs.map((d) => d.box));
  await logInfo(`[IncrementalSync] Unique notebooks (${boxIds.size}): ${Array.from(boxIds).slice(0, 20).join(", ")}`);
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
  await logInfo(`[IncrementalSync] Checking ${allAssets.length} assets (cache-only, no mtime check)`);
  for (const asset of allAssets) {
    try {
      const cached = await getAssetCacheEntry(plugin, asset.path);
      if (!cached) {
        changedAssets.push(asset);
        await logInfo(`[IncrementalSync] New asset (no cache): ${asset.path}`);
      }
    } catch (error) {
      await logError(`[IncrementalSync] Error checking asset ${asset.path}: ${error}`);
      changedAssets.push(asset);
    }
  }
  const scanTime = Date.now() - startTime;
  await logInfo(
    `[IncrementalSync] Asset scan complete: ${changedAssets.length}/${allAssets.length} new assets (${scanTime}ms)`
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
  clearMemoryCache();
  clearNotebooksCache();
  await logInfo("[IncrementalSync] Memory cache cleared");
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
            const progressPrefix = `[Step 3/6] [${i + 1}/${changedDocs.length}]`;
            await exportCurrentDocToGit(
              plugin,
              doc.id,
              doc.id,
              settings,
              (msg) => onProgress?.(`${progressPrefix} ${msg}`),
              true
              // skipAssets = true
            );
            result.docsUploaded++;
          } catch (error) {
            result.docsFailed++;
            const errorMsg = error instanceof Error ? error.message : String(error);
            result.errors.push({
              path: `doc:${doc.id}`,
              error: errorMsg
            });
            await logError(`[IncrementalSync] Failed to sync doc ${doc.id}: ${errorMsg}`);
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
    await flushAllLogs();
    return result;
  } catch (error) {
    await logError(`[IncrementalSync] Sync failed: ${error}`);
    await flushAllLogs();
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
async function performIncrementalSyncWithLock(plugin, settings, statusBarEl, onProgress) {
  const deviceName = getDeviceName();
  await logInfo(`[IncrementalSync] Starting sync with lock for device: ${deviceName}`);
  const lockSettings = settings.syncLock || {
    enabled: true,
    lockTtl: 10 * 60 * 1e3,
    firstCheckThreshold: 10 * 60 * 1e3,
    secondCheckThreshold: 5 * 60 * 1e3,
    jitterRange: 15 * 1e3
  };
  if (!lockSettings.enabled) {
    await logInfo(`[IncrementalSync] Lock mechanism disabled, proceeding directly`);
    try {
      const result = await performIncrementalSync(plugin, settings, onProgress);
      return { executed: true, result };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      showSyncErrorStatus(statusBarEl, errorMsg);
      return { executed: false, error: errorMsg };
    }
  }
  const lockResult = await acquireSyncLock(
    settings,
    lockSettings,
    onProgress,
    (remaining) => showJitterCountdown(statusBarEl, remaining)
  );
  if (!lockResult.canSync) {
    const reason = lockResult.reason || "Unknown reason";
    await logInfo(`[IncrementalSync] Sync skipped: ${reason}`);
    showSyncSkippedStatus(statusBarEl, reason);
    await addSyncRecord(plugin, null, "auto", reason);
    return { executed: false, skippedReason: reason };
  }
  try {
    await logInfo(`[IncrementalSync] Lock acquired, starting sync`);
    const result = await performIncrementalSync(plugin, settings, onProgress);
    const timeSeconds = result.totalTime / 1e3;
    showSyncCompleteStatus(statusBarEl, result.docsUploaded, result.assetsUploaded, timeSeconds);
    await addSyncRecord(plugin, result, "auto");
    return { executed: true, result };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await logError(`[IncrementalSync] Sync failed: ${errorMsg}`);
    showSyncErrorStatus(statusBarEl, errorMsg);
    await addSyncRecord(plugin, null, "auto", void 0, errorMsg);
    return { executed: false, error: errorMsg };
  } finally {
    await logInfo(`[IncrementalSync] Releasing lock`);
    await releaseSyncLock(settings);
  }
}
async function performForceSyncWithLock(plugin, settings, statusBarEl, onProgress) {
  const deviceName = getDeviceName();
  await logInfo(`[IncrementalSync] Starting FORCE sync for device: ${deviceName}`);
  showForceSyncStatus(statusBarEl);
  const lockSettings = settings.syncLock || {
    enabled: true,
    lockTtl: 10 * 60 * 1e3,
    firstCheckThreshold: 10 * 60 * 1e3,
    secondCheckThreshold: 5 * 60 * 1e3,
    jitterRange: 15 * 1e3
  };
  if (lockSettings.enabled) {
    await logInfo(`[IncrementalSync] Force creating lock`);
    await createSyncLock(settings, lockSettings);
  }
  try {
    const result = await performIncrementalSync(plugin, settings, onProgress);
    const timeSeconds = result.totalTime / 1e3;
    showSyncCompleteStatus(statusBarEl, result.docsUploaded, result.assetsUploaded, timeSeconds);
    await addSyncRecord(plugin, result, "force");
    return { executed: true, result };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await logError(`[IncrementalSync] Force sync failed: ${errorMsg}`);
    showSyncErrorStatus(statusBarEl, errorMsg);
    await addSyncRecord(plugin, null, "force", void 0, errorMsg);
    return { executed: false, error: errorMsg };
  } finally {
    if (lockSettings.enabled) {
      await logInfo(`[IncrementalSync] Releasing lock after force sync`);
      await releaseSyncLock(settings);
    }
  }
}

// src/auto-sync-scheduler.ts
var AutoSyncScheduler = class _AutoSyncScheduler {
  constructor(plugin, settings, onProgress, statusBarEl) {
    this.timerId = null;
    this.isRunning = false;
    this.statusBarEl = null;
    if (_AutoSyncScheduler.globalInstance) {
      void _AutoSyncScheduler.globalInstance.stop();
      _AutoSyncScheduler.globalInstance = null;
    }
    this.plugin = plugin;
    this.settings = settings;
    this.onProgress = onProgress;
    this.statusBarEl = statusBarEl || null;
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
   * 执行一次同步（带分布式锁）
   */
  async runSync() {
    if (this.isRunning) {
      await logInfo("[AutoSync] Sync already running, skipping");
      return;
    }
    this.isRunning = true;
    try {
      await logInfo("[AutoSync] Starting sync cycle with lock check");
      this.onProgress?.("[AutoSync] Starting...");
      const lockedResult = await performIncrementalSyncWithLock(
        this.plugin,
        this.settings,
        this.statusBarEl,
        this.onProgress
      );
      if (lockedResult.executed && lockedResult.result) {
        await this.logSyncResult(lockedResult.result);
        this.onProgress?.(this.formatSyncResult(lockedResult.result));
      } else if (lockedResult.skippedReason) {
        await logInfo(`[AutoSync] Sync skipped: ${lockedResult.skippedReason}`);
      } else if (lockedResult.error) {
        await logError(`[AutoSync] Sync error: ${lockedResult.error}`);
        this.onProgress?.(`[AutoSync] Error: ${lockedResult.error}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await logError(`[AutoSync] Sync failed: ${errorMsg}`);
      this.onProgress?.(`[AutoSync] Failed: ${errorMsg}`);
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
   * 手动触发一次同步（带分布式锁）
   */
  async triggerSync() {
    await logInfo("[AutoSync] Manual sync triggered with lock check");
    this.onProgress?.("[AutoSync] Manual sync...");
    const lockedResult = await performIncrementalSyncWithLock(
      this.plugin,
      this.settings,
      this.statusBarEl,
      this.onProgress
    );
    if (lockedResult.executed && lockedResult.result) {
      await this.logSyncResult(lockedResult.result);
    }
    return lockedResult;
  }
  /**
   * 设置状态栏元素
   */
  setStatusBarEl(el) {
    this.statusBarEl = el;
  }
};

// src/sync-dashboard.ts
init_logger();
async function openSyncDashboard(plugin) {
  await logInfo("[Dashboard] Opening sync dashboard");
  const stats = await loadSyncStatistics(plugin);
  const recentRecords = await getRecentRecords(plugin, 20);
  const identity = getFullIdentity();
  const shortDeviceId = identity.device.deviceId.substring(0, 8);
  const dialogId = `sync-dashboard-${Date.now()}`;
  const overlay = document.createElement("div");
  overlay.id = dialogId;
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  const card = document.createElement("div");
  card.style.cssText = `
    width: 700px;
    max-width: 95vw;
    max-height: 85vh;
    background: var(--b3-theme-surface, #fff);
    color: var(--b3-theme-on-surface, #000);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `;
  card.innerHTML = `
    <div style="padding: 20px; border-bottom: 1px solid var(--b3-border-color, #ddd);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0; font-size: 18px;">\u{1F4CA} Sync Dashboard</h2>
        <button id="${dialogId}-close" style="background: none; border: none; font-size: 24px; cursor: pointer; opacity: 0.6;">&times;</button>
      </div>
      <div style="margin-top: 8px; font-size: 12px; opacity: 0.7;">
        Device: ${identity.displayName} (${shortDeviceId}...)
      </div>
    </div>

    <div style="flex: 1; overflow-y: auto; padding: 20px;">
      <!-- Statistics Cards -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px;">
        ${createStatCard("\u{1F4C4}", "Docs Uploaded", stats.totalDocsUploaded.toString(), `Today: ${stats.recentDocsUploaded}`)}
        ${createStatCard("\u{1F5BC}\uFE0F", "Assets Uploaded", stats.totalAssetsUploaded.toString(), `Today: ${stats.recentAssetsUploaded}`)}
        ${createStatCard("\u{1F504}", "Total Syncs", stats.totalSyncCount.toString(), `Today: ${stats.recentSyncCount}`)}
        ${createStatCard("\u26A1", "Cache Hit Rate", calculateCacheHitRate(stats), `${stats.cacheHits} hits`)}
      </div>

      <!-- Time Stats -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px;">
        ${createStatCard("\u23F1\uFE0F", "Total Sync Time", formatDuration(stats.totalSyncTime), "Cumulative")}
        ${createStatCard("\u{1F4C5}", "First Sync", stats.firstSyncTime ? formatRelativeTime(stats.firstSyncTime) : "Never", stats.firstSyncTime ? formatTimestamp(stats.firstSyncTime).split(",")[0] : "")}
        ${createStatCard("\u{1F550}", "Last Sync", stats.lastSyncTime ? formatRelativeTime(stats.lastSyncTime) : "Never", "")}
      </div>

      <!-- Device Stats -->
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 12px 0; font-size: 14px; opacity: 0.8;">\u{1F4F1} Device Sync Activity</h3>
        <div style="background: var(--b3-theme-surface-lighter, #f5f5f5); border-radius: 8px; overflow: hidden;">
          ${createDeviceStatsTable(stats)}
        </div>
      </div>

      <!-- Recent Sync History -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 style="margin: 0; font-size: 14px; opacity: 0.8;">\u{1F4DC} Recent Sync History</h3>
          <button id="${dialogId}-clear" class="b3-button b3-button--outline" style="padding: 4px 12px; font-size: 12px;">Clear History</button>
        </div>
        <div style="background: var(--b3-theme-surface-lighter, #f5f5f5); border-radius: 8px; overflow: hidden; max-height: 300px; overflow-y: auto;">
          ${createHistoryTable(recentRecords)}
        </div>
      </div>
    </div>

    <div style="padding: 16px 20px; border-top: 1px solid var(--b3-border-color, #ddd); display: flex; justify-content: flex-end;">
      <button id="${dialogId}-done" class="b3-button b3-button--primary">Done</button>
    </div>
  `;
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  document.getElementById(`${dialogId}-close`)?.addEventListener("click", close);
  document.getElementById(`${dialogId}-done`)?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.getElementById(`${dialogId}-clear`)?.addEventListener("click", async () => {
    if (confirm("Are you sure you want to clear all sync history?")) {
      await clearSyncHistory(plugin);
      close();
      await openSyncDashboard(plugin);
    }
  });
}
async function openSyncHistoryDialog(plugin) {
  await logInfo("[Dashboard] Opening sync history dialog");
  const records = await getRecentRecords(plugin, 50);
  const dialogId = `sync-history-${Date.now()}`;
  const overlay = document.createElement("div");
  overlay.id = dialogId;
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  const card = document.createElement("div");
  card.style.cssText = `
    width: 800px;
    max-width: 95vw;
    max-height: 85vh;
    background: var(--b3-theme-surface, #fff);
    color: var(--b3-theme-on-surface, #000);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `;
  card.innerHTML = `
    <div style="padding: 20px; border-bottom: 1px solid var(--b3-border-color, #ddd);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0; font-size: 18px;">\u{1F4DC} Sync History</h2>
        <button id="${dialogId}-close" style="background: none; border: none; font-size: 24px; cursor: pointer; opacity: 0.6;">&times;</button>
      </div>
      <div style="margin-top: 8px; font-size: 12px; opacity: 0.7;">
        Last ${records.length} sync operations
      </div>
    </div>

    <div style="flex: 1; overflow-y: auto; padding: 20px;">
      ${createDetailedHistoryTable(records)}
    </div>

    <div style="padding: 16px 20px; border-top: 1px solid var(--b3-border-color, #ddd); display: flex; justify-content: space-between;">
      <button id="${dialogId}-clear" class="b3-button b3-button--outline">Clear All History</button>
      <button id="${dialogId}-done" class="b3-button b3-button--primary">Close</button>
    </div>
  `;
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  document.getElementById(`${dialogId}-close`)?.addEventListener("click", close);
  document.getElementById(`${dialogId}-done`)?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.getElementById(`${dialogId}-clear`)?.addEventListener("click", async () => {
    if (confirm("Are you sure you want to clear all sync history?")) {
      await clearSyncHistory(plugin);
      close();
    }
  });
}
function createStatCard(icon, label, value, subtitle) {
  return `
    <div style="background: var(--b3-theme-surface-lighter, #f5f5f5); padding: 16px; border-radius: 8px; text-align: center;">
      <div style="font-size: 24px; margin-bottom: 4px;">${icon}</div>
      <div style="font-size: 20px; font-weight: bold; margin-bottom: 2px;">${value}</div>
      <div style="font-size: 11px; opacity: 0.7;">${label}</div>
      ${subtitle ? `<div style="font-size: 10px; opacity: 0.5; margin-top: 4px;">${subtitle}</div>` : ""}
    </div>
  `;
}
function createDeviceStatsTable(stats) {
  const devices = Object.entries(stats.deviceSyncStats);
  if (devices.length === 0) {
    return `<div style="padding: 20px; text-align: center; opacity: 0.6;">No device data yet</div>`;
  }
  const identity = getFullIdentity();
  const currentDeviceId = identity.device.deviceId;
  let rows = "";
  for (const [deviceId, data] of devices) {
    const isCurrentDevice = deviceId === currentDeviceId;
    rows += `
      <tr style="border-bottom: 1px solid var(--b3-border-color, #eee);">
        <td style="padding: 10px 12px;">
          ${data.deviceName}
          ${isCurrentDevice ? '<span style="background: var(--b3-theme-primary); color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 8px;">Current</span>' : ""}
        </td>
        <td style="padding: 10px 12px; text-align: center;">${data.syncCount}</td>
        <td style="padding: 10px 12px; text-align: right; opacity: 0.7;">${formatRelativeTime(data.lastSyncTime)}</td>
      </tr>
    `;
  }
  return `
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: var(--b3-theme-background, #fff);">
          <th style="padding: 10px 12px; text-align: left; font-weight: 500; font-size: 12px; opacity: 0.7;">Device</th>
          <th style="padding: 10px 12px; text-align: center; font-weight: 500; font-size: 12px; opacity: 0.7;">Syncs</th>
          <th style="padding: 10px 12px; text-align: right; font-weight: 500; font-size: 12px; opacity: 0.7;">Last Active</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}
function createHistoryTable(records) {
  if (records.length === 0) {
    return `<div style="padding: 20px; text-align: center; opacity: 0.6;">No sync history yet</div>`;
  }
  let rows = "";
  for (const record of records) {
    const statusIcon = record.success ? "\u2705" : record.skippedReason ? "\u23F8\uFE0F" : "\u274C";
    const statusColor = record.success ? "var(--b3-card-success-color, green)" : record.skippedReason ? "var(--b3-card-warning-color, orange)" : "var(--b3-card-error-color, red)";
    rows += `
      <tr style="border-bottom: 1px solid var(--b3-border-color, #eee);">
        <td style="padding: 8px 12px; white-space: nowrap;">${formatRelativeTime(record.timestamp)}</td>
        <td style="padding: 8px 12px;">${record.deviceName}</td>
        <td style="padding: 8px 12px; text-align: center;">
          <span style="color: ${statusColor};">${statusIcon}</span>
        </td>
        <td style="padding: 8px 12px; text-align: center;">${record.docsUploaded}/${record.assetsUploaded}</td>
        <td style="padding: 8px 12px; text-align: right; opacity: 0.7;">${formatDuration(record.duration)}</td>
      </tr>
    `;
  }
  return `
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <thead>
        <tr style="background: var(--b3-theme-background, #fff);">
          <th style="padding: 8px 12px; text-align: left; font-weight: 500; opacity: 0.7;">Time</th>
          <th style="padding: 8px 12px; text-align: left; font-weight: 500; opacity: 0.7;">Device</th>
          <th style="padding: 8px 12px; text-align: center; font-weight: 500; opacity: 0.7;">Status</th>
          <th style="padding: 8px 12px; text-align: center; font-weight: 500; opacity: 0.7;">Docs/Assets</th>
          <th style="padding: 8px 12px; text-align: right; font-weight: 500; opacity: 0.7;">Duration</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}
function createDetailedHistoryTable(records) {
  if (records.length === 0) {
    return `<div style="padding: 40px; text-align: center; opacity: 0.6;">No sync history yet</div>`;
  }
  let rows = "";
  for (const record of records) {
    const statusIcon = record.success ? "\u2705" : record.skippedReason ? "\u23F8\uFE0F" : "\u274C";
    const triggerBadge = record.triggerType === "auto" ? "\u{1F916}" : record.triggerType === "force" ? "\u26A0\uFE0F" : "\u{1F446}";
    const statusDetail = record.success ? `Uploaded ${record.docsUploaded} docs, ${record.assetsUploaded} assets` : record.skippedReason || record.errorMessage || "Unknown error";
    rows += `
      <div style="background: var(--b3-theme-surface-lighter, #f5f5f5); border-radius: 8px; padding: 12px; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div>
            <span style="font-size: 16px; margin-right: 8px;">${statusIcon}</span>
            <span style="font-weight: 500;">${record.deviceName}</span>
            <span style="opacity: 0.5; margin-left: 8px; font-size: 11px;">${triggerBadge} ${record.triggerType}</span>
          </div>
          <div style="text-align: right; font-size: 12px; opacity: 0.7;">
            ${formatTimestamp(record.timestamp)}
          </div>
        </div>
        <div style="font-size: 12px; opacity: 0.8; margin-bottom: 6px;">
          ${statusDetail}
        </div>
        <div style="display: flex; gap: 16px; font-size: 11px; opacity: 0.6;">
          <span>\u{1F4C4} Scanned: ${record.docsScanned} | Changed: ${record.docsChanged} | Uploaded: ${record.docsUploaded}</span>
          <span>\u{1F5BC}\uFE0F Scanned: ${record.assetsScanned} | Changed: ${record.assetsChanged} | Uploaded: ${record.assetsUploaded}</span>
          <span>\u23F1\uFE0F ${formatDuration(record.duration)}</span>
        </div>
      </div>
    `;
  }
  return rows;
}

// src/cache-rebuild.ts
init_logger();

// src/git-utils.ts
init_logger();
async function calculateGitBlobSHA(content) {
  try {
    const encoder = new TextEncoder();
    const contentBytes = encoder.encode(content);
    const header = `blob ${contentBytes.length}\0`;
    const headerBytes = encoder.encode(header);
    const combined = new Uint8Array(headerBytes.length + contentBytes.length);
    combined.set(headerBytes, 0);
    combined.set(contentBytes, headerBytes.length);
    const hashBuffer = await crypto.subtle.digest("SHA-1", combined);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    await logError("[GitUtils] crypto.subtle.digest SHA-1 failed, using fallback", error);
    return calculateGitBlobSHAFallback(content);
  }
}
function calculateGitBlobSHAFallback(content) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = hash * 16777619 >>> 0;
  }
  return `fallback-${hash.toString(16).padStart(8, "0")}`;
}
async function calculateGitBlobSHABinary(data) {
  try {
    const contentBytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const header = `blob ${contentBytes.length}\0`;
    const headerBytes = new TextEncoder().encode(header);
    const combined = new Uint8Array(headerBytes.length + contentBytes.length);
    combined.set(headerBytes, 0);
    combined.set(contentBytes, headerBytes.length);
    const hashBuffer = await crypto.subtle.digest("SHA-1", combined);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    await logError("[GitUtils] Binary SHA-1 calculation failed", error);
    const size = data instanceof Uint8Array ? data.length : data.byteLength;
    return `fallback-binary-${size}`;
  }
}
async function getGitHubFileTree(owner, repo, branch, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  await logInfo(`[GitUtils] Fetching file tree from GitHub: ${owner}/${repo}@${branch}`);
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json"
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub Tree API failed: ${response.status} ${errorText}`);
  }
  const data = await response.json();
  const files = /* @__PURE__ */ new Map();
  for (const entry of data.tree) {
    if (entry.type === "blob") {
      files.set(entry.path, entry.sha);
    }
  }
  await logInfo(`[GitUtils] Retrieved ${files.size} files from GitHub (truncated: ${data.truncated})`);
  if (data.truncated) {
    await logError("[GitUtils] Warning: File tree was truncated! Repository may be too large.");
  }
  return { files, truncated: data.truncated };
}
function parseRepoUrl2(repoUrl) {
  const httpsMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}
function isFallbackHash(hash) {
  return hash.startsWith("fallback-");
}

// src/cache-rebuild.ts
init_siyuan_api();
init_cache_manager();
init_hash_utils();
async function getAllDocMetadataForRebuild() {
  await logInfo("[CacheRebuild] Fetching all document metadata");
  const response = await fetch("/api/query/sql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stmt: `SELECT id, box, path, hpath, content as name, updated
             FROM blocks
             WHERE type = 'd'
             LIMIT 50000`
    })
  });
  const result = await response.json();
  const rawData = result.data || [];
  const docs = rawData.filter((row) => {
    if (!row.id || !row.box) return false;
    if (!row.updated || row.updated === "0" || row.updated === 0) return false;
    return true;
  }).map((row) => ({
    id: row.id,
    box: row.box,
    path: row.path || "",
    hpath: row.hpath || "",
    name: row.name || "untitled",
    updated: parseInt(row.updated, 10) || 0
  }));
  await logInfo(`[CacheRebuild] Found ${docs.length} documents`);
  return docs;
}
function buildGitHubDocPath(doc, exportRoot, notebookName) {
  const sanitize = (s) => (s || "").replace(/[<>:"/\\|?*]/g, "_").trim() || "untitled";
  const hpathParts = (doc.hpath || "").split("/").filter(Boolean).slice(0, -1);
  const title = doc.name || "untitled";
  const parts = [
    exportRoot,
    sanitize(notebookName),
    ...hpathParts.map(sanitize),
    `${sanitize(title)}.md`
  ].filter(Boolean);
  return parts.join("/");
}
async function getAllAssets2() {
  await logInfo("[CacheRebuild] Scanning assets directory");
  try {
    const files = await readDir("/data/assets");
    const assets = files.filter((f) => !f.isDir).map((f) => ({
      path: f.name,
      // 使用文件名，与 assets-sync.ts 保持一致
      name: f.name
    }));
    await logInfo(`[CacheRebuild] Found ${assets.length} assets`);
    return assets;
  } catch (error) {
    await logError("[CacheRebuild] Failed to scan assets", error);
    return [];
  }
}
async function getNotebookNameMap() {
  const response = await fetch("/api/notebook/lsNotebooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const result = await response.json();
  const notebooks = result.data?.notebooks || [];
  const map = /* @__PURE__ */ new Map();
  for (const nb of notebooks) {
    map.set(nb.id, nb.name);
  }
  return map;
}
async function rebuildCacheFromGitHub(plugin, settings, onProgress) {
  const startTime = Date.now();
  let result = {
    success: false,
    docsMatched: 0,
    docsPending: 0,
    assetsMatched: 0,
    assetsPending: 0,
    duration: 0
  };
  try {
    clearMemoryCache();
    onProgress?.({
      phase: "init",
      current: 0,
      total: 100,
      message: "Validating settings...",
      docsMatched: 0,
      docsPending: 0,
      assetsMatched: 0,
      assetsPending: 0
    });
    const repoInfo = parseRepoUrl2(settings.repoUrl);
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
    onProgress?.({
      phase: "fetch-tree",
      current: 5,
      total: 100,
      message: "Fetching file tree from GitHub...",
      docsMatched: 0,
      docsPending: 0,
      assetsMatched: 0,
      assetsPending: 0
    });
    const { files: remoteFiles, truncated } = await getGitHubFileTree(owner, repo, branch, token);
    result.truncated = truncated;
    await logInfo(`[CacheRebuild] Remote file tree: ${remoteFiles.size} files`);
    if (truncated) {
      await logError("[CacheRebuild] Warning: File tree was truncated, some files may be missing");
    }
    onProgress?.({
      phase: "scan-docs",
      current: 10,
      total: 100,
      message: "Scanning local documents...",
      docsMatched: 0,
      docsPending: 0,
      assetsMatched: 0,
      assetsPending: 0
    });
    const allDocs = await getAllDocMetadataForRebuild();
    const notebookNames = await getNotebookNameMap();
    const exportRoot = settings.exportRoot || "";
    const docsByNotebook = /* @__PURE__ */ new Map();
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
        if (docsProcessed % 50 === 0) {
          const progress = 10 + Math.floor(docsProcessed / totalDocs * 40);
          onProgress?.({
            phase: "scan-docs",
            current: progress,
            total: 100,
            message: `Processing document ${docsProcessed}/${totalDocs}...`,
            docsMatched: result.docsMatched,
            docsPending: result.docsPending,
            assetsMatched: result.assetsMatched,
            assetsPending: result.assetsPending
          });
        }
        try {
          const githubPath = buildGitHubDocPath(doc, exportRoot, notebookName);
          const remoteSHA = remoteFiles.get(githubPath);
          if (!remoteSHA) {
            result.docsPending++;
            continue;
          }
          const markdownResult = await exportMarkdown(doc.id);
          let markdown = markdownResult.content || "";
          if (settings.cleanFrontmatter) {
            markdown = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*/, "");
          }
          const localSHA = await calculateGitBlobSHA(markdown);
          if (isFallbackHash(localSHA)) {
            result.docsPending++;
            continue;
          }
          if (localSHA === remoteSHA) {
            const contentHash = await calculateHash(markdown);
            const cacheEntry = {
              docId: doc.id,
              notebookId,
              githubPath,
              contentHash,
              githubSHA: remoteSHA,
              lastSyncTime: Date.now(),
              siyuanUpdated: doc.updated
            };
            cache[doc.id] = cacheEntry;
            result.docsMatched++;
          } else {
            result.docsPending++;
          }
        } catch (error) {
          await logError(`[CacheRebuild] Error processing doc ${doc.id}`, error);
          result.docsPending++;
        }
      }
      await saveNotebookDocCache(plugin, notebookId, cache);
    }
    await logInfo(`[CacheRebuild] Documents: ${result.docsMatched} matched, ${result.docsPending} pending`);
    onProgress?.({
      phase: "scan-assets",
      current: 55,
      total: 100,
      message: "Scanning local assets...",
      docsMatched: result.docsMatched,
      docsPending: result.docsPending,
      assetsMatched: 0,
      assetsPending: 0
    });
    const allAssets = await getAllAssets2();
    const assetsDir = settings.assetsDir || "assets";
    const assetCacheShards = /* @__PURE__ */ new Map();
    let assetsProcessed = 0;
    const totalAssets = allAssets.length;
    for (const asset of allAssets) {
      assetsProcessed++;
      if (assetsProcessed % 100 === 0) {
        const progress = 55 + Math.floor(assetsProcessed / totalAssets * 40);
        onProgress?.({
          phase: "scan-assets",
          current: progress,
          total: 100,
          message: `Processing asset ${assetsProcessed}/${totalAssets}...`,
          docsMatched: result.docsMatched,
          docsPending: result.docsPending,
          assetsMatched: result.assetsMatched,
          assetsPending: result.assetsPending
        });
      }
      try {
        const githubPath = `${assetsDir}/${asset.name}`;
        const remoteSHA = remoteFiles.get(githubPath);
        if (!remoteSHA) {
          result.assetsPending++;
          continue;
        }
        const blob = await getFileBlob(`/data/assets/${asset.path}`);
        if (!blob) {
          result.assetsPending++;
          continue;
        }
        const arrayBuffer = await blob.arrayBuffer();
        const localSHA = await calculateGitBlobSHABinary(arrayBuffer);
        if (isFallbackHash(localSHA)) {
          result.assetsPending++;
          continue;
        }
        if (localSHA === remoteSHA) {
          const contentHash = await calculateHash(new Uint8Array(arrayBuffer));
          const cacheEntry = {
            assetPath: asset.path,
            contentHash,
            githubSHA: remoteSHA,
            lastSyncTime: Date.now(),
            fileSize: arrayBuffer.byteLength
          };
          const shardHash = await calculateShardHash(asset.path);
          const shard = parseInt(shardHash.substring(0, 2), 16) % 16;
          if (!assetCacheShards.has(shard)) {
            try {
              const existing = await plugin.loadData(`assets-${shard}.json`);
              assetCacheShards.set(shard, existing || {});
            } catch {
              assetCacheShards.set(shard, {});
            }
          }
          assetCacheShards.get(shard)[asset.path] = cacheEntry;
          result.assetsMatched++;
        } else {
          result.assetsPending++;
        }
      } catch (error) {
        await logError(`[CacheRebuild] Error processing asset ${asset.path}`, error);
        result.assetsPending++;
      }
    }
    for (const [shard, cache] of assetCacheShards) {
      await plugin.saveData(`assets-${shard}.json`, cache);
    }
    await logInfo(`[CacheRebuild] Assets: ${result.assetsMatched} matched, ${result.assetsPending} pending`);
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
      assetsPending: result.assetsPending
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
      assetsPending: result.assetsPending
    });
  }
  await flushAllLogs();
  return result;
}

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
    await logInfo("plugin loaded v0.4.5");
    await initDeviceManager();
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
        (message) => updateStatusBar(this.statusBarEl, message),
        this.statusBarEl
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
    menu.addSeparator();
    menu.addItem({
      label: "\u{1F4CA} Sync Dashboard",
      icon: "iconGraph",
      click: () => {
        void openSyncDashboard(this);
      }
    });
    menu.addItem({
      label: "\u{1F4DC} Sync History",
      icon: "iconHistory",
      click: () => {
        void openSyncHistoryDialog(this);
      }
    });
    menu.addSeparator();
    menu.addItem({
      label: "\u{1F527} Rebuild Cache from GitHub",
      icon: "iconDownload",
      click: () => {
        void this.rebuildCache();
      }
    });
    menu.addItem({
      label: "\u26A0\uFE0F Clear Cache & Full Sync",
      icon: "iconTrashcan",
      click: () => {
        void this.clearCacheAndFullSync();
      }
    });
    menu.addItem({
      label: "\u26A0\uFE0F Force Sync (Override Lock)",
      icon: "iconWarning",
      click: () => {
        void this.forceSync();
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
        <span style="opacity:0.6; font-size:12px;">v0.4.5</span>
      </div>

      <h4 style="margin-top:0;margin-bottom:8px;">\u{1F4F1} Device Settings</h4>
      <div style="background:var(--b3-theme-surface-lighter,#f5f5f5);padding:12px;border-radius:6px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:12px;opacity:0.7;">Device ID: <code>${getShortDeviceId()}...</code></span>
          <button class="b3-button b3-button--outline" id="${dialogId}-regenerate" style="padding:2px 8px;font-size:11px;">Regenerate</button>
        </div>
        <label class="b3-label" style="margin-bottom:0;">
          Device Name
          <input class="b3-text-field fn__block" id="${dialogId}-devicename" value="${getDeviceName()}" placeholder="e.g. Desktop-Windows">
        </label>
        <div style="font-size:11px;opacity:0.6;margin-top:4px;">Stored locally, not synced between devices</div>
      </div>

      <h4 style="margin-top:16px;margin-bottom:8px;">\u{1F517} GitHub Settings</h4>
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

      <h4 style="margin-top:16px;margin-bottom:8px;">\u{1F6AB} Ignore Settings</h4>
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

      <h4 style="margin-top:16px;margin-bottom:8px;">\u23F0 Auto Sync</h4>
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

      <h4 style="margin-top:16px;margin-bottom:8px;">\u{1F512} Distributed Lock (Multi-device Conflict Prevention)</h4>
      <label class="b3-label">
        <div class="fn__flex">
          <div class="fn__flex-1">
            Enable distributed lock
            <div class="b3-label__text">Prevent multiple devices from syncing simultaneously</div>
          </div>
          <span class="fn__space"></span>
          <input class="b3-switch fn__flex-center" type="checkbox" id="${dialogId}-lockenabled" ${s.syncLock.enabled ? "checked" : ""}>
        </div>
      </label>
      <label class="b3-label">Lock timeout / TTL (minutes)
        <input class="b3-text-field fn__block" type="number" id="${dialogId}-lockttl" value="${Math.round(s.syncLock.lockTtl / 6e4)}" min="1" max="60">
        <div class="b3-label__text">If a device crashes, lock auto-expires after this time</div>
      </label>
      <label class="b3-label">First check threshold (minutes)
        <input class="b3-text-field fn__block" type="number" id="${dialogId}-firstthreshold" value="${Math.round(s.syncLock.firstCheckThreshold / 6e4)}" min="1" max="60">
        <div class="b3-label__text">Skip sync if last commit was within this time</div>
      </label>
      <label class="b3-label">Second check threshold (minutes)
        <input class="b3-text-field fn__block" type="number" id="${dialogId}-secondthreshold" value="${Math.round(s.syncLock.secondCheckThreshold / 6e4)}" min="1" max="30">
        <div class="b3-label__text">Shorter threshold for the double-check after jitter</div>
      </label>
      <label class="b3-label">Random jitter range (seconds)
        <input class="b3-text-field fn__block" type="number" id="${dialogId}-jitter" value="${Math.round(s.syncLock.jitterRange / 1e3)}" min="5" max="120">
        <div class="b3-label__text">Random wait time to avoid conflicts (countdown shown in status bar)</div>
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
      const newDeviceName = q(`#${dialogId}-devicename`).value.trim();
      if (newDeviceName) {
        setDeviceName(newDeviceName);
      }
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
        },
        syncLock: {
          enabled: q(`#${dialogId}-lockenabled`).checked,
          lockTtl: (parseInt(q(`#${dialogId}-lockttl`).value) || 10) * 60 * 1e3,
          firstCheckThreshold: (parseInt(q(`#${dialogId}-firstthreshold`).value) || 10) * 60 * 1e3,
          secondCheckThreshold: (parseInt(q(`#${dialogId}-secondthreshold`).value) || 5) * 60 * 1e3,
          jitterRange: (parseInt(q(`#${dialogId}-jitter`).value) || 15) * 1e3
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
            (message) => updateStatusBar(this.statusBarEl, message),
            this.statusBarEl
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
    q(`#${dialogId}-regenerate`)?.addEventListener("click", () => {
      if (confirm("Are you sure you want to regenerate your device ID? This will change your device identity for sync lock purposes.")) {
        regenerateDeviceId();
        const shortIdEl = card.querySelector(`#${dialogId}-regenerate`)?.parentElement?.querySelector("code");
        if (shortIdEl) {
          shortIdEl.textContent = `${getShortDeviceId()}...`;
        }
      }
    });
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
    if (!this.settings) {
      await logError("Settings not loaded");
      return;
    }
    const firstConfirm = await this.showClearCacheWarningDialog();
    if (!firstConfirm) {
      await logInfo("[ClearCache] Cancelled at first confirmation");
      return;
    }
    const secondConfirm = await this.showClearCacheTypeConfirmDialog();
    if (!secondConfirm) {
      await logInfo("[ClearCache] Cancelled at second confirmation");
      return;
    }
    try {
      updateStatusBar(this.statusBarEl, "Clearing cache...");
      await logInfo("[ClearCache] Starting to clear all cache (user confirmed twice)");
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
        (message) => updateStatusBar(this.statusBarEl, message),
        this.statusBarEl
      );
      await this.autoSyncScheduler.start();
      await logInfo("[ClearCache] Full sync triggered");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await logError(`[ClearCache] Failed: ${errorMsg}`);
      updateStatusBar(this.statusBarEl, `Clear cache failed: ${errorMsg}`);
    }
  }
  /**
   * 显示清除缓存的第一次警告对话框
   */
  showClearCacheWarningDialog() {
    return new Promise((resolve) => {
      const dialogId = `clear-cache-warning-${Date.now()}`;
      const overlay = document.createElement("div");
      overlay.id = dialogId;
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      const card = document.createElement("div");
      card.style.cssText = `
        width: 480px;
        max-width: 95vw;
        background: var(--b3-theme-surface, #fff);
        color: var(--b3-theme-on-surface, #000);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        overflow: hidden;
      `;
      card.innerHTML = `
        <div style="padding: 20px; border-bottom: 1px solid var(--b3-border-color, #ddd); background: var(--b3-card-warning-background, #fff3cd);">
          <h2 style="margin: 0; font-size: 18px; color: var(--b3-card-warning-color, #856404);">
            \u26A0\uFE0F Dangerous Operation
          </h2>
        </div>
        <div style="padding: 20px;">
          <p style="margin: 0 0 16px 0; font-weight: bold;">
            Clearing cache will have the following effects:
          </p>
          <ul style="margin: 0 0 16px 0; padding-left: 20px; line-height: 1.8;">
            <li>Delete all local cache files</li>
            <li style="color: var(--b3-card-error-color, red); font-weight: bold;">
              Through SiYuan sync, cache deletion will propagate to ALL devices!
            </li>
            <li>Next sync will upload ALL files (may take hours)</li>
            <li>Risk of overwriting newer remote changes</li>
          </ul>
          <div style="background: var(--b3-theme-surface-lighter, #f5f5f5); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
            <strong>\u{1F4A1} Suggestion:</strong> Use "Rebuild Cache from GitHub" instead.
            <br><span style="font-size: 12px; opacity: 0.8;">It rebuilds cache without deleting data, much safer and faster.</span>
          </div>
        </div>
        <div style="padding: 16px 20px; border-top: 1px solid var(--b3-border-color, #ddd); display: flex; justify-content: flex-end; gap: 12px;">
          <button class="b3-button b3-button--cancel" id="${dialogId}-cancel">Cancel</button>
          <button class="b3-button" style="background: var(--b3-card-warning-color, #856404); color: white;" id="${dialogId}-continue">
            I understand the risks, continue
          </button>
        </div>
      `;
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      const cleanup = () => overlay.remove();
      document.getElementById(`${dialogId}-cancel`)?.addEventListener("click", () => {
        cleanup();
        resolve(false);
      });
      document.getElementById(`${dialogId}-continue`)?.addEventListener("click", () => {
        cleanup();
        resolve(true);
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          cleanup();
          resolve(false);
        }
      });
    });
  }
  /**
   * 显示清除缓存的第二次确认对话框（需要输入 DELETE）
   */
  showClearCacheTypeConfirmDialog() {
    return new Promise((resolve) => {
      const dialogId = `clear-cache-confirm-${Date.now()}`;
      const overlay = document.createElement("div");
      overlay.id = dialogId;
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      const card = document.createElement("div");
      card.style.cssText = `
        width: 400px;
        max-width: 95vw;
        background: var(--b3-theme-surface, #fff);
        color: var(--b3-theme-on-surface, #000);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        overflow: hidden;
      `;
      card.innerHTML = `
        <div style="padding: 20px; border-bottom: 1px solid var(--b3-border-color, #ddd); background: var(--b3-card-error-background, #f8d7da);">
          <h2 style="margin: 0; font-size: 18px; color: var(--b3-card-error-color, #721c24);">
            \u26A0\uFE0F Final Confirmation
          </h2>
        </div>
        <div style="padding: 20px;">
          <p style="margin: 0 0 16px 0;">
            Type <strong style="font-family: monospace; background: var(--b3-theme-surface-lighter, #f5f5f5); padding: 2px 8px; border-radius: 4px;">DELETE</strong> to confirm clearing all cache:
          </p>
          <input
            type="text"
            class="b3-text-field fn__block"
            id="${dialogId}-input"
            placeholder="Type DELETE here"
            autocomplete="off"
            style="font-family: monospace; text-transform: uppercase;"
          >
          <div id="${dialogId}-error" style="color: var(--b3-card-error-color, red); font-size: 12px; margin-top: 8px; display: none;">
            Please type DELETE to confirm
          </div>
        </div>
        <div style="padding: 16px 20px; border-top: 1px solid var(--b3-border-color, #ddd); display: flex; justify-content: flex-end; gap: 12px;">
          <button class="b3-button b3-button--cancel" id="${dialogId}-cancel">Cancel</button>
          <button class="b3-button" style="background: var(--b3-card-error-color, #dc3545); color: white;" id="${dialogId}-confirm">
            Clear All Cache
          </button>
        </div>
      `;
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      const cleanup = () => overlay.remove();
      const inputEl = document.getElementById(`${dialogId}-input`);
      const errorEl = document.getElementById(`${dialogId}-error`);
      setTimeout(() => inputEl?.focus(), 100);
      document.getElementById(`${dialogId}-cancel`)?.addEventListener("click", () => {
        cleanup();
        resolve(false);
      });
      document.getElementById(`${dialogId}-confirm`)?.addEventListener("click", () => {
        const value = inputEl?.value?.trim()?.toUpperCase();
        if (value === "DELETE") {
          cleanup();
          resolve(true);
        } else {
          errorEl.style.display = "block";
          inputEl?.focus();
        }
      });
      inputEl?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const value = inputEl?.value?.trim()?.toUpperCase();
          if (value === "DELETE") {
            cleanup();
            resolve(true);
          } else {
            errorEl.style.display = "block";
          }
        }
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          cleanup();
          resolve(false);
        }
      });
    });
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
        (message) => updateStatusBar(this.statusBarEl, message),
        this.statusBarEl
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
  /**
   * 从 GitHub 重建缓存
   */
  async rebuildCache() {
    if (!this.settings) {
      await logError("Settings not loaded");
      return;
    }
    const confirmed = await this.showRebuildCacheConfirmDialog();
    if (!confirmed) {
      await logInfo("[CacheRebuild] Cancelled by user");
      return;
    }
    const wasAutoSyncEnabled = this.autoSyncScheduler !== null;
    if (this.autoSyncScheduler) {
      await this.autoSyncScheduler.stop();
      this.autoSyncScheduler = null;
      await logInfo("[CacheRebuild] Auto sync paused during rebuild");
    }
    const progressDialog = this.createRebuildProgressDialog();
    document.body.appendChild(progressDialog.overlay);
    try {
      const result = await rebuildCacheFromGitHub(
        this,
        this.settings,
        (progress) => {
          progressDialog.update(progress);
        }
      );
      if (result.success) {
        progressDialog.showComplete(result);
        await logInfo(`[CacheRebuild] Complete: ${result.docsMatched} docs, ${result.assetsMatched} assets matched`);
      } else {
        progressDialog.showError(result.error || "Unknown error");
        await logError(`[CacheRebuild] Failed: ${result.error}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      progressDialog.showError(errorMsg);
      await logError(`[CacheRebuild] Error: ${errorMsg}`);
    }
    progressDialog.onClose = async () => {
      if (wasAutoSyncEnabled && this.settings?.autoSync.enabled) {
        this.autoSyncScheduler = new AutoSyncScheduler(
          this,
          this.settings,
          (message) => updateStatusBar(this.statusBarEl, message),
          this.statusBarEl
        );
        await this.autoSyncScheduler.start();
        await logInfo("[CacheRebuild] Auto sync resumed");
      }
    };
  }
  /**
   * 显示重建缓存确认对话框
   */
  showRebuildCacheConfirmDialog() {
    return new Promise((resolve) => {
      const dialogId = `rebuild-cache-confirm-${Date.now()}`;
      const overlay = document.createElement("div");
      overlay.id = dialogId;
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      const card = document.createElement("div");
      card.style.cssText = `
        width: 480px;
        max-width: 95vw;
        background: var(--b3-theme-surface, #fff);
        color: var(--b3-theme-on-surface, #000);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        overflow: hidden;
      `;
      card.innerHTML = `
        <div style="padding: 20px; border-bottom: 1px solid var(--b3-border-color, #ddd);">
          <h2 style="margin: 0; font-size: 18px;">
            \u{1F527} Rebuild Cache from GitHub
          </h2>
        </div>
        <div style="padding: 20px;">
          <p style="margin: 0 0 16px 0;">
            This will rebuild your local cache by comparing local files with GitHub:
          </p>
          <ul style="margin: 0 0 16px 0; padding-left: 20px; line-height: 1.8;">
            <li>Fetch file list from GitHub (one API call)</li>
            <li>Compare each local file with remote SHA</li>
            <li>Mark matching files as "already synced"</li>
            <li>Files that differ will be uploaded on next sync</li>
          </ul>
          <div style="background: var(--b3-theme-surface-lighter, #f5f5f5); padding: 12px; border-radius: 8px;">
            <strong>Note:</strong> Auto sync will be paused during rebuild.
            <br><span style="font-size: 12px; opacity: 0.8;">This may take a few minutes for large repositories.</span>
          </div>
        </div>
        <div style="padding: 16px 20px; border-top: 1px solid var(--b3-border-color, #ddd); display: flex; justify-content: flex-end; gap: 12px;">
          <button class="b3-button b3-button--cancel" id="${dialogId}-cancel">Cancel</button>
          <button class="b3-button b3-button--primary" id="${dialogId}-start">Start Rebuild</button>
        </div>
      `;
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      const cleanup = () => overlay.remove();
      document.getElementById(`${dialogId}-cancel`)?.addEventListener("click", () => {
        cleanup();
        resolve(false);
      });
      document.getElementById(`${dialogId}-start`)?.addEventListener("click", () => {
        cleanup();
        resolve(true);
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          cleanup();
          resolve(false);
        }
      });
    });
  }
  /**
   * 创建重建缓存进度对话框
   */
  createRebuildProgressDialog() {
    const dialogId = `rebuild-progress-${Date.now()}`;
    const overlay = document.createElement("div");
    overlay.id = dialogId;
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    const card = document.createElement("div");
    card.style.cssText = `
      width: 500px;
      max-width: 95vw;
      background: var(--b3-theme-surface, #fff);
      color: var(--b3-theme-on-surface, #000);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      overflow: hidden;
    `;
    card.innerHTML = `
      <div style="padding: 20px; border-bottom: 1px solid var(--b3-border-color, #ddd);">
        <h2 style="margin: 0; font-size: 18px;">\u{1F527} Rebuilding Cache...</h2>
      </div>
      <div style="padding: 20px;">
        <div id="${dialogId}-status" style="margin-bottom: 16px; font-weight: 500;">
          Initializing...
        </div>
        <div style="background: var(--b3-theme-surface-lighter, #eee); border-radius: 4px; height: 8px; overflow: hidden; margin-bottom: 16px;">
          <div id="${dialogId}-progress-bar" style="background: var(--b3-theme-primary, #4285f4); height: 100%; width: 0%; transition: width 0.3s;"></div>
        </div>
        <div id="${dialogId}-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px;">
          <div style="background: var(--b3-theme-surface-lighter, #f5f5f5); padding: 12px; border-radius: 8px;">
            <div style="opacity: 0.7; font-size: 11px;">Documents</div>
            <div><span id="${dialogId}-docs-matched" style="color: var(--b3-card-success-color, green);">0</span> matched, <span id="${dialogId}-docs-pending" style="color: var(--b3-card-warning-color, orange);">0</span> pending</div>
          </div>
          <div style="background: var(--b3-theme-surface-lighter, #f5f5f5); padding: 12px; border-radius: 8px;">
            <div style="opacity: 0.7; font-size: 11px;">Assets</div>
            <div><span id="${dialogId}-assets-matched" style="color: var(--b3-card-success-color, green);">0</span> matched, <span id="${dialogId}-assets-pending" style="color: var(--b3-card-warning-color, orange);">0</span> pending</div>
          </div>
        </div>
      </div>
      <div id="${dialogId}-footer" style="padding: 16px 20px; border-top: 1px solid var(--b3-border-color, #ddd); display: none; justify-content: flex-end;">
        <button class="b3-button b3-button--primary" id="${dialogId}-close">Close</button>
      </div>
    `;
    overlay.appendChild(card);
    let onCloseCallback;
    const result = {
      overlay,
      update: (progress) => {
        const statusEl = document.getElementById(`${dialogId}-status`);
        const progressBar = document.getElementById(`${dialogId}-progress-bar`);
        const docsMatched = document.getElementById(`${dialogId}-docs-matched`);
        const docsPending = document.getElementById(`${dialogId}-docs-pending`);
        const assetsMatched = document.getElementById(`${dialogId}-assets-matched`);
        const assetsPending = document.getElementById(`${dialogId}-assets-pending`);
        if (statusEl) statusEl.textContent = progress.message;
        if (progressBar) progressBar.style.width = `${progress.current}%`;
        if (docsMatched) docsMatched.textContent = String(progress.docsMatched);
        if (docsPending) docsPending.textContent = String(progress.docsPending);
        if (assetsMatched) assetsMatched.textContent = String(progress.assetsMatched);
        if (assetsPending) assetsPending.textContent = String(progress.assetsPending);
      },
      showComplete: (rebuildResult) => {
        const statusEl = document.getElementById(`${dialogId}-status`);
        const footerEl = document.getElementById(`${dialogId}-footer`);
        const progressBar = document.getElementById(`${dialogId}-progress-bar`);
        if (statusEl) {
          statusEl.innerHTML = `
            <span style="color: var(--b3-card-success-color, green);">\u2705 Cache rebuild complete!</span>
            <br><span style="font-size: 12px; opacity: 0.7;">Duration: ${(rebuildResult.duration / 1e3).toFixed(1)}s</span>
            ${rebuildResult.truncated ? '<br><span style="color: var(--b3-card-warning-color, orange); font-size: 12px;">\u26A0\uFE0F File tree was truncated (repository may be too large)</span>' : ""}
          `;
        }
        if (progressBar) progressBar.style.width = "100%";
        if (footerEl) footerEl.style.display = "flex";
        document.getElementById(`${dialogId}-close`)?.addEventListener("click", async () => {
          overlay.remove();
          if (onCloseCallback) await onCloseCallback();
        });
      },
      showError: (error) => {
        const statusEl = document.getElementById(`${dialogId}-status`);
        const footerEl = document.getElementById(`${dialogId}-footer`);
        const progressBar = document.getElementById(`${dialogId}-progress-bar`);
        if (statusEl) {
          statusEl.innerHTML = `<span style="color: var(--b3-card-error-color, red);">\u274C Error: ${error}</span>`;
        }
        if (progressBar) progressBar.style.background = "var(--b3-card-error-color, red)";
        if (footerEl) footerEl.style.display = "flex";
        document.getElementById(`${dialogId}-close`)?.addEventListener("click", async () => {
          overlay.remove();
          if (onCloseCallback) await onCloseCallback();
        });
      },
      set onClose(callback) {
        onCloseCallback = callback;
      }
    };
    return result;
  }
  async forceSync() {
    if (!this.settings) {
      await logError("Settings not loaded");
      return;
    }
    const confirmed = await showForceConfirmDialog();
    if (!confirmed) {
      await logInfo("Force sync cancelled by user");
      updateStatusBar(this.statusBarEl, "Force sync cancelled");
      return;
    }
    await logInfo("Force sync confirmed by user, starting...");
    updateStatusBar(this.statusBarEl, "Force sync starting...");
    try {
      const result = await performForceSyncWithLock(
        this,
        this.settings,
        this.statusBarEl,
        (message) => updateStatusBar(this.statusBarEl, message)
      );
      if (result.executed && result.result) {
        await logInfo(`Force sync complete: ${result.result.docsUploaded} docs, ${result.result.assetsUploaded} assets`);
      } else if (result.error) {
        await logError(`Force sync failed: ${result.error}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await logError(`Force sync error: ${errorMsg}`);
      updateStatusBar(this.statusBarEl, `Force sync error: ${errorMsg}`);
    }
  }
};
