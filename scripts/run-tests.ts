import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const rootDir = resolve(import.meta.dirname, "..");
const preloadScript = join(rootDir, "scripts", "test-preload.ts");
const buildScript = join(rootDir, "scripts", "build.ts");

function ensureBuild(): void {
  const sdkDist = join(rootDir, "packages", "sdk", "dist", "index.js");
  if (!existsSync(sdkDist)) {
    console.log("[TEST] Monorepo dist not found, auto-building packages...");
    const { spawnSync } = require("node:child_process");
    const proc = spawnSync(process.execPath, [buildScript], {
      cwd: rootDir,
      stdio: "inherit",
    });
    if (proc.status !== 0) {
      console.error("[ERROR] Pre-test build failed");
      process.exit(1);
    }
  }
}

function scanTestFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== ".git") {
        results.push(...scanTestFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }

  return results;
}

function discoverAllTests(): string[] {
  const testFiles: string[] = [];

  // 1. Scan packages/*/test/
  const packagesDir = join(rootDir, "packages");
  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
      if (pkg.isDirectory()) {
        const testDir = join(packagesDir, pkg.name, "test");
        testFiles.push(...scanTestFiles(testDir));
      }
    }
  }

  // 2. Scan examples/*/tests/
  const examplesDir = join(rootDir, "examples");
  if (existsSync(examplesDir)) {
    for (const ex of readdirSync(examplesDir, { withFileTypes: true })) {
      if (ex.isDirectory()) {
        const testDir = join(examplesDir, ex.name, "tests");
        testFiles.push(...scanTestFiles(testDir));
      }
    }
  }

  return testFiles.sort();
}

async function main() {
  ensureBuild();

  const userArgs = process.argv.slice(2);
  let targetFiles: string[] = [];

  if (userArgs.length > 0) {
    // If user passed specific files or patterns
    const all = discoverAllTests();
    for (const arg of userArgs) {
      if (existsSync(resolve(arg))) {
        targetFiles.push(resolve(arg));
      } else {
        const filtered = all.filter((f) => f.includes(arg));
        targetFiles.push(...filtered);
      }
    }
    targetFiles = Array.from(new Set(targetFiles));
  } else {
    targetFiles = discoverAllTests();
  }

  if (targetFiles.length === 0) {
    console.warn("[WARN] No test files found.");
    process.exit(0);
  }

  console.log(`[TEST] Running ${targetFiles.length} test files via Node.js native test runner...\n`);

  const nodeArgs = [
    "--no-deprecation",
    "--import",
    preloadScript,
    "--test",
    ...targetFiles,
  ];

  const testProc = spawn(process.execPath, nodeArgs, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });

  testProc.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
