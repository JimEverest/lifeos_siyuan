import { Plugin, Menu } from "siyuan";

import { loadSettings, saveSettings } from "./settings";
import { exportCurrentDocToGit } from "./exporter";
import { createStatusBar, updateStatusBar, showForceConfirmDialog } from "./ui";
import { initLogger, logError, logInfo } from "./logger";
import type { Settings } from "./types";
import { getActiveDocRefFromDOM } from "./siyuan-api";
import { syncAllAssets } from "./assets-sync";
import { AutoSyncScheduler } from "./auto-sync-scheduler";
import { initDeviceManager, getDeviceId, getDeviceName, setDeviceName, regenerateDeviceId, getShortDeviceId } from "./device-manager";
import { performForceSyncWithLock } from "./incremental-sync";
import { openSyncDashboard, openSyncHistoryDialog } from "./sync-dashboard";
import { rebuildCacheFromGitHub, type RebuildProgress } from "./cache-rebuild";

export default class LifeosSyncPlugin extends Plugin {
  private settings: Settings | null = null;
  private statusBarEl: HTMLElement | null = null;
  private autoSyncScheduler: AutoSyncScheduler | null = null;

  async onload(): Promise<void> {
    this.settings = await loadSettings(this);
    initLogger();
    await logInfo("plugin loaded v0.4.5");

    // 初始化设备管理器
    await initDeviceManager();

    this.statusBarEl = createStatusBar(this);

    this.addTopBar({
      icon: "iconSync",
      title: "LifeOS Sync",
      callback: (event) => this.openMenu(event),
    });

    // 启动自动同步调度器
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

  async onunload(): Promise<void> {
    // 停止自动同步
    if (this.autoSyncScheduler) {
      await this.autoSyncScheduler.stop();
      this.autoSyncScheduler = null;
    }

    // Flush所有待写入的日志
    const { flushAllLogs } = await import("./logger");
    await flushAllLogs();

    if (this.statusBarEl) {
      this.statusBarEl.remove();
      this.statusBarEl = null;
    }
    await logInfo("plugin unloaded");
  }

  private openMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem({
      label: "Export current doc",
      icon: "iconUpload",
      click: () => {
        void this.exportCurrentDoc();
      },
    });
    menu.addItem({
      label: "Sync all assets",
      icon: "iconImage",
      click: () => {
        void this.syncAllAssets();
      },
    });
    menu.addItem({
      label: `Auto sync: ${this.settings?.autoSync.enabled ? "ON" : "OFF"}`,
      icon: "iconRefresh",
      click: () => {
        void this.toggleAutoSync();
      },
    });
    menu.addSeparator();
    menu.addItem({
      label: "📊 Sync Dashboard",
      icon: "iconGraph",
      click: () => {
        void openSyncDashboard(this);
      },
    });
    menu.addItem({
      label: "📜 Sync History",
      icon: "iconHistory",
      click: () => {
        void openSyncHistoryDialog(this);
      },
    });
    menu.addSeparator();
    menu.addItem({
      label: "🔧 Rebuild Cache from GitHub",
      icon: "iconDownload",
      click: () => {
        void this.rebuildCache();
      },
    });
    menu.addItem({
      label: "⚠️ Clear Cache & Full Sync",
      icon: "iconTrashcan",
      click: () => {
        void this.clearCacheAndFullSync();
      },
    });
    menu.addItem({
      label: "⚠️ Force Sync (Override Lock)",
      icon: "iconWarning",
      click: () => {
        void this.forceSync();
      },
    });
    // 添加强制停止按钮（仅在同步运行时显示）
    if (this.autoSyncScheduler?.getIsRunning()) {
      menu.addItem({
        label: "⚠️ Force Stop Sync",
        icon: "iconClose",
        click: () => {
          void this.forceStopSync();
        },
      });
    }
    menu.addItem({
      label: "Configure...",
      icon: "iconSettings",
      click: () => {
        void this.openSettingsDialog();
      },
    });

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu.open({ x: rect.right, y: rect.bottom, isLeft: true });
  }

