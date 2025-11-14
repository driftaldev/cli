/**
 * Driftal Configuration Manager
 * Manages user configuration stored in ~/.driftal/config.json
 * Including model preferences and other user settings
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

const DRIFTAL_DIR = path.join(os.homedir(), '.driftal');
const CONFIG_FILE = path.join(DRIFTAL_DIR, 'config.json');

export interface DriftalConfig {
  primaryModel?: string;
  fallbackModel?: string;
  lastUpdated?: string;
}

const DEFAULT_CONFIG: DriftalConfig = {
  primaryModel: 'claude-3-5-sonnet-20241022',
  fallbackModel: undefined,
};

/**
 * Ensure ~/.driftal directory exists
 */
function ensureDriftalDir(): void {
  try {
    if (!fs.existsSync(DRIFTAL_DIR)) {
      fs.mkdirSync(DRIFTAL_DIR, { recursive: true, mode: 0o700 });
      logger.debug('Created ~/.driftal directory');
    }
  } catch (error) {
    logger.error('Failed to create ~/.driftal directory', { error });
    throw new Error('Failed to create configuration directory');
  }
}

/**
 * Load configuration from ~/.driftal/config.json
 */
export function loadConfig(): DriftalConfig {
  try {
    ensureDriftalDir();

    if (!fs.existsSync(CONFIG_FILE)) {
      logger.debug('Config file does not exist, using defaults');
      return { ...DEFAULT_CONFIG };
    }

    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data) as DriftalConfig;

    logger.debug('Loaded config from ~/.driftal/config.json', {
      primaryModel: config.primaryModel
    });

    return { ...DEFAULT_CONFIG, ...config };
  } catch (error) {
    logger.warn('Failed to load config, using defaults', { error });
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save configuration to ~/.driftal/config.json
 */
export function saveConfig(config: DriftalConfig): void {
  try {
    ensureDriftalDir();

    const configToSave: DriftalConfig = {
      ...config,
      lastUpdated: new Date().toISOString(),
    };

    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(configToSave, null, 2),
      { mode: 0o600 }
    );

    logger.debug('Saved config to ~/.driftal/config.json', {
      primaryModel: config.primaryModel
    });
  } catch (error) {
    logger.error('Failed to save config', { error });
    throw new Error('Failed to save configuration');
  }
}

/**
 * Get the primary model from config
 */
export function getPrimaryModel(): string {
  const config = loadConfig();
  return config.primaryModel || DEFAULT_CONFIG.primaryModel!;
}

/**
 * Get the fallback model from config
 */
export function getFallbackModel(): string | undefined {
  const config = loadConfig();
  return config.fallbackModel;
}

/**
 * Set model preferences in config
 */
export function setModelPreferences(
  primaryModel: string,
  fallbackModel?: string
): void {
  const config = loadConfig();
  config.primaryModel = primaryModel;
  config.fallbackModel = fallbackModel;
  saveConfig(config);

  logger.info('Model preferences updated', { primaryModel, fallbackModel });
}

/**
 * Reset config to defaults
 */
export function resetConfig(): void {
  try {
    ensureDriftalDir();

    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
      logger.info('Config reset to defaults');
    }
  } catch (error) {
    logger.error('Failed to reset config', { error });
    throw new Error('Failed to reset configuration');
  }
}

/**
 * Get the config file path (for display purposes)
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}
