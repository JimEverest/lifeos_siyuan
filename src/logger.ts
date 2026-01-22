import { LOG_FILE_PATH } from "./constants";
import { putFile } from "./siyuan-api";

let enabled = false;
let logBuffer: string[] = [];

// 日志轮转设置：只保留最近N行，防止文件无限增长
const MAX_LOG_LINES = 1000;

export function initLogger(): void {
  enabled = true;
  logBuffer = []; // 重置缓冲区
}

function formatLine(level: string, message: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level}] ${message}\n`;
}

/**
 * Flush logs to file (OVERWRITE mode, no append)
 *
 * 优化说明：
 * - 不再读取旧日志文件（避免读取几十MB文件的开销）
 * - 使用覆盖模式而不是追加模式
 * - 只保留最近MAX_LOG_LINES行日志（日志轮转）
 * - 只在sync结束时调用一次，而不是每5秒或100条就调用
 */
async function flushLogs(): Promise<void> {
  if (logBuffer.length === 0) {
    return;
  }

  try {
    // 日志轮转：只保留最近MAX_LOG_LINES行
    const lines = logBuffer.slice(-MAX_LOG_LINES);
    const content = lines.join("");

    // 覆盖写入（不读取旧文件）
    await putFile(LOG_FILE_PATH, new Blob([content], { type: "text/plain" }));

    // 清空缓冲区
    logBuffer = [];
  } catch (err) {
    console.warn("lifeos_sync log flush failed", err);
  }
}

async function appendLog(level: string, message: string): Promise<void> {
  if (!enabled) {
    return;
  }

  logBuffer.push(formatLine(level, message));

  // 不再自动flush，只在内存中累积
  // flush将在sync结束时统一调用
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
 * 强制flush所有待写入的日志（覆盖模式）
 * 应该在sync结束时调用
 */
export async function flushAllLogs(): Promise<void> {
  await flushLogs();
}
