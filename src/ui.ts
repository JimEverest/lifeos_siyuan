import type { Plugin } from "siyuan";
import { formatRemainingTime } from "./sync-lock";

// ============================================================================
// Status Bar
// ============================================================================

export function createStatusBar(plugin?: Plugin): HTMLElement {
  const el = document.createElement("span");
  el.className = "lifeos-sync-status";
  el.textContent = "";

  if (plugin && typeof (plugin as any).addStatusBar === "function") {
    (plugin as any).addStatusBar({ element: el });
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

export function updateStatusBar(el: HTMLElement | null, message: string): void {
  if (!el) {
    return;
  }
  el.textContent = message;

  // Force a repaint to ensure immediate update
  void el.offsetHeight;
}

// ============================================================================
// Status Message Helpers (带 emoji 的状态提示)
// ============================================================================

/**
 * 显示同步被跳过的原因（其他设备正在同步）
 */
export function showLockBlockedStatus(el: HTMLElement | null, deviceName: string, remainingTime: number): void {
  const timeStr = formatRemainingTime(remainingTime);
  updateStatusBar(el, `⏸️ ${deviceName} is syncing (${timeStr})`);
}

/**
 * 显示同步被跳过的原因（最近有人同步过）
 */
export function showRecentSyncStatus(el: HTMLElement | null, minutesAgo: number, thresholdMinutes: number): void {
  updateStatusBar(el, `⏸️ Last sync ${minutesAgo}m ago (threshold: ${thresholdMinutes}m)`);
}

/**
 * 显示等待 jitter 的倒计时
 */
export function showJitterCountdown(el: HTMLElement | null, remainingMs: number): void {
  const seconds = Math.ceil(remainingMs / 1000);
  updateStatusBar(el, `⏳ Waiting to sync... (${seconds}s)`);
}

/**
 * 显示正在检查锁状态
 */
export function showCheckingLockStatus(el: HTMLElement | null): void {
  updateStatusBar(el, `🔍 Checking sync lock...`);
}

/**
 * 显示正在获取锁
 */
export function showAcquiringLockStatus(el: HTMLElement | null): void {
  updateStatusBar(el, `🔒 Acquiring sync lock...`);
}

/**
 * 显示正在同步
 */
export function showSyncingStatus(el: HTMLElement | null, current: number, total: number, type: "docs" | "assets"): void {
  const emoji = type === "docs" ? "📄" : "🖼️";
  const label = type === "docs" ? "docs" : "assets";
  updateStatusBar(el, `🔄 Syncing ${label}... ${emoji} (${current}/${total})`);
}

/**
 * 显示同步完成
 */
export function showSyncCompleteStatus(el: HTMLElement | null, docs: number, assets: number, timeSeconds: number): void {
  updateStatusBar(el, `✅ Sync complete: ${docs} docs, ${assets} assets (${timeSeconds.toFixed(1)}s)`);
}

/**
 * 显示同步失败
 */
export function showSyncErrorStatus(el: HTMLElement | null, error: string): void {
  // 截断错误信息，避免状态栏过长
  const shortError = error.length > 50 ? error.substring(0, 47) + "..." : error;
  updateStatusBar(el, `❌ Sync failed: ${shortError}`);
}

// 用于清除状态栏的定时器
let statusClearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 显示同步被跳过的原因，15秒后自动清除
 */
export function showSyncSkippedStatus(el: HTMLElement | null, reason: string): void {
  updateStatusBar(el, `⏸️ Sync skipped: ${reason}`);

  // 清除之前的定时器
  if (statusClearTimer) {
    clearTimeout(statusClearTimer);
  }

  // 15秒后自动清除状态栏
  statusClearTimer = setTimeout(() => {
    clearStatusBar(el);
    statusClearTimer = null;
  }, 15000);
}

/**
 * 显示强制同步进行中
 */
export function showForceSyncStatus(el: HTMLElement | null): void {
  updateStatusBar(el, `⚠️ Force sync in progress...`);
}

/**
 * 清空状态栏
 */
export function clearStatusBar(el: HTMLElement | null): void {
  updateStatusBar(el, "");
}

// ============================================================================
// Confirmation Dialog
// ============================================================================

/**
 * 显示确认对话框（需要输入特定文字确认）
 */
export async function showForceConfirmDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    // 创建对话框容器
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
        ⚠️ Force Sync Confirmation
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

    const input = dialog.querySelector("#force-sync-input") as HTMLInputElement;
    const cancelBtn = dialog.querySelector("#force-sync-cancel") as HTMLButtonElement;
    const confirmBtn = dialog.querySelector("#force-sync-confirm") as HTMLButtonElement;

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

    // 点击遮罩层关闭
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(false);
      }
    };

    // 聚焦输入框
    setTimeout(() => input.focus(), 100);
  });
}