  private async openSettingsDialog(): Promise<void> {
    if (!this.settings) {
      this.settings = await loadSettings(this);
    }
    const s = this.settings;
    // Build a simple modal without relying on window.prompt/confirm or Dialog API
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

      <h4 style="margin-top:0;margin-bottom:8px;">📱 Device Settings</h4>
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

      <h4 style="margin-top:16px;margin-bottom:8px;">🔗 GitHub Settings</h4>
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

      <h4 style="margin-top:16px;margin-bottom:8px;">🚫 Ignore Settings</h4>
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

      <h4 style="margin-top:16px;margin-bottom:8px;">⏰ Auto Sync</h4>
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

      <h4 style="margin-top:16px;margin-bottom:8px;">🔒 Distributed Lock (Multi-device Conflict Prevention)</h4>
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
        <input class="b3-text-field fn__block" type="number" id="${dialogId}-lockttl" value="${Math.round(s.syncLock.lockTtl / 60000)}" min="1" max="60">
        <div class="b3-label__text">If a device crashes, lock auto-expires after this time</div>
      </label>
      <label class="b3-label">First check threshold (minutes)
        <input class="b3-text-field fn__block" type="number" id="${dialogId}-firstthreshold" value="${Math.round(s.syncLock.firstCheckThreshold / 60000)}" min="1" max="60">
        <div class="b3-label__text">Skip sync if last commit was within this time</div>
      </label>
      <label class="b3-label">Second check threshold (minutes)
        <input class="b3-text-field fn__block" type="number" id="${dialogId}-secondthreshold" value="${Math.round(s.syncLock.secondCheckThreshold / 60000)}" min="1" max="30">
        <div class="b3-label__text">Shorter threshold for the double-check after jitter</div>
      </label>
      <label class="b3-label">Random jitter range (seconds)
        <input class="b3-text-field fn__block" type="number" id="${dialogId}-jitter" value="${Math.round(s.syncLock.jitterRange / 1000)}" min="5" max="120">
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

    const q = (sel: string) => card.querySelector<HTMLInputElement>(sel) as HTMLInputElement;
    const destroy = () => {
      overlay.remove();
    };

    const doSave = async () => {
      const oldAutoSyncEnabled = this.settings.autoSync.enabled;

      // 保存设备名称到 localStorage
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
        ignoreNotebooks: (q(`#${dialogId}-ignb`).value || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        ignorePaths: (q(`#${dialogId}-ignp`).value || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        ignoreTags: (q(`#${dialogId}-ignt`).value || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
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
          lockTtl: (parseInt(q(`#${dialogId}-lockttl`).value) || 10) * 60 * 1000,
          firstCheckThreshold: (parseInt(q(`#${dialogId}-firstthreshold`).value) || 10) * 60 * 1000,
          secondCheckThreshold: (parseInt(q(`#${dialogId}-secondthreshold`).value) || 5) * 60 * 1000,
          jitterRange: (parseInt(q(`#${dialogId}-jitter`).value) || 15) * 1000
        }
      };
      await saveSettings(this, this.settings);

      // 如果自动同步设置变化，重启调度器
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
        // 更新现有调度器的设置
        this.autoSyncScheduler.updateSettings(this.settings);
        await this.autoSyncScheduler.restart();
      }

      await logInfo("Settings saved");
      destroy();
    };

    // Regenerate device ID button
    q(`#${dialogId}-regenerate`)?.addEventListener("click", () => {
      if (confirm("Are you sure you want to regenerate your device ID? This will change your device identity for sync lock purposes.")) {
        regenerateDeviceId();
        // Update the displayed short ID
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

  private async exportCurrentDoc(): Promise<void> {
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

  private async syncAllAssets(): Promise<void> {
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

  private async forceStopSync(): Promise<void> {
    if (this.autoSyncScheduler) {
      await this.autoSyncScheduler.forceStop();
      updateStatusBar(this.statusBarEl, "Sync force stopped");
      await logInfo("Sync force stopped by user");
    }
  }

  private async clearCacheAndFullSync(): Promise<void> {
    if (!this.settings) {
      await logError("Settings not loaded");
      return;
    }

    // ========================================================================
    // Two-step confirmation for dangerous operation
    // ========================================================================

    // Step 1: First warning dialog
    const firstConfirm = await this.showClearCacheWarningDialog();
    if (!firstConfirm) {
      await logInfo("[ClearCache] Cancelled at first confirmation");
      return;
    }

    // Step 2: Type "DELETE" confirmation
    const secondConfirm = await this.showClearCacheTypeConfirmDialog();
    if (!secondConfirm) {
      await logInfo("[ClearCache] Cancelled at second confirmation");
      return;
    }

    // ========================================================================
    // Execute clear cache
    // ========================================================================
    try {
      updateStatusBar(this.statusBarEl, "Clearing cache...");
      await logInfo("[ClearCache] Starting to clear all cache (user confirmed twice)");

      // Import clearAllCache function
      const { clearAllCache } = await import("./cache-manager");
      await clearAllCache(this);

      await logInfo("[ClearCache] All cache cleared successfully");
      updateStatusBar(this.statusBarEl, "Cache cleared. Starting full sync...");

      // Trigger a full sync by restarting auto sync scheduler
      if (this.autoSyncScheduler) {
        await this.autoSyncScheduler.stop();
        this.autoSyncScheduler = null;
      }

      // Start a new sync
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
  private showClearCacheWarningDialog(): Promise<boolean> {
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
            ⚠️ Dangerous Operation
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
            <strong>💡 Suggestion:</strong> Use "Rebuild Cache from GitHub" instead.
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
  private showClearCacheTypeConfirmDialog(): Promise<boolean> {
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
            ⚠️ Final Confirmation
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
      const inputEl = document.getElementById(`${dialogId}-input`) as HTMLInputElement;
      const errorEl = document.getElementById(`${dialogId}-error`) as HTMLElement;

      // Focus input
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

      // Allow Enter key to confirm
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

  private async toggleAutoSync(): Promise<void> {
    if (!this.settings) {
      return;
    }

    this.settings.autoSync.enabled = !this.settings.autoSync.enabled;
    await saveSettings(this, this.settings);

    if (this.settings.autoSync.enabled) {
      // 启动自动同步
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
      // 停止自动同步
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
  private async rebuildCache(): Promise<void> {
    if (!this.settings) {
      await logError("Settings not loaded");
      return;
    }

    // Show confirmation dialog
    const confirmed = await this.showRebuildCacheConfirmDialog();
    if (!confirmed) {
      await logInfo("[CacheRebuild] Cancelled by user");
      return;
    }

    // Pause auto sync during rebuild
    const wasAutoSyncEnabled = this.autoSyncScheduler !== null;
    if (this.autoSyncScheduler) {
      await this.autoSyncScheduler.stop();
      this.autoSyncScheduler = null;
      await logInfo("[CacheRebuild] Auto sync paused during rebuild");
    }

    // Show progress dialog
    const progressDialog = this.createRebuildProgressDialog();
    document.body.appendChild(progressDialog.overlay);

    try {
      const result = await rebuildCacheFromGitHub(
        this,
        this.settings,
        (progress: RebuildProgress) => {
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

    // Restore auto sync after rebuild (user can close dialog to continue)
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
  private showRebuildCacheConfirmDialog(): Promise<boolean> {
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
            🔧 Rebuild Cache from GitHub
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
  private createRebuildProgressDialog(): {
    overlay: HTMLElement;
    update: (progress: RebuildProgress) => void;
    showComplete: (result: any) => void;
    showError: (error: string) => void;
    onClose?: () => Promise<void>;
  } {
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
        <h2 style="margin: 0; font-size: 18px;">🔧 Rebuilding Cache...</h2>
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

    let onCloseCallback: (() => Promise<void>) | undefined;

    const result = {
      overlay,
      update: (progress: RebuildProgress) => {
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
      showComplete: (rebuildResult: any) => {
        const statusEl = document.getElementById(`${dialogId}-status`);
        const footerEl = document.getElementById(`${dialogId}-footer`);
        const progressBar = document.getElementById(`${dialogId}-progress-bar`);

        if (statusEl) {
          statusEl.innerHTML = `
            <span style="color: var(--b3-card-success-color, green);">✅ Cache rebuild complete!</span>
            <br><span style="font-size: 12px; opacity: 0.7;">Duration: ${(rebuildResult.duration / 1000).toFixed(1)}s</span>
            ${rebuildResult.truncated ? '<br><span style="color: var(--b3-card-warning-color, orange); font-size: 12px;">⚠️ File tree was truncated (repository may be too large)</span>' : ''}
          `;
        }
        if (progressBar) progressBar.style.width = "100%";
        if (footerEl) footerEl.style.display = "flex";

        document.getElementById(`${dialogId}-close`)?.addEventListener("click", async () => {
          overlay.remove();
          if (onCloseCallback) await onCloseCallback();
        });
      },
      showError: (error: string) => {
        const statusEl = document.getElementById(`${dialogId}-status`);
        const footerEl = document.getElementById(`${dialogId}-footer`);
        const progressBar = document.getElementById(`${dialogId}-progress-bar`);

        if (statusEl) {
          statusEl.innerHTML = `<span style="color: var(--b3-card-error-color, red);">❌ Error: ${error}</span>`;
        }
        if (progressBar) progressBar.style.background = "var(--b3-card-error-color, red)";
        if (footerEl) footerEl.style.display = "flex";

        document.getElementById(`${dialogId}-close`)?.addEventListener("click", async () => {
          overlay.remove();
          if (onCloseCallback) await onCloseCallback();
        });
      },
      set onClose(callback: (() => Promise<void>) | undefined) {
        onCloseCallback = callback;
      }
    };

    return result;
  }

  private async forceSync(): Promise<void> {
    if (!this.settings) {
      await logError("Settings not loaded");
      return;
    }

    // 显示确认对话框
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
}
