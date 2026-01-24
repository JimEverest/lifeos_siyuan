/**
 * Device Manager Module
 *
 * 管理设备标识，使用 localStorage 存储（不会被 SiYuan 同步）
 * 确保每个设备/客户端有唯一的标识符
 */

import { logInfo, logError } from "./logger";

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY_DEVICE_ID = "lifeos-sync-device-id";
const STORAGE_KEY_DEVICE_NAME = "lifeos-sync-device-name";
const STORAGE_KEY_DEVICE_CREATED = "lifeos-sync-device-created";

// ============================================================================
// Types
// ============================================================================

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  createdAt: number;
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

/**
 * 初始化设备管理器（插件加载时调用）
 */
export async function initDeviceManager(): Promise<void> {
  const info = getDeviceInfo();
  await logInfo(`[DeviceManager] Device initialized: ${info.deviceName} (${info.deviceId.substring(0, 8)}...)`);
}
