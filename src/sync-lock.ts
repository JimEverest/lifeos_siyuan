/**
 * Sync Lock Module
 *
 * 分布式同步锁机制，防止多设备同时同步导致冲突
 *
 * 工作流程：
 * 1. 检查 GitHub 上是否有锁文件 .sync-in-progress
 * 2. 检查最近 commit 时间是否超过阈值
 * 3. 随机等待（jitter）错开并发
 * 4. 二次检查
 * 5. 创建锁文件
 * 6. 执行同步
 * 7. 删除锁文件
 */

import type { Settings } from "./types";
import { parseRepoUrl } from "./git";
import { logInfo, logError } from "./logger";
import { getDeviceId, getDeviceName } from "./device-manager";

// ============================================================================
// Types
// ============================================================================

export interface SyncLockInfo {
  deviceId: string;
  deviceName: string;
  startTime: number;
  startTimeReadable: string;
  ttl: number;
  expiresAt: number;
  expiresAtReadable: string;
}

export interface SyncLockCheckResult {
  canSync: boolean;
  reason?: string;
  lockInfo?: SyncLockInfo;
  waitTime?: number;  // 需要等待的时间（毫秒）
}

export interface SyncLockSettings {
  enabled: boolean;              // 是否启用分布式锁
  lockTtl: number;               // 锁超时时间（毫秒），默认 600000 (10分钟)
  firstCheckThreshold: number;   // 第一次检查阈值（毫秒），默认 600000 (10分钟)
  secondCheckThreshold: number;  // 第二次检查阈值（毫秒），默认 300000 (5分钟)
  jitterRange: number;           // 随机等待范围（毫秒），默认 15000 (15秒)
}

// ============================================================================
// Constants
// ============================================================================

const LOCK_FILE_PATH = ".sync-in-progress";

