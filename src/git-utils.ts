/**
 * Git Utility Functions
 *
 * Git 相关工具函数
 * - Git Blob SHA 计算（与 GitHub SHA 兼容）
 * - Git Tree API 调用
 */

import { logInfo, logError } from "./logger";

// ============================================================================
// Git Blob SHA Calculation
// ============================================================================

/**
 * 计算 Git Blob SHA（与 GitHub 的 SHA 完全兼容）
 *
 * Git 的 blob SHA 算法：SHA1("blob " + content.length + "\0" + content)
 * 其中 content.length 是字节长度，不是字符长度
 *
 * @param content 文件内容（字符串）
 * @returns Git Blob SHA（40字符十六进制）
 */
export async function calculateGitBlobSHA(content: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const contentBytes = encoder.encode(content);

    // Git blob 格式: "blob {size}\0{content}"
    const header = `blob ${contentBytes.length}\0`;
    const headerBytes = encoder.encode(header);

    // 合并 header 和 content
    const combined = new Uint8Array(headerBytes.length + contentBytes.length);
    combined.set(headerBytes, 0);
    combined.set(contentBytes, headerBytes.length);

    // 使用 SHA-1 计算哈希（Git 使用 SHA-1）
    const hashBuffer = await crypto.subtle.digest("SHA-1", combined);

    // 转换为十六进制字符串
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (error) {
    // SHA-1 在某些环境可能不可用（如非安全上下文）
    // 返回一个基于内容的备用哈希
    await logError("[GitUtils] crypto.subtle.digest SHA-1 failed, using fallback", error);
    return calculateGitBlobSHAFallback(content);
  }
}

/**
 * Git Blob SHA 的备用计算方法（当 crypto.subtle 不可用时）
 * 使用简化的哈希算法，不保证与 GitHub 完全兼容
 */
function calculateGitBlobSHAFallback(content: string): string {
  // 使用 FNV-1a 作为备用，但加上 "git-" 前缀标记
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);

  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = (hash * 16777619) >>> 0;
  }

  // 返回带前缀的哈希，表示这不是真正的 Git SHA
  return `fallback-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * 计算二进制数据的 Git Blob SHA
 *
 * @param data 二进制数据（ArrayBuffer 或 Uint8Array）
 * @returns Git Blob SHA（40字符十六进制）
 */
export async function calculateGitBlobSHABinary(data: ArrayBuffer | Uint8Array): Promise<string> {
  try {
    const contentBytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    // Git blob 格式: "blob {size}\0{content}"
    const header = `blob ${contentBytes.length}\0`;
    const headerBytes = new TextEncoder().encode(header);

    // 合并 header 和 content
    const combined = new Uint8Array(headerBytes.length + contentBytes.length);
    combined.set(headerBytes, 0);
    combined.set(contentBytes, headerBytes.length);

    // 使用 SHA-1 计算哈希
    const hashBuffer = await crypto.subtle.digest("SHA-1", combined);

    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (error) {
    await logError("[GitUtils] Binary SHA-1 calculation failed", error);
    // 返回基于大小的备用标识
    const size = data instanceof Uint8Array ? data.length : data.byteLength;
    return `fallback-binary-${size}`;
  }
}

// ============================================================================
// GitHub Tree API
// ============================================================================

export interface GitHubTreeEntry {
  path: string;
  sha: string;
  type: "blob" | "tree";
  size?: number;
  mode: string;
}

export interface GitHubTreeResponse {
  sha: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

/**
 * 获取 GitHub 仓库的完整文件树
 *
 * 使用 Git Tree API 一次调用获取整个仓库的所有文件
 *
 * @param owner 仓库所有者
 * @param repo 仓库名称
 * @param branch 分支名称
 * @param token GitHub Token
 * @returns Map<文件路径, SHA>
 */
export async function getGitHubFileTree(
  owner: string,
  repo: string,
  branch: string,
  token: string
): Promise<{ files: Map<string, string>; truncated: boolean }> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

  await logInfo(`[GitUtils] Fetching file tree from GitHub: ${owner}/${repo}@${branch}`);

  const response = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub Tree API failed: ${response.status} ${errorText}`);
  }

  const data: GitHubTreeResponse = await response.json();

  // 构建文件路径到 SHA 的映射
  const files = new Map<string, string>();
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

/**
 * 检查 GitHub 仓库是否可访问
 */
export async function checkGitHubAccess(
  owner: string,
  repo: string,
  token: string
): Promise<{ accessible: boolean; error?: string }> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (response.ok) {
      return { accessible: true };
    } else if (response.status === 404) {
      return { accessible: false, error: "Repository not found or no access" };
    } else if (response.status === 401) {
      return { accessible: false, error: "Invalid token or token expired" };
    } else {
      return { accessible: false, error: `GitHub API error: ${response.status}` };
    }
  } catch (error) {
    return { accessible: false, error: `Network error: ${error}` };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * 从仓库 URL 解析 owner 和 repo
 */
export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
  // 支持格式:
  // https://github.com/owner/repo
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git

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

/**
 * 验证 SHA 格式（40字符十六进制）
 */
export function isValidGitSHA(sha: string): boolean {
  return /^[a-f0-9]{40}$/.test(sha);
}

/**
 * 检查是否是备用哈希（非真正的 Git SHA）
 */
export function isFallbackHash(hash: string): boolean {
  return hash.startsWith("fallback-");
}
