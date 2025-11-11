import fs from "fs/promises";
import path from "path";
import { logger } from "../utils/logger.js";
import { ensureDriftalInGitignore } from "./gitignore-manager.js";

const METADATA_FILENAME = "config.json";

type ScoutMetadata = Record<string, unknown>;

export class RepoNameNotConfiguredError extends Error {
  readonly metadataPath: string;

  constructor(repoRoot: string) {
    const metadataPath = getMetadataPath(repoRoot);
    super(
      `Repository name is not configured. Run "scout-code index" in an interactive shell to set it up, or manually set "repoName" in ${metadataPath}.`
    );

    this.name = "RepoNameNotConfiguredError";
    this.metadataPath = metadataPath;
  }
}

function getMetadataPath(repoRoot: string): string {
  const resolvedRoot = path.resolve(repoRoot);
  return path.join(resolvedRoot, ".driftal", METADATA_FILENAME);
}

async function readMetadata(repoRoot: string): Promise<ScoutMetadata> {
  const metadataPath = getMetadataPath(repoRoot);
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Scout metadata must be a JSON object");
    }
    return parsed as ScoutMetadata;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeMetadata(
  repoRoot: string,
  metadata: ScoutMetadata
): Promise<void> {
  const metadataPath = getMetadataPath(repoRoot);
  // Ensure .driftal is in .gitignore before creating the folder
  await ensureDriftalInGitignore(repoRoot);
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
}

async function updateMetadata(
  repoRoot: string,
  updater: (current: ScoutMetadata) => ScoutMetadata
): Promise<ScoutMetadata> {
  const current = await readMetadata(repoRoot);
  const next = updater({ ...current });
  if (!next || typeof next !== "object" || Array.isArray(next)) {
    throw new Error("Scout metadata updater must return a JSON object");
  }
  const updated = {
    ...next,
    updatedAt: new Date().toISOString()
  } satisfies ScoutMetadata;
  await writeMetadata(repoRoot, updated);
  return updated;
}

export async function loadSavedRepoName(
  repoRoot: string
): Promise<string | undefined> {
  const metadata = await readMetadata(repoRoot);
  const repoName = metadata.repoName;
  return typeof repoName === "string" && repoName.trim() ? repoName : undefined;
}

export async function requireRepoName(repoRoot: string): Promise<string> {
  const repoName = await loadSavedRepoName(repoRoot);
  if (!repoName) {
    throw new RepoNameNotConfiguredError(repoRoot);
  }
  return repoName;
}

export async function saveRepoName(
  repoRoot: string,
  repoName: string
): Promise<void> {
  await updateMetadata(repoRoot, (current) => ({
    ...current,
    repoName,
    repoNameUpdatedAt: new Date().toISOString()
  }));
}
