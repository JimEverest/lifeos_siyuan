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
  }
};

export async function loadSettings(plugin: Plugin): Promise<Settings> {
  const data = (await plugin.loadData(SETTINGS_FILE)) as Partial<Settings> | null;
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
}

export async function saveSettings(plugin: Plugin, settings: Settings): Promise<void> {
  await plugin.saveData(SETTINGS_FILE, settings);
}
