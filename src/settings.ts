import type { Plugin } from "siyuan";

import {
  DEFAULT_ASSETS_DIR,
  DEFAULT_EXPORT_ALL_ASSETS,
  DEFAULT_EXPORT_ROOT,
  SETTINGS_FILE,
} from "./constants";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  repoUrl: "",
  branch: "main",
  token: "",
  exportRoot: DEFAULT_EXPORT_ROOT,
  assetsDir: DEFAULT_ASSETS_DIR,
  cleanFrontmatter: true,
  exportAllAssets: DEFAULT_EXPORT_ALL_ASSETS,
  ignoreNotebooks: [],
  ignorePaths: [],
  ignoreTags: [],
  autoSync: {
    enabled: false,              // 默认禁用自动同步
    interval: 30,                // 默认30分钟
    syncDocs: true,              // 同步文档
    syncAssets: true,            // 同步资源
    onlyWhenIdle: false,         // 不限制空闲时
    maxConcurrency: 5            // 最大并发数
  },
  syncLock: {
    enabled: true,               // 默认启用分布式锁
    lockTtl: 10 * 60 * 1000,     // 10 分钟
    firstCheckThreshold: 10 * 60 * 1000,  // 10 分钟
    secondCheckThreshold: 5 * 60 * 1000,  // 5 分钟
    jitterRange: 15 * 1000       // 15 秒
  }
};

export async function loadSettings(plugin: Plugin): Promise<Settings> {
  const data = (await plugin.loadData(SETTINGS_FILE)) as Partial<Settings> | null;

  // 深度合并设置，确保嵌套对象（autoSync, syncLock）正确合并
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...(data ?? {}),
    autoSync: {
      ...DEFAULT_SETTINGS.autoSync,
      ...(data?.autoSync ?? {})
    },
    syncLock: {
      ...DEFAULT_SETTINGS.syncLock,
      ...(data?.syncLock ?? {})
    }
  };

  return settings;
}

export async function saveSettings(plugin: Plugin, settings: Settings): Promise<void> {
  await plugin.saveData(SETTINGS_FILE, settings);
}
