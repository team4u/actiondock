import { homedir } from "node:os";
import { join } from "node:path";
import { SqliteRuntimeStorage } from "./sqlite";
import type { RuntimeStorage, StorageOptions } from "./types";

export * from "./sqlite";
export * from "./types";

export function resolveDatabasePath(
  packageId: string,
  options: { projectRoot?: string; dataDir?: string; inMemory?: boolean } = {}
): string {
  if (options.inMemory) {
    return ":memory:";
  }
  if (options.dataDir) {
    return join(options.dataDir, packageId, "runtime.db");
  }
  if (options.projectRoot) {
    return join(options.projectRoot, ".actiondock", "runtime.db");
  }
  // Default standalone path: ~/.actiondock/data/<package-id>/runtime.db
  return join(homedir(), ".actiondock", "data", packageId, "runtime.db");
}

export function createStorage(
  packageId: string,
  options: { projectRoot?: string; dataDir?: string; inMemory?: boolean } = {}
): RuntimeStorage {
  const dbPath = resolveDatabasePath(packageId, options);
  return new SqliteRuntimeStorage({ dbPath, packageId });
}

export function createGlobalStorage(customHome?: string): RuntimeStorage {
  const baseDir = customHome || process.env.ACTIONDOCK_HOME || homedir();
  const dbPath = join(baseDir, ".actiondock", "global.db");
  return new SqliteRuntimeStorage({ dbPath, packageId: "__global__" });
}

