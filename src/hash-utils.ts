/**
 * Hash utilities for browser environment
 * Provides fallback for environments where crypto.subtle is not available
 */

/**
 * Simple hash function for strings (FNV-1a hash)
 * This is a fallback for environments without crypto.subtle
 */
function simpleHash(str: string): string {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  // Convert to hex string
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Simple hash function for ArrayBuffer (FNV-1a hash)
 */
function simpleHashBuffer(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < view.length; i++) {
    hash ^= view[i];
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  // Convert to hex string
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Calculate hash for text content with crypto.subtle when available,
 * fallback to simple hash otherwise
 */
export async function calculateHash(text: string): Promise<string> {
  // Check if crypto.subtle is available (HTTPS or localhost)
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      // Fall through to simple hash
      console.warn("[Hash] crypto.subtle failed, using fallback:", e);
    }
  }

  // Fallback to simple hash
  return simpleHash(text);
}

/**
 * Calculate hash for binary content with crypto.subtle when available,
 * fallback to simple hash otherwise
 */
export async function calculateFileHash(content: ArrayBuffer): Promise<string> {
  // Check if crypto.subtle is available (HTTPS or localhost)
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const hashBuffer = await crypto.subtle.digest("SHA-256", content);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      // Fall through to simple hash
      console.warn("[Hash] crypto.subtle failed, using fallback:", e);
    }
  }

  // Fallback to simple hash
  return simpleHashBuffer(content);
}

/**
 * Calculate MD5-like hash for shard calculation
 * Uses simple hash as fallback
 */
export async function calculateShardHash(text: string): Promise<string> {
  return calculateHash(text);
}
