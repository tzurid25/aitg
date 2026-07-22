import fs from "node:fs/promises";
import { CREDENTIALS_DIR, CREDENTIALS_FILE } from "./constants.js";
import { CliError } from "./logger.js";

export interface StoredCredentials {
  /** Hashed on the server; this is the raw secret, scoped to this CLI installation. */
  apiKey: string;
  organizationSlug: string;
  organizationId: string;
  userEmail: string;
  createdAt: string;
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  await fs.mkdir(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    mode: 0o600, // owner read/write only — this file holds a live API key
  });
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const raw = await fs.readFile(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(raw) as StoredCredentials;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function requireCredentials(): Promise<StoredCredentials> {
  const creds = await loadCredentials();
  if (!creds) {
    throw new CliError(
      "Not logged in.",
      "Run `aitg login` first.",
    );
  }
  return creds;
}

export async function clearCredentials(): Promise<void> {
  await fs.rm(CREDENTIALS_FILE, { force: true });
}
