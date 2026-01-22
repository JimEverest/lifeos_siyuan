export async function apiPost<T>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(data ?? {}),
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.msg || `Request failed: ${url}`);
  }
  return json.data as T;
}

export async function apiPostForm<T>(url: string, formData: FormData): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    body: formData,
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.msg || `Request failed: ${url}`);
  }
  return json.data as T;
}

export async function getFileBlob(path: string): Promise<Blob | null> {
  const res = await fetch("/api/file/getFile", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    return null;
  }
  return await res.blob();
}

export async function putFile(path: string, content: Blob): Promise<void> {
  const form = new FormData();
  form.append("path", path);
  form.append("isDir", "false");
  form.append("modTime", Date.now().toString());
  form.append("file", content, "file");
  await apiPostForm("/api/file/putFile", form);
}

export async function readTextFile(path: string): Promise<string> {
  const blob = await getFileBlob(path);
  if (!blob) {
    return "";
  }
  return await blob.text();
}

export async function readDir(path: string): Promise<Array<{ name: string; isDir: boolean }>> {
  return await apiPost("/api/file/readDir", { path });
}

// ============================================================================
// Cached API Calls
// ============================================================================

/**
 * 内存缓存：listNotebooks结果
 * 避免在一次sync中重复请求notebooks列表（可能被调用上千次）
 */
let notebooksCache: Array<{ id: string; name: string }> | null = null;

/**
 * 清空notebooks缓存（在每次sync开始时调用）
 */
export function clearNotebooksCache(): void {
  notebooksCache = null;
}

/**
 * 获取notebooks列表（带缓存）
 */
export async function listNotebooks(): Promise<Array<{ id: string; name: string }>> {
  if (notebooksCache !== null) {
    return notebooksCache;
  }

  notebooksCache = await apiPost("/api/notebook/lsNotebooks", {});
  return notebooksCache;
}

export async function getDocInfo(docId: string): Promise<any> {
  const stmt = `select * from blocks where id = '${docId}'`;
  const rows = await apiPost<any[]>("/api/query/sql", { stmt });
  return rows && rows.length > 0 ? rows[0] : null;
}

export async function exportMarkdown(docId: string): Promise<{ content: string }> {
  return await apiPost("/api/export/exportMdContent", { id: docId });
}

export async function getDocFromBlock(blockId: string): Promise<any | null> {
  try {
    return await apiPost("/api/block/getDoc", { id: blockId });
  } catch {
    return null;
  }
}

export async function getBlockInfo(blockId: string): Promise<any | null> {
  try {
    return await apiPost("/api/block/getBlockInfo", { id: blockId });
  } catch {
    return null;
  }
}

export async function getBlockAttrs(blockId: string): Promise<Record<string, any> | null> {
  try {
    return await apiPost("/api/block/getBlockAttrs", { id: blockId });
  } catch {
    return null;
  }
}

export async function querySql<T = any>(stmt: string): Promise<T[]> {
  return await apiPost("/api/query/sql", { stmt });
}

export async function getRootIdByBlockId(blockId: string): Promise<{ root_id: string | null; box?: string | null }> {
  try {
    const rows = await querySql<{ root_id: string; box?: string }>(
      `select root_id, box from blocks where id='${blockId}' limit 1`,
    );
    if (rows && rows.length > 0) {
      return { root_id: rows[0].root_id ?? null, box: rows[0].box ?? null };
    }
  } catch {
    // ignore
  }
  return { root_id: null, box: null };
}

