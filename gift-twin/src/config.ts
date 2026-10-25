/** Companion state on the recipient's Mac: ~/.unwrap-gift-twin (0700), files 0600. */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TwinConfig {
  convexUrl: string;
  deviceToken: string;
  collaboratorId: string;
  recipientName: string;
  occasion: string;
  pairedAt: number;
  lastSharedAt?: number;
}

export function twinHome(): string {
  return process.env.GIFT_TWIN_HOME ?? join(homedir(), ".unwrap-gift-twin");
}

function ensureHome(): string {
  const dir = twinHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function writePrivate(file: string, data: unknown) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function loadConfig(): TwinConfig | null {
  const file = join(twinHome(), "config.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as TwinConfig;
}

export function saveConfig(config: TwinConfig) {
  writePrivate(join(ensureHome(), "config.json"), config);
}

export function clearState() {
  rmSync(twinHome(), { recursive: true, force: true });
}
