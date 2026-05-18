import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "..");
const runtimeDir = resolve(packageDir, "runtime");

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: buildEnvironment(),
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function buildEnvironment() {
  const env = { ...process.env };

  delete env.npm_config_dry_run;
  delete env.npm_config_package_lock_only;

  return env;
}

rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(runtimeDir, { recursive: true });

run("mvn", [
  "-pl",
  "actiondock-app-spring",
  "-am",
  "package",
  "-DskipTests",
  "-f",
  resolve(repoRoot, "pom.xml"),
]);

const sourceJar = resolve(
  repoRoot,
  "actiondock-app-spring",
  "target",
  "actiondock-app-spring.jar",
);
const targetJar = resolve(runtimeDir, "actiondock-app-spring.jar");

if (!existsSync(sourceJar)) {
  throw new Error(`Runtime jar not found: ${sourceJar}`);
}

copyFileSync(sourceJar, targetJar);
console.log(`[OK] copied runtime jar to ${targetJar}`);
