/**
 * Device Manager Module
 *
 * 管理设备标识，使用 localStorage 存储（不会被 SiYuan 同步）
 * 确保每个设备/客户端有唯一的标识符
 *
 * v0.4.4: 添加 Tab 会话标识，区分同一浏览器的不同标签页
 */

import { logInfo, logError } from "./logger";

// ============================================================================
// Constants
// ============================================================================

// localStorage keys (浏览器级别，所有Tab共享)
const STORAGE_KEY_DEVICE_ID = "lifeos-sync-device-id";
const STORAGE_KEY_DEVICE_NAME = "lifeos-sync-device-name";
const STORAGE_KEY_DEVICE_CREATED = "lifeos-sync-device-created";

// sessionStorage keys (Tab级别，每个Tab独立)
const SESSION_KEY_TAB_ID = "lifeos-sync-tab-id";
const SESSION_KEY_TAB_NAME = "lifeos-sync-tab-name";
const SESSION_KEY_TAB_CREATED = "lifeos-sync-tab-created";

// Tab ID 计数器 (用于生成简短的 Tab 编号)
const STORAGE_KEY_TAB_COUNTER = "lifeos-sync-tab-counter";

// ============================================================================
// Types
// ============================================================================

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  createdAt: number;
}

export interface TabInfo {
  tabId: string;
  tabName: string;
  tabNumber: number;
  createdAt: number;
}

export interface FullIdentity {
  device: DeviceInfo;
  tab: TabInfo;
  displayName: string;      // 完整显示名称，如 "Browser-192.168.1.1 #3"
  uniqueId: string;         // 完整唯一ID，用于锁文件: "{deviceId}-tab-{tabId}"
}

// ============================================================================
// Device ID Management
// ============================================================================

/**
 * 生成新的设备 ID (UUID v4)
 */
function generateDeviceId(): string {
  // 使用 crypto.randomUUID() 如果可用（现代浏览器都支持）
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback: 手动生成 UUID v4
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 基于环境特征猜测默认设备名称
 */
function guessDefaultDeviceName(): string {
  try {
    const ua = navigator.userAgent.toLowerCase();

    // 检测 Electron (SiYuan Desktop)
    if (ua.includes("electron")) {
      // 尝试检测操作系统
      if (ua.includes("windows")) return "Desktop-Windows";
      if (ua.includes("mac")) return "Desktop-Mac";
      if (ua.includes("linux")) return "Desktop-Linux";
      return "Desktop";
    }

    // 检测移动设备
    if (ua.includes("android")) return "Android";
    if (ua.includes("iphone")) return "iPhone";
    if (ua.includes("ipad")) return "iPad";

    // 检测 Docker/服务器环境（通常通过非 localhost 的 hostname 访问）
    const hostname = window.location.hostname;
    if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
      // 如果是 IP 地址或域名，可能是 Docker 或远程服务器
      if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        return `Browser-${hostname}`;
      }
      return `Browser-${hostname.split(".")[0]}`;
    }

    // localhost 访问
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "Localhost-Browser";
    }

    return "Unknown-Device";
  } catch (e) {
    return "Unknown-Device";
  }
}

/**
 * 获取设备 ID（如果不存在则创建）
 * 使用 localStorage 存储，确保不会被 SiYuan 同步
 */
export function getDeviceId(): string {
  try {
    let deviceId = localStorage.getItem(STORAGE_KEY_DEVICE_ID);

    if (!deviceId) {
      // 首次运行：生成新的 device ID
      deviceId = generateDeviceId();
      localStorage.setItem(STORAGE_KEY_DEVICE_ID, deviceId);
      localStorage.setItem(STORAGE_KEY_DEVICE_CREATED, Date.now().toString());

      // 同时设置默认设备名称
      if (!localStorage.getItem(STORAGE_KEY_DEVICE_NAME)) {
        const defaultName = guessDefaultDeviceName();
        localStorage.setItem(STORAGE_KEY_DEVICE_NAME, defaultName);
      }

      console.log(`[DeviceManager] Generated new device ID: ${deviceId}`);
    }

    return deviceId;
  } catch (e) {
    // localStorage 不可用（极少数情况）
    console.error("[DeviceManager] localStorage not available, using session ID");
    // 返回一个临时 ID（每次会话都不同）
    return `temp-${generateDeviceId()}`;
  }
}

