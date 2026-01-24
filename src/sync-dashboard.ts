/**
 * Sync Dashboard
 *
 * 同步仪表板 - 显示同步统计信息和历史记录
 */

import type { Plugin } from "siyuan";
import type { SyncHistoryRecord, SyncStatistics } from "./types";
import {
  loadSyncHistory,
  loadSyncStatistics,
  getRecentRecords,
  clearSyncHistory,
  formatDuration,
  formatTimestamp,
  formatRelativeTime,
  calculateCacheHitRate
} from "./sync-history";
import { getFullIdentity, isBrowserEnvironment } from "./device-manager";
import { logInfo } from "./logger";

// ============================================================================
// Dashboard Dialog
// ============================================================================

/**
 * 打开同步仪表板对话框
 */
export async function openSyncDashboard(plugin: Plugin): Promise<void> {
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
        <h2 style="margin: 0; font-size: 18px;">📊 Sync Dashboard</h2>
        <button id="${dialogId}-close" style="background: none; border: none; font-size: 24px; cursor: pointer; opacity: 0.6;">&times;</button>
      </div>
      <div style="margin-top: 8px; font-size: 12px; opacity: 0.7;">
        Device: ${identity.displayName} (${shortDeviceId}...)
      </div>
    </div>

    <div style="flex: 1; overflow-y: auto; padding: 20px;">
      <!-- Statistics Cards -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px;">
        ${createStatCard("📄", "Docs Uploaded", stats.totalDocsUploaded.toString(), `Today: ${stats.recentDocsUploaded}`)}
        ${createStatCard("🖼️", "Assets Uploaded", stats.totalAssetsUploaded.toString(), `Today: ${stats.recentAssetsUploaded}`)}
        ${createStatCard("🔄", "Total Syncs", stats.totalSyncCount.toString(), `Today: ${stats.recentSyncCount}`)}
        ${createStatCard("⚡", "Cache Hit Rate", calculateCacheHitRate(stats), `${stats.cacheHits} hits`)}
      </div>

      <!-- Time Stats -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px;">
        ${createStatCard("⏱️", "Total Sync Time", formatDuration(stats.totalSyncTime), "Cumulative")}
        ${createStatCard("📅", "First Sync", stats.firstSyncTime ? formatRelativeTime(stats.firstSyncTime) : "Never", stats.firstSyncTime ? formatTimestamp(stats.firstSyncTime).split(",")[0] : "")}
        ${createStatCard("🕐", "Last Sync", stats.lastSyncTime ? formatRelativeTime(stats.lastSyncTime) : "Never", "")}
      </div>

      <!-- Device Stats -->
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 12px 0; font-size: 14px; opacity: 0.8;">📱 Device Sync Activity</h3>
        <div style="background: var(--b3-theme-surface-lighter, #f5f5f5); border-radius: 8px; overflow: hidden;">
          ${createDeviceStatsTable(stats)}
        </div>
      </div>

      <!-- Recent Sync History -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 style="margin: 0; font-size: 14px; opacity: 0.8;">📜 Recent Sync History</h3>
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

  // Event handlers
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
      await openSyncDashboard(plugin); // Reopen with fresh data
    }
  });
}

// ============================================================================
// History Dialog (Detailed View)
// ============================================================================

/**
 * 打开同步历史详情对话框
 */
export async function openSyncHistoryDialog(plugin: Plugin): Promise<void> {
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
        <h2 style="margin: 0; font-size: 18px;">📜 Sync History</h2>
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

  // Event handlers
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

// ============================================================================
// Helper Functions
// ============================================================================

function createStatCard(icon: string, label: string, value: string, subtitle: string): string {
  return `
    <div style="background: var(--b3-theme-surface-lighter, #f5f5f5); padding: 16px; border-radius: 8px; text-align: center;">
      <div style="font-size: 24px; margin-bottom: 4px;">${icon}</div>
      <div style="font-size: 20px; font-weight: bold; margin-bottom: 2px;">${value}</div>
      <div style="font-size: 11px; opacity: 0.7;">${label}</div>
      ${subtitle ? `<div style="font-size: 10px; opacity: 0.5; margin-top: 4px;">${subtitle}</div>` : ''}
    </div>
  `;
}

function createDeviceStatsTable(stats: SyncStatistics): string {
  const devices = Object.entries(stats.deviceSyncStats);

  if (devices.length === 0) {
    return `<div style="padding: 20px; text-align: center; opacity: 0.6;">No device data yet</div>`;
  }

  const identity = getFullIdentity();
  const currentDeviceId = identity.device.deviceId;

  let rows = '';
  for (const [deviceId, data] of devices) {
    const isCurrentDevice = deviceId === currentDeviceId;
    rows += `
      <tr style="border-bottom: 1px solid var(--b3-border-color, #eee);">
        <td style="padding: 10px 12px;">
          ${data.deviceName}
          ${isCurrentDevice ? '<span style="background: var(--b3-theme-primary); color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 8px;">Current</span>' : ''}
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

function createHistoryTable(records: SyncHistoryRecord[]): string {
  if (records.length === 0) {
    return `<div style="padding: 20px; text-align: center; opacity: 0.6;">No sync history yet</div>`;
  }

  let rows = '';
  for (const record of records) {
    const statusIcon = record.success ? '✅' : (record.skippedReason ? '⏸️' : '❌');
    const statusColor = record.success ? 'var(--b3-card-success-color, green)' : (record.skippedReason ? 'var(--b3-card-warning-color, orange)' : 'var(--b3-card-error-color, red)');

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

function createDetailedHistoryTable(records: SyncHistoryRecord[]): string {
  if (records.length === 0) {
    return `<div style="padding: 40px; text-align: center; opacity: 0.6;">No sync history yet</div>`;
  }

  let rows = '';
  for (const record of records) {
    const statusIcon = record.success ? '✅' : (record.skippedReason ? '⏸️' : '❌');
    const triggerBadge = record.triggerType === 'auto' ? '🤖' : (record.triggerType === 'force' ? '⚠️' : '👆');

    const statusDetail = record.success
      ? `Uploaded ${record.docsUploaded} docs, ${record.assetsUploaded} assets`
      : (record.skippedReason || record.errorMessage || 'Unknown error');

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
          <span>📄 Scanned: ${record.docsScanned} | Changed: ${record.docsChanged} | Uploaded: ${record.docsUploaded}</span>
          <span>🖼️ Scanned: ${record.assetsScanned} | Changed: ${record.assetsChanged} | Uploaded: ${record.assetsUploaded}</span>
          <span>⏱️ ${formatDuration(record.duration)}</span>
        </div>
      </div>
    `;
  }

  return rows;
}
