import os from "node:os";
import path from "node:path";

/** Overridable via AITG_API_URL for local dev against apps/api. */
export const API_BASE_URL = process.env.AITG_API_URL ?? "https://api.aitg.dev";

export const DASHBOARD_URL = process.env.AITG_DASHBOARD_URL ?? "https://app.aitg.dev";

/** Per-user credentials, NOT per-project — one login covers every repo on this machine. */
export const CREDENTIALS_DIR = path.join(os.homedir(), ".aitg");
export const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, "credentials.json");

/** Per-repo project config, committed to the repo so the whole team shares it. */
export const PROJECT_CONFIG_FILE = "aitg.config.json";

/** Per-repo local scan output, gitignored — never committed (may contain source snippets). */
export const LOCAL_OUTPUT_DIR = ".test-guard";

export const PACKAGE_NAME = "@aitg/cli";
