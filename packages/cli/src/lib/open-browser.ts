import { exec } from "node:child_process";

/** Best-effort browser open. Never throws — falls back to the caller printing the URL. */
export function tryOpenBrowser(url: string): void {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? `open "${url}"`
      : platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;

  exec(command, (err) => {
    // Silently ignored — headless CI environments won't have a browser,
    // and the calling command always prints the URL as a fallback.
    void err;
  });
}
