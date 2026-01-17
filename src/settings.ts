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
};

export async function loadSettings(plugin: Plugin): Promise<Settings> {
  const data = (await plugin.loadData(SETTINGS_FILE)) as Partial<Settings> | null;
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
}

export async function saveSettings(plugin: Plugin, settings: Settings): Promise<void> {
  await plugin.saveData(SETTINGS_FILE, settings);
}
