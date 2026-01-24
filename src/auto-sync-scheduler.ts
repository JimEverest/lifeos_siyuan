/**
 * Auto Sync Scheduler
 *
 * 自动同步调度器，支持定时触发增量同步
 * v0.4.3: 集成分布式锁机制
 */

import type { Plugin } from "siyuan";
import type { Settings, IncrementalSyncResult } from "./types";
import { logInfo, logError } from "./logger";
import { performIncrementalSync, performIncrementalSyncWithLock, LockedSyncResult } from "./incremental-sync";

export class AutoSyncScheduler {
  private plugin: Plugin;
  private settings: Settings;
  private timerId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private onProgress?: (message: string) => void;
  private statusBarEl: HTMLElement | null = null;
  private static globalInstance: AutoSyncScheduler | null = null;

  constructor(
    plugin: Plugin,
    settings: Settings,
    onProgress?: (message: string) => void,
    statusBarEl?: HTMLElement | null
  ) {
    // 清理旧的全局实例
    if (AutoSyncScheduler.globalInstance) {
      void AutoSyncScheduler.globalInstance.stop();
      AutoSyncScheduler.globalInstance = null;
    }

    this.plugin = plugin;
    this.settings = settings;
    this.onProgress = onProgress;
    this.statusBarEl = statusBarEl || null;

    // 注册为全局实例
    AutoSyncScheduler.globalInstance = this;
  }

  /**
   * 启动自动同步
   */
  async start(): Promise<void> {
    if (!this.settings.autoSync.enabled) {
      await logInfo("[AutoSync] Auto sync is disabled");
      return;
    }

    if (this.timerId) {
      await logInfo("[AutoSync] Already running");
      return;
    }

    const intervalMs = this.settings.autoSync.interval * 60 * 1000;
    await logInfo(`[AutoSync] Starting auto sync (interval: ${this.settings.autoSync.interval} minutes)`);

    // 立即执行一次
    void this.runSync();

    // 设置定时器
    this.timerId = setInterval(() => {
      void this.runSync();
    }, intervalMs);

    await logInfo("[AutoSync] Scheduler started");
  }

  /**
   * 停止自动同步
   */
  async stop(): Promise<void> {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      await logInfo("[AutoSync] Scheduler stopped");
    }
  }

  /**
   * 强制停止同步（包括正在运行的任务）
   */
  async forceStop(): Promise<void> {
    await this.stop();
    if (this.isRunning) {
      await logInfo("[AutoSync] Force stopping running sync");
      this.isRunning = false; // 强制设置为false，让当前任务可以结束
    }
  }

  /**
   * 获取同步状态
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * 执行一次同步（带分布式锁）
   */
  private async runSync(): Promise<void> {
    if (this.isRunning) {
      await logInfo("[AutoSync] Sync already running, skipping");
      return;
    }

    this.isRunning = true;

    try {
      await logInfo("[AutoSync] Starting sync cycle with lock check");
      this.onProgress?.("[AutoSync] Starting...");

      // 使用带锁的同步函数
      const lockedResult = await performIncrementalSyncWithLock(
        this.plugin,
        this.settings,
        this.statusBarEl,
        this.onProgress
      );

      if (lockedResult.executed && lockedResult.result) {
        // 同步成功执行
        await this.logSyncResult(lockedResult.result);
        this.onProgress?.(this.formatSyncResult(lockedResult.result));
      } else if (lockedResult.skippedReason) {
        // 同步被跳过（锁或时间检查）
        await logInfo(`[AutoSync] Sync skipped: ${lockedResult.skippedReason}`);
        // 状态栏已由 performIncrementalSyncWithLock 更新
      } else if (lockedResult.error) {
        // 同步出错
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
  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  /**
   * 重启调度器（配置变更后）
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * 记录同步结果
   */
  private async logSyncResult(result: IncrementalSyncResult): Promise<void> {
    await logInfo(
      `[AutoSync] Sync complete:\n` +
      `  Documents: ${result.docsUploaded} uploaded, ${result.docsSkipped} skipped, ${result.docsFailed} failed (${result.docsScanned} scanned, ${result.docsChanged} changed)\n` +
      `  Assets: ${result.assetsUploaded} uploaded, ${result.assetsSkipped} skipped, ${result.assetsFailed} failed (${result.assetsScanned} scanned, ${result.assetsChanged} changed)\n` +
      `  Time: ${(result.totalTime / 1000).toFixed(1)}s`
    );

    if (result.errors.length > 0) {
      await logError(`[AutoSync] ${result.errors.length} errors occurred:\n${result.errors.map(e => `  ${e.path}: ${e.error}`).join("\n")}`);
    }
  }

  /**
   * 格式化同步结果（用于状态栏显示）
   */
  private formatSyncResult(result: IncrementalSyncResult): string {
    const docs = result.docsUploaded > 0 ? `${result.docsUploaded} docs` : "";
    const assets = result.assetsUploaded > 0 ? `${result.assetsUploaded} assets` : "";
    const parts = [docs, assets].filter(Boolean);

    if (parts.length === 0) {
      return "[AutoSync] No changes";
    }

    return `[AutoSync] Synced: ${parts.join(", ")} (${(result.totalTime / 1000).toFixed(1)}s)`;
  }

  /**
   * 获取调度器状态
   */
  isActive(): boolean {
    return this.timerId !== null;
  }

  /**
   * 手动触发一次同步（带分布式锁）
   */
  async triggerSync(): Promise<LockedSyncResult> {
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
  setStatusBarEl(el: HTMLElement | null): void {
    this.statusBarEl = el;
  }
}
