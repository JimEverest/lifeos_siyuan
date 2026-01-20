import type { GitWriteOptions, RepoInfo } from "./types";

export function parseRepoUrl(url: string): RepoInfo | null {
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

function base64FromUtf8(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Proxy fetch through SiYuan kernel to avoid client-side direct GitHub API calls.
 * This way all requests are made from the server (Docker container), not from the browser.
 */
async function proxyFetch(url: string, options: RequestInit): Promise<Response> {
  const headers: Array<Record<string, string>> = [];
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
        headers.push({ [key]: value as string });
      }
    }
  }

  // Parse payload as object
  let payload: any = null;
  if (options.body) {
    if (typeof options.body === "string") {
      try {
        payload = JSON.parse(options.body);
      } catch {
        // If not valid JSON, keep as string
        payload = options.body;
      }
    } else {
      payload = options.body;
    }
  }

  // Use SiYuan's forwardProxy API to make the request from server side
  const proxyRes = await fetch("/api/network/forwardProxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      method: options.method || "GET",
      headers,
      payload: payload,
      timeout: 300000, // 300 seconds (5 minutes) for large files
    }),
  });

  if (!proxyRes.ok) {
    const errorText = await proxyRes.text();
    throw new Error(`SiYuan proxy request failed: ${errorText}`);
  }

  const proxyData = await proxyRes.json();

  if (proxyData.code !== 0) {
    throw new Error(`SiYuan proxy error: ${proxyData.msg || "Unknown error"}`);
  }

  // Convert SiYuan proxy response to standard Response object
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
    clone: function() { return this; },
    bodyUsed: false,
    body: null,
    type: "basic",
    url: url,
    redirected: false,
    formData: async () => { throw new Error("Not implemented"); },
  } as Response;
}

async function getFileSha(opts: GitWriteOptions): Promise<string | null> {
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/contents/${opts.path}?ref=${opts.branch}`;
  const res = await proxyFetch(url, {
    method: "GET",
    headers: {
      Authorization: `token ${opts.token}`,
      Accept: "application/vnd.github+json",
    },
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

export async function createOrUpdateTextFile(opts: GitWriteOptions, content: string): Promise<any> {
  const sha = await getFileSha(opts);
  const body = {
    message: opts.message,
    content: base64FromUtf8(content),
    branch: opts.branch,
    sha: sha ?? undefined,
  };
  return await writeFile(opts, body);
}

export async function createOrUpdateBinaryFile(opts: GitWriteOptions, buffer: ArrayBuffer): Promise<any> {
  const sha = await getFileSha(opts);
  const body = {
    message: opts.message,
    content: base64FromArrayBuffer(buffer),
    branch: opts.branch,
    sha: sha ?? undefined,
  };
  return await writeFile(opts, body);
}

async function writeFile(opts: GitWriteOptions, body: any): Promise<any> {
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/contents/${opts.path}`;
  const res = await proxyFetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${opts.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();

    // Check for 409 conflict (SHA mismatch)
    try {
      const errorData = JSON.parse(text);
      if (res.status === 409 && errorData.status === "409") {
        // SHA conflict detected - retry with fresh SHA
        console.warn(`lifeos_sync: 409 conflict for ${opts.path}, retrying with fresh SHA`);
        const freshSha = await getFileSha(opts);
        body.sha = freshSha ?? undefined;

        // Retry once with fresh SHA
        const retryRes = await proxyFetch(url, {
          method: "PUT",
          headers: {
            Authorization: `token ${opts.token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!retryRes.ok) {
          const retryText = await retryRes.text();
          throw new Error(`GitHub write failed after retry: ${retryText}`);
        }

        const retryData = await retryRes.json();
        return retryData;
      }
    } catch (parseError) {
      // Not JSON or different error, fall through
    }

    throw new Error(`GitHub write failed: ${text}`);
  }

  // 返回 GitHub API 响应
  const responseData = await res.json();
  return responseData;
}