/**
 * 获取设备名称
 */
export function getDeviceName(): string {
  try {
    const name = localStorage.getItem(STORAGE_KEY_DEVICE_NAME);
    if (name) {
      return name;
    }

    // 如果没有设置名称，生成默认名称并保存
    const defaultName = guessDefaultDeviceName();
    localStorage.setItem(STORAGE_KEY_DEVICE_NAME, defaultName);
    return defaultName;
  } catch (e) {
    return "Unknown-Device";
  }
}

/**
 * 设置设备名称
 */
export function setDeviceName(name: string): void {
  try {
    const trimmedName = name.trim();
    if (trimmedName) {
      localStorage.setItem(STORAGE_KEY_DEVICE_NAME, trimmedName);
      console.log(`[DeviceManager] Device name set to: ${trimmedName}`);
    }
  } catch (e) {
    console.error("[DeviceManager] Failed to set device name:", e);
  }
}

/**
 * 获取完整的设备信息
 */
export function getDeviceInfo(): DeviceInfo {
  const deviceId = getDeviceId();
  const deviceName = getDeviceName();

  let createdAt = 0;
  try {
    const createdStr = localStorage.getItem(STORAGE_KEY_DEVICE_CREATED);
    if (createdStr) {
      createdAt = parseInt(createdStr, 10);
    }
  } catch (e) {
    // ignore
  }

  return {
    deviceId,
    deviceName,
    createdAt
  };
}

/**
 * 重新生成设备 ID（用于用户手动重置）
 */
export function regenerateDeviceId(): string {
  try {
    const newId = generateDeviceId();
    localStorage.setItem(STORAGE_KEY_DEVICE_ID, newId);
    localStorage.setItem(STORAGE_KEY_DEVICE_CREATED, Date.now().toString());
    console.log(`[DeviceManager] Regenerated device ID: ${newId}`);
    return newId;
  } catch (e) {
    console.error("[DeviceManager] Failed to regenerate device ID:", e);
    return getDeviceId();
  }
}

/**
 * 获取设备 ID 的短格式（用于显示）
 */
export function getShortDeviceId(): string {
  const fullId = getDeviceId();
  // 返回前 8 位
  return fullId.substring(0, 8);
}

/**
 * 格式化设备信息用于显示
 */
export function formatDeviceDisplay(): string {
  const name = getDeviceName();
  const shortId = getShortDeviceId();
  return `${name} (${shortId})`;
}

// ============================================================================
// Tab Session Management (v0.4.4)
// ============================================================================

/**
 * 获取下一个 Tab 编号（全局递增）
 * 使用 localStorage 存储计数器，确保同一浏览器的不同 Tab 获得不同编号
 */
function getNextTabNumber(): number {
  try {
    const currentStr = localStorage.getItem(STORAGE_KEY_TAB_COUNTER);
    const current = currentStr ? parseInt(currentStr, 10) : 0;
    const next = current + 1;
    localStorage.setItem(STORAGE_KEY_TAB_COUNTER, next.toString());
    return next;
  } catch (e) {
    // 如果 localStorage 不可用，使用随机数
    return Math.floor(Math.random() * 1000) + 1;
  }
}

/**
 * 生成短 Tab ID (8 字符)
 */
function generateShortTabId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 获取当前 Tab 的 ID（如果不存在则创建）
 * 使用 sessionStorage 存储，每个 Tab 独立
 */
export function getTabId(): string {
  try {
    let tabId = sessionStorage.getItem(SESSION_KEY_TAB_ID);

    if (!tabId) {
      // 首次访问此 Tab：生成新的 tab ID
      tabId = generateShortTabId();
      sessionStorage.setItem(SESSION_KEY_TAB_ID, tabId);
      sessionStorage.setItem(SESSION_KEY_TAB_CREATED, Date.now().toString());

      // 获取并存储 Tab 编号
      const tabNumber = getNextTabNumber();
      sessionStorage.setItem(SESSION_KEY_TAB_NAME, `#${tabNumber}`);

      console.log(`[DeviceManager] New tab session: #${tabNumber} (${tabId})`);
    }

    return tabId;
  } catch (e) {
    // sessionStorage 不可用
    console.error("[DeviceManager] sessionStorage not available");
    return `temp-${generateShortTabId()}`;
  }
}

