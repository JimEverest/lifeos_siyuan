import { LOG_FILE_PATH } from "./constants";
import { putFile, readTextFile } from "./siyuan-api";

let enabled = false;
let logBuffer: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_INTERVAL_MS = 5000; // 每5秒flush一次
const MAX_BUFFER_SIZE = 100; // 或者缓冲区达到100条时立即flush

export function initLogger(): void {
  enabled = true;
}

function formatLine(level: string, message: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level}] ${message}\n`;
}

async function flushLogs(): Promise<void> {
  if (logBuffer.length === 0) {
    return;
  }

  try {
    const toFlush = logBuffer.join("");
    logBuffer = []; // 清空缓冲区

    const existing = await readTextFile(LOG_FILE_PATH);
    const next = existing + toFlush;
    await putFile(LOG_FILE_PATH, new Blob([next], { type: "text/plain" }));
  } catch (err) {
    console.warn("lifeos_sync log flush failed", err);
  }
}

function scheduleFlush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
  }

  flushTimer = setTimeout(() => {
    void flushLogs();
    flushTimer = null;
  }, FLUSH_INTERVAL_MS);
}

async function appendLog(level: string, message: string): Promise<void> {
  if (!enabled) {
    return;
  }

  logBuffer.push(formatLine(level, message));

  // 如果缓冲区过大，立即flush
  if (logBuffer.length >= MAX_BUFFER_SIZE) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushLogs();
  } else {
    // 否则延迟flush
    scheduleFlush();
  }
}

export async function logInfo(message: string): Promise<void> {
  console.info(`lifeos_sync: ${message}`);
  await appendLog("INFO", message);
}

export async function logError(message: string, err?: unknown): Promise<void> {
  console.error(`lifeos_sync: ${message}`, err);
  const detail = err instanceof Error ? `${message} :: ${err.message}` : message;
  await appendLog("ERROR", detail);
}

/**
 * 强制flush所有待写入的日志
 */
export async function flushAllLogs(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushLogs();
}