export function getActiveDocRefFromDOM(): { docId: string | null; blockId: string | null } {
  const looksLikeDoc = (v: string | null) => !!v && /^\d{14}-[a-z0-9]{7}$/i.test(v);

  // Scan DOM for any element carrying a doc-like id
  const scanDomForDocId = (): string | null => {
    const selectors = [
      "[data-doc-id]",
      "[data-root-id]",
      "[data-node-id]",
      ".protyle-content",
      ".protyle-title",
    ];
    for (const sel of selectors) {
      const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
      for (const el of els) {
        const candidates = [
          el.getAttribute("data-doc-id"),
          el.getAttribute("data-root-id"),
          el.getAttribute("data-node-id"),
          el.getAttribute("data-id"),
        ];
        for (const c of candidates) {
          if (looksLikeDoc(c)) return c as string;
        }
      }
    }
    return null;
  };

  // Priority 1: Try SiYuan tab API (most reliable for active tab)
  const app = (window as any)?.siyuan?.ws?.app;
  if (app?.tabs?.getCurrentTab) {
    try {
      const tab = app.tabs.getCurrentTab();
      console.info("lifeos_sync: [Priority 1] Tab API result:", {
        "tab.panel?.doc?.id": tab?.panel?.doc?.id,
        "tab.panel?.head?.dataset?.docId": tab?.panel?.head?.dataset?.docId,
        "tab.panel?.protyle?.block?.id": tab?.panel?.protyle?.block?.id,
        "tab.panel?.protyle?.block?.rootID": tab?.panel?.protyle?.block?.rootID,
      });
      const docId =
        tab?.panel?.doc?.id ||
        tab?.panel?.head?.dataset?.docId ||
        tab?.panel?.protyle?.block?.rootID ||
        tab?.panel?.protyle?.block?.id;
      const blockId = tab?.panel?.protyle?.block?.id || tab?.panel?.protyle?.block?.rootID || null;
      if (docId || blockId) {
        console.info("lifeos_sync: ✓ Using Tab API docId:", docId, "blockId:", blockId);
        return { docId: docId ?? null, blockId };
      }
    } catch (err) {
      console.warn("lifeos_sync: Tab API failed:", err);
    }
  } else {
    console.info("lifeos_sync: [Priority 1] Tab API not available");
  }

  // Priority 2: Try title node in VISIBLE protyle only
  const visibleProtyles = Array.from(
    document.querySelectorAll<HTMLElement>(".protyle:not(.fn__none)")
  );
  console.info("lifeos_sync: [Priority 2] Found", visibleProtyles.length, "visible protyles");

  for (const protyle of visibleProtyles) {
    const titleNode = protyle.querySelector<HTMLElement>(".protyle-title[data-node-id]");
    const titleId = titleNode?.getAttribute("data-node-id");
    console.info("lifeos_sync: [Priority 2] Protyle title data-node-id:", titleId);
    if (looksLikeDoc(titleId)) {
      console.info("lifeos_sync: ✓ Using protyle title docId:", titleId);
      return { docId: titleId as string, blockId: titleId as string };
    }
  }

  // Priority 3: Visible protyle attributes
  if (visibleProtyles.length > 0) {
    const el = visibleProtyles[0];
    console.info("lifeos_sync: [Priority 3] Visible protyle attrs:", {
      "data-doc-id": el.getAttribute("data-doc-id"),
      "data-id": el.getAttribute("data-id"),
      "data-root-id": el.getAttribute("data-root-id"),
      "data-node-id": el.getAttribute("data-node-id"),
    });
    const docId =
      el.getAttribute("data-doc-id") ||
      el.getAttribute("data-root-id") ||
      el.getAttribute("data-node-id") ||
      el.getAttribute("data-id");
    const blockId = el.getAttribute("data-id") || docId;
    if (looksLikeDoc(docId)) {
      console.info("lifeos_sync: ✓ Using visible protyle docId:", docId);
      return { docId, blockId: blockId ?? docId };
    }
    if (docId || blockId) {
      console.info("lifeos_sync: ✓ Using visible protyle (not doc-like) docId:", docId, "blockId:", blockId);
      return { docId, blockId };
    }
  }

  // Priority 4: Any protyle title
  const anyTitle = document.querySelector<HTMLElement>(".protyle-title[data-node-id]");
  const anyTitleId = anyTitle?.getAttribute("data-node-id");
  console.info("lifeos_sync: [Priority 4] Any protyle title data-node-id:", anyTitleId);
  if (looksLikeDoc(anyTitleId)) {
    console.info("lifeos_sync: ✓ Using any title docId:", anyTitleId);
    return { docId: anyTitleId as string, blockId: anyTitleId as string };
  }

  // Priority 5: Any protyle
  const any = document.querySelector<HTMLElement>(".protyle[data-doc-id], .protyle[data-id]");
  if (any) {
    console.info("lifeos_sync: [Priority 5] Any protyle attrs:", {
      "data-doc-id": any.getAttribute("data-doc-id"),
      "data-id": any.getAttribute("data-id"),
      "data-root-id": any.getAttribute("data-root-id"),
      "data-node-id": any.getAttribute("data-node-id"),
    });
    const docId =
      any.getAttribute("data-doc-id") ||
      any.getAttribute("data-id") ||
      any.getAttribute("data-root-id") ||
      any.getAttribute("data-node-id");
    const blockId = any.getAttribute("data-id") || docId;
    if (looksLikeDoc(docId)) {
      console.info("lifeos_sync: ✓ Using any protyle docId:", docId);
      return { docId, blockId: blockId ?? docId };
    }
    if (docId || blockId) {
      console.info("lifeos_sync: ✓ Using any protyle (not doc-like) docId:", docId, "blockId:", blockId);
      return { docId, blockId };
    }
  }

  // Priority 6: Deep scan DOM for doc-like id
  console.info("lifeos_sync: [Priority 6] Running deep DOM scan...");
  const domDoc = scanDomForDocId();
  if (domDoc) {
    console.info("lifeos_sync: ✓ Using DOM scan docId:", domDoc);
    return { docId: domDoc, blockId: domDoc };
  }

  // Priority 7 (LOWEST): File tree selection as last fallback
  const treeFocused = document.querySelector<HTMLElement>(".file-tree .b3-list-item--focus[data-node-id]");
  const treeId = treeFocused?.getAttribute("data-node-id");
  console.info("lifeos_sync: [Priority 7] File tree selection data-node-id:", treeId);
  if (looksLikeDoc(treeId)) {
    console.warn("lifeos_sync: ⚠ Using file tree fallback docId:", treeId);
    return { docId: treeId as string, blockId: treeId as string };
  }

  console.error("lifeos_sync: ✗ No doc ID found through any method");
  return { docId: null, blockId: null };
}

export function getActiveDocIdFromDOM(): string | null {
  const ref = getActiveDocRefFromDOM();
  return ref.docId || ref.blockId;
}
