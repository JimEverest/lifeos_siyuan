import { Plugin, Menu } from "siyuan";

import { loadSettings, saveSettings } from "./settings";
import { exportCurrentDocToGit } from "./exporter";
import { createStatusBar, updateStatusBar } from "./ui";
import { initLogger, logError, logInfo } from "./logger";
import type { Settings } from "./types";
import { getActiveDocRefFromDOM } from "./siyuan-api";
import { syncAllAssets } from "./assets-sync";

export default class LifeosSyncPlugin extends Plugin {
  private settings: Settings | null = null;
  private statusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    this.settings = await loadSettings(this);
    initLogger();
    await logInfo("plugin loaded v0.2.0");
    this.statusBarEl = createStatusBar(this);

    this.addTopBar({
      icon: "iconSync",
      title: "LifeOS Sync",
      callback: (event) => this.openMenu(event),
    });

    await logInfo("plugin loaded");
  }

  async onunload(): Promise<void> {
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

    const q = (sel: string) => card.querySelector<HTMLInputElement>(sel) as HTMLInputElement;
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
}
