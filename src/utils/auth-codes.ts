/**
 * Local Auth Code Manager
 * Manages OAuth authorization codes stored in ~/.driftal/auth_codes.json
 * Replaces database storage for CLI authentication flow
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { logger } from "./logger.js";

const DRIFTAL_DIR = path.join(os.homedir(), ".driftal");
const AUTH_CODES_FILE = path.join(DRIFTAL_DIR, "auth_codes.json");
const DEFAULT_EXPIRY_MINUTES = 10;

export interface AuthCode {
  code: string;
  userId: string;
  state: string;
  expiresAt: string;
  used: boolean;
  usedAt?: string;
  createdAt: string;
}

interface AuthCodeStore {
  codes: AuthCode[];
  lastCleanup?: string;
}

/**
 * Ensure ~/.driftal directory exists
 */
function ensureDriftalDir(): void {
  try {
    if (!fs.existsSync(DRIFTAL_DIR)) {
      fs.mkdirSync(DRIFTAL_DIR, { recursive: true, mode: 0o700 });
      logger.debug("Created ~/.driftal directory");
    }
  } catch (error) {
    logger.error("Failed to create ~/.driftal directory", { error });
    throw new Error("Failed to create auth codes directory");
  }
}

/**
 * Load auth codes from file
 */
function loadAuthCodes(): AuthCodeStore {
  try {
    ensureDriftalDir();

    if (!fs.existsSync(AUTH_CODES_FILE)) {
      return { codes: [] };
    }

    const data = fs.readFileSync(AUTH_CODES_FILE, "utf-8");
    return JSON.parse(data) as AuthCodeStore;
  } catch (error) {
    logger.warn("Failed to load auth codes, returning empty store", { error });
    return { codes: [] };
  }
}

/**
 * Save auth codes to file
 */
function saveAuthCodes(store: AuthCodeStore): void {
  try {
    ensureDriftalDir();

    fs.writeFileSync(AUTH_CODES_FILE, JSON.stringify(store, null, 2), {
      mode: 0o600,
    });

    logger.debug("Saved auth codes to ~/.driftal/auth_codes.json");
  } catch (error) {
    logger.error("Failed to save auth codes", { error });
    throw new Error("Failed to save auth codes");
  }
}

/**
 * Generate a random authorization code
 */
export function generateAuthCode(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Create and store a new authorization code
 */
export function createAuthorizationCode(
  userId: string,
  state: string,
  expiryMinutes: number = DEFAULT_EXPIRY_MINUTES
): string {
  const code = generateAuthCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);

  const authCode: AuthCode = {
    code,
    userId,
    state,
    expiresAt: expiresAt.toISOString(),
    used: false,
    createdAt: now.toISOString(),
  };

  const store = loadAuthCodes();
  store.codes.push(authCode);
  saveAuthCodes(store);

  logger.info("Authorization code created", {
    userId,
    state,
    expiresAt: expiresAt.toISOString(),
  });

  // Cleanup old codes while we're here
  cleanupExpiredAuthCodes();

  return code;
}

/**
 * Validate and consume an authorization code
 */
export function validateAuthorizationCode(code: string): {
  userId: string;
  state: string;
} {
  const store = loadAuthCodes();
  const authCode = store.codes.find((ac) => ac.code === code);

  if (!authCode) {
    logger.warn("Invalid authorization code", {
      code: code.substring(0, 8) + "...",
    });
    throw new Error("Invalid authorization code");
  }

  // Check if already used
  if (authCode.used) {
    logger.warn("Authorization code already used", {
      code: code.substring(0, 8) + "...",
    });
    throw new Error("Authorization code has already been used");
  }

  // Check if expired
  const now = new Date();
  const expiresAt = new Date(authCode.expiresAt);
  if (expiresAt < now) {
    logger.warn("Authorization code expired", {
      code: code.substring(0, 8) + "...",
    });
    throw new Error("Authorization code has expired");
  }

  // Mark as used
  authCode.used = true;
  authCode.usedAt = now.toISOString();
  saveAuthCodes(store);

  logger.info("Authorization code validated", { userId: authCode.userId });

  return {
    userId: authCode.userId,
    state: authCode.state,
  };
}

/**
 * Clean up expired auth codes (older than 1 hour)
 */
export function cleanupExpiredAuthCodes(): void {
  try {
    const store = loadAuthCodes();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const originalCount = store.codes.length;
    store.codes = store.codes.filter((authCode) => {
      const expiresAt = new Date(authCode.expiresAt);
      return expiresAt > oneHourAgo;
    });

    const removedCount = originalCount - store.codes.length;

    if (removedCount > 0) {
      store.lastCleanup = new Date().toISOString();
      saveAuthCodes(store);
      logger.info("Expired auth codes cleaned up", { removedCount });
    }
  } catch (error) {
    logger.error("Error cleaning up expired auth codes", { error });
  }
}

/**
 * Get auth code by state (for CLI callback handling)
 */
export function getAuthCodeByState(state: string): AuthCode | undefined {
  const store = loadAuthCodes();
  return store.codes.find((ac) => ac.state === state && !ac.used);
}

/**
 * Clear all auth codes (for logout/cleanup)
 */
export function clearAllAuthCodes(): void {
  try {
    if (fs.existsSync(AUTH_CODES_FILE)) {
      fs.unlinkSync(AUTH_CODES_FILE);
      logger.info("All auth codes cleared");
    }
  } catch (error) {
    logger.error("Failed to clear auth codes", { error });
  }
}

/**
 * Get the auth codes file path (for display purposes)
 */
export function getAuthCodesPath(): string {
  return AUTH_CODES_FILE;
}
