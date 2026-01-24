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

export default class LifeosSyncPlugin extends Plugin {
  private settings: Settings | null = null;
  private statusBarEl: HTMLElement | null = null;
  private autoSyncScheduler: AutoSyncScheduler | null = null;

  async onload(): Promise<void> {
    this.settings = await loadSettings(this);
    initLogger();
    await logInfo("plugin loaded v0.4.3");

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
    menu.addItem({
      label: "🔄 Clear cache & full sync",
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
        <span style="opacity:0.6; font-size:12px;">v0.4.3</span>
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

    try {
      updateStatusBar(this.statusBarEl, "Clearing cache...");
      await logInfo("[ClearCache] Starting to clear all cache");

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