// 默认锁配置
export const DEFAULT_SYNC_LOCK_SETTINGS: SyncLockSettings = {
  enabled: true,
  lockTtl: 10 * 60 * 1000,           // 10 分钟
  firstCheckThreshold: 10 * 60 * 1000, // 10 分钟
  secondCheckThreshold: 5 * 60 * 1000,  // 5 分钟
  jitterRange: 15 * 1000               // 15 秒
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 格式化时间为 UTC+8 可读格式
 */
function formatTimeReadable(timestamp: number): string {
  try {
    const date = new Date(timestamp);
    // 转换为 UTC+8
    const utc8Offset = 8 * 60 * 60 * 1000;
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

/**
 * 计算基于 deviceId 的稳定 jitter 时间
 * 同一设备每次的 jitter 相对稳定，但不同设备之间有差异
 */
function calculateJitter(deviceId: string, jitterRange: number): number {
  // 使用简单的哈希算法
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    const char = deviceId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // 取绝对值并映射到 jitterRange
  const absHash = Math.abs(hash);
  return absHash % jitterRange;
}

/**
 * 格式化剩余时间
 */
export function formatRemainingTime(milliseconds: number): string {
  if (milliseconds <= 0) return "0s";

  const seconds = Math.ceil(milliseconds / 1000);
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

// ============================================================================
// GitHub API Functions
// ============================================================================

/**
 * 通过 SiYuan 代理发送 GitHub API 请求
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

  let payload: any = null;
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
      timeout: 30000
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
  } as Response;
}

/**
 * 获取 GitHub 仓库最近一次 commit 时间
 */
export async function getLastCommitTime(settings: Settings): Promise<number> {
  const repo = parseRepoUrl(settings.repoUrl);
  if (!repo) {
    throw new Error("Invalid repo URL");
  }

  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${settings.branch}`;

  try {
    const res = await proxyFetch(url, {
      method: "GET",
      headers: {
        Authorization: `token ${settings.token}`,
        Accept: "application/vnd.github+json"
      }
    });

    if (!res.ok) {
      if (res.status === 404) {
        // 仓库或分支不存在，返回 0 表示没有 commit
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

/**
 * 获取锁文件内容
 */
export async function getSyncLock(settings: Settings): Promise<SyncLockInfo | null> {
  const repo = parseRepoUrl(settings.repoUrl);
  if (!repo) {
    throw new Error("Invalid repo URL");
  }

  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${LOCK_FILE_PATH}?ref=${settings.branch}`;

  try {
    const res = await proxyFetch(url, {
      method: "GET",
      headers: {
        Authorization: `token ${settings.token}`,
        Accept: "application/vnd.github+json"
      }
    });

    if (res.status === 404) {
      // 锁文件不存在
      return null;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get lock file: ${text}`);
    }

    const data = await res.json();
    if (data && data.content) {
      // GitHub 返回的内容是 base64 编码的
      const content = atob(data.content.replace(/\n/g, ""));
      const lockInfo = JSON.parse(content) as SyncLockInfo;
      return lockInfo;
    }

    return null;
  } catch (e) {
    await logError(`[SyncLock] Failed to get sync lock: ${e}`);
    return null;
  }
}

/**
 * 获取锁文件的 SHA（用于更新/删除）
 */
async function getLockFileSha(settings: Settings): Promise<string | null> {
  const repo = parseRepoUrl(settings.repoUrl);
  if (!repo) {
    return null;
  }

  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${LOCK_FILE_PATH}?ref=${settings.branch}`;

  try {
    const res = await proxyFetch(url, {
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

/**
 * 创建锁文件
 */
export async function createSyncLock(
  settings: Settings,
  lockSettings: SyncLockSettings
): Promise<boolean> {
  const repo = parseRepoUrl(settings.repoUrl);
  if (!repo) {
    throw new Error("Invalid repo URL");
  }

  const deviceId = getDeviceId();
  const deviceName = getDeviceName();
  const now = Date.now();

  const lockInfo: SyncLockInfo = {
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

  // 检查是否已有锁文件（用于更新）
  const existingSha = await getLockFileSha(settings);

  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${LOCK_FILE_PATH}`;

  try {
    const body: any = {
      message: `[LifeOS Sync] Lock acquired by ${deviceName}`,
      content: base64Content,
      branch: settings.branch
    };

    if (existingSha) {
      body.sha = existingSha;
    }

    const res = await proxyFetch(url, {
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

/**
 * 释放锁文件（删除）
 */
export async function releaseSyncLock(settings: Settings): Promise<boolean> {
  const repo = parseRepoUrl(settings.repoUrl);
  if (!repo) {
    return false;
  }

  const sha = await getLockFileSha(settings);
  if (!sha) {
    // 锁文件不存在，无需删除
    return true;
  }

  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${LOCK_FILE_PATH}`;
  const deviceName = getDeviceName();

  try {
    const res = await proxyFetch(url, {
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

// ============================================================================
// Lock Check Logic
// ============================================================================

/**
 * 检查是否可以开始同步（第一次检查）
 */
export async function checkCanSync(
  settings: Settings,
  lockSettings: SyncLockSettings,
  onStatus?: (message: string) => void
): Promise<SyncLockCheckResult> {
  const deviceId = getDeviceId();
  const deviceName = getDeviceName();

  await logInfo(`[SyncLock] Checking sync eligibility for ${deviceName}`);

  // 1. 检查是否有锁文件
  onStatus?.("Checking for existing sync lock...");
  const existingLock = await getSyncLock(settings);

  if (existingLock) {
    const now = Date.now();

    // 检查是否是自己的锁
    if (existingLock.deviceId === deviceId) {
      // 是自己的锁，可能是上次崩溃遗留的
      await logInfo(`[SyncLock] Found stale lock from this device, will override`);
      return { canSync: true };
    }

    // 检查锁是否过期
    if (now < existingLock.expiresAt) {
      // 锁未过期，其他设备正在同步
      const remainingTime = existingLock.expiresAt - now;
      const reason = `${existingLock.deviceName} is syncing (expires in ${formatRemainingTime(remainingTime)})`;
      await logInfo(`[SyncLock] Cannot sync: ${reason}`);
      return {
        canSync: false,
        reason,
        lockInfo: existingLock
      };
    } else {
      // 锁已过期，可以覆盖
      await logInfo(`[SyncLock] Found expired lock from ${existingLock.deviceName}, will override`);
    }
  }

  // 2. 检查最近 commit 时间
  onStatus?.("Checking last commit time...");
  const lastCommitTime = await getLastCommitTime(settings);

  if (lastCommitTime > 0) {
    const timeSinceLastCommit = Date.now() - lastCommitTime;

    if (timeSinceLastCommit < lockSettings.firstCheckThreshold) {
      // 最近有人同步过
      const threshold = lockSettings.firstCheckThreshold / 60000; // 转换为分钟
      const sinceMinutes = Math.floor(timeSinceLastCommit / 60000);
      const reason = `Last sync ${sinceMinutes}m ago (threshold: ${threshold}m)`;
      await logInfo(`[SyncLock] Cannot sync: ${reason}`);
      return {
        canSync: false,
        reason
      };
    }
  }

  // 3. 需要等待 jitter 时间
  const jitterTime = calculateJitter(deviceId, lockSettings.jitterRange);
  await logInfo(`[SyncLock] Jitter time calculated: ${jitterTime}ms`);

  return {
    canSync: true,
    waitTime: jitterTime
  };
}

/**
 * 等待 jitter 时间（带倒计时回调）
 */
export async function waitWithCountdown(
  milliseconds: number,
  onCountdown?: (remaining: number) => void
): Promise<void> {
  const startTime = Date.now();
  const endTime = startTime + milliseconds;

  return new Promise((resolve) => {
    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, endTime - now);

      if (remaining > 0) {
        onCountdown?.(remaining);
        setTimeout(tick, 1000); // 每秒更新一次
      } else {
        onCountdown?.(0);
        resolve();
      }
    };

    tick();
  });
}

/**
 * 二次检查（jitter 后）
 */
export async function checkCanSyncAfterJitter(
  settings: Settings,
  lockSettings: SyncLockSettings,
  onStatus?: (message: string) => void
): Promise<SyncLockCheckResult> {
  const deviceId = getDeviceId();
  const deviceName = getDeviceName();

  await logInfo(`[SyncLock] Second check after jitter for ${deviceName}`);

  // 1. 再次检查锁文件
  onStatus?.("Double-checking for sync lock...");
  const existingLock = await getSyncLock(settings);

  if (existingLock) {
    const now = Date.now();

    // 检查是否是自己的锁
    if (existingLock.deviceId === deviceId) {
      return { canSync: true };
    }

    // 检查锁是否过期
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

  // 2. 再次检查 commit 时间（使用更短的阈值）
  onStatus?.("Double-checking last commit time...");
  const lastCommitTime = await getLastCommitTime(settings);

  if (lastCommitTime > 0) {
    const timeSinceLastCommit = Date.now() - lastCommitTime;

    if (timeSinceLastCommit < lockSettings.secondCheckThreshold) {
      const threshold = lockSettings.secondCheckThreshold / 60000;
      const sinceMinutes = Math.floor(timeSinceLastCommit / 60000);
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

/**
 * 完整的锁检查流程（供外部调用）
 */
export async function acquireSyncLock(
  settings: Settings,
  lockSettings: SyncLockSettings,
  onStatus?: (message: string) => void,
  onCountdown?: (remaining: number) => void
): Promise<SyncLockCheckResult> {
  // 如果锁机制被禁用，直接返回可以同步
  if (!lockSettings.enabled) {
    await logInfo("[SyncLock] Lock mechanism disabled, proceeding with sync");
    return { canSync: true };
  }

  // 第一次检查
  const firstCheck = await checkCanSync(settings, lockSettings, onStatus);
  if (!firstCheck.canSync) {
    return firstCheck;
  }

  // 等待 jitter 时间
  if (firstCheck.waitTime && firstCheck.waitTime > 0) {
    onStatus?.(`Waiting ${Math.ceil(firstCheck.waitTime / 1000)}s to avoid conflicts...`);
    await waitWithCountdown(firstCheck.waitTime, onCountdown);
  }

  // 二次检查
  const secondCheck = await checkCanSyncAfterJitter(settings, lockSettings, onStatus);
  if (!secondCheck.canSync) {
    return secondCheck;
  }

  // 创建锁文件
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