/**
 * 获取当前 Tab 的编号
 */
export function getTabNumber(): number {
  try {
    const tabName = sessionStorage.getItem(SESSION_KEY_TAB_NAME);
    if (tabName && tabName.startsWith("#")) {
      return parseInt(tabName.substring(1), 10) || 0;
    }
    // 如果没有编号，创建一个
    getTabId(); // 确保 Tab 已初始化
    const newTabName = sessionStorage.getItem(SESSION_KEY_TAB_NAME);
    if (newTabName && newTabName.startsWith("#")) {
      return parseInt(newTabName.substring(1), 10) || 0;
    }
    return 0;
  } catch (e) {
    return 0;
  }
}

/**
 * 获取 Tab 名称（默认为 #编号）
 */
export function getTabName(): string {
  try {
    const name = sessionStorage.getItem(SESSION_KEY_TAB_NAME);
    if (name) {
      return name;
    }
    // 确保 Tab 已初始化
    getTabId();
    return sessionStorage.getItem(SESSION_KEY_TAB_NAME) || "#?";
  } catch (e) {
    return "#?";
  }
}

/**
 * 设置自定义 Tab 名称
 */
export function setTabName(name: string): void {
  try {
    const trimmedName = name.trim();
    if (trimmedName) {
      sessionStorage.setItem(SESSION_KEY_TAB_NAME, trimmedName);
      console.log(`[DeviceManager] Tab name set to: ${trimmedName}`);
    }
  } catch (e) {
    console.error("[DeviceManager] Failed to set tab name:", e);
  }
}

/**
 * 获取完整的 Tab 信息
 */
export function getTabInfo(): TabInfo {
  const tabId = getTabId();
  const tabName = getTabName();
  const tabNumber = getTabNumber();

  let createdAt = 0;
  try {
    const createdStr = sessionStorage.getItem(SESSION_KEY_TAB_CREATED);
    if (createdStr) {
      createdAt = parseInt(createdStr, 10);
    }
  } catch (e) {
    // ignore
  }

  return {
    tabId,
    tabName,
    tabNumber,
    createdAt
  };
}

/**
 * 获取完整身份信息（设备 + Tab）
 * 用于在多 Tab 环境中唯一标识每个会话
 */
export function getFullIdentity(): FullIdentity {
  const device = getDeviceInfo();
  const tab = getTabInfo();

  // 显示名称：设备名 + Tab编号（如果在浏览器环境）
  const isElectron = typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("electron");

  // Electron 桌面版不需要显示 Tab 编号
  const displayName = isElectron
    ? device.deviceName
    : `${device.deviceName} ${tab.tabName}`;

  // 唯一 ID：用于锁文件等需要唯一标识的场景
  const uniqueId = `${device.deviceId}-tab-${tab.tabId}`;

  return {
    device,
    tab,
    displayName,
    uniqueId
  };
}

/**
 * 格式化完整身份用于显示（包含短 ID）
 */
export function formatFullIdentityDisplay(): string {
  const identity = getFullIdentity();
  const shortDeviceId = identity.device.deviceId.substring(0, 8);
  return `${identity.displayName} (${shortDeviceId})`;
}

/**
 * 检查是否在浏览器环境（非 Electron）
 */
export function isBrowserEnvironment(): boolean {
  try {
    const ua = navigator.userAgent.toLowerCase();
    return !ua.includes("electron");
  } catch (e) {
    return false;
  }
}

/**
 * 初始化设备管理器（插件加载时调用）
 */
export async function initDeviceManager(): Promise<void> {
  const device = getDeviceInfo();
  const tab = getTabInfo();
  const identity = getFullIdentity();

  await logInfo(`[DeviceManager] Initialized: ${identity.displayName} (device: ${device.deviceId.substring(0, 8)}..., tab: ${tab.tabId})`);
}
