import { LOG_FILE_PATH } from "./constants";
import { putFile, readTextFile } from "./siyuan-api";

let enabled = false;

export function initLogger(): void {
  enabled = true;
}

function formatLine(level: string, message: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level}] ${message}
`;
}

async function appendLog(level: string, message: string): Promise<void> {
  if (!enabled) {
    return;
  }
  try {
    const existing = await readTextFile(LOG_FILE_PATH);
    const next = existing + formatLine(level, message);
    await putFile(LOG_FILE_PATH, new Blob([next], { type: "text/plain" }));
  } catch (err) {
    console.warn("lifeos_sync log append failed", err);
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
