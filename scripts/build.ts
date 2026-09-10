import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = resolve(import.meta.dirname, "..");

const PACKAGES = [
  "sdk",
  "core",
  "mcp",
  "builder",
  "runtime-node",
  "cli",
  "testing",
] as const;

console.log(`[BUILD] Building all ${PACKAGES.length} ActionDock packages...`);

// 1. Bundle JavaScript for each package
for (const pkg of PACKAGES) {
  const pkgDir = join(rootDir, "packages", pkg);
  const distDir = join(pkgDir, "dist");
  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true, force: true });
  }
  mkdirSync(distDir, { recursive: true });

  console.log(`[BUILD] Bundling JS for @actiondock/${pkg}...`);
  const buildProc = spawnSync(
    "bun",
    [
      "build",
      join(pkgDir, "src", "index.ts"),
      "--outdir",
      distDir,
      "--target",
      "node",
      "--format",
      "esm",
      "--packages=external",
      "--external",
      "@actiondock/*",
      ...PACKAGES.flatMap((p) => ["--external", `@actiondock/${p}`]),
    ],
    { stdio: "inherit", cwd: rootDir }
  );

  if (buildProc.status !== 0) {
    console.error(`[ERROR] Failed to bundle @actiondock/${pkg}`);
    process.exit(1);
  }
}

// 2. Emit declaration files via tsc
const dtsStaging = join(rootDir, ".dist-dts-staging");
if (existsSync(dtsStaging)) {
  rmSync(dtsStaging, { recursive: true, force: true });
}

console.log("[BUILD] Emitting declaration files via tsc...");
const tscProc = spawnSync(
  "bun",
  ["x", "tsc", "-p", "tsconfig.json", "--emitDeclarationOnly", "--outDir", dtsStaging],
  { stdio: "inherit", cwd: rootDir }
);

if (tscProc.status !== 0) {
  console.error("[ERROR] Failed to emit declaration files via tsc");
  process.exit(1);
}

// 3. Copy declarations to respective package dist directories
for (const pkg of PACKAGES) {
  const pkgDtsDir = join(dtsStaging, "packages", pkg, "src");
  const destDistDir = join(rootDir, "packages", pkg, "dist");

  if (existsSync(pkgDtsDir)) {
    cpSync(pkgDtsDir, destDistDir, { recursive: true });
    console.log(`[OK] Copied declaration files for @actiondock/${pkg}`);
  } else {
    console.warn(`[WARN] Declaration dir not found for @actiondock/${pkg}: ${pkgDtsDir}`);
  }
}

// 4. Cleanup staging
rmSync(dtsStaging, { recursive: true, force: true });

// 5. Verification
let failed = false;
for (const pkg of PACKAGES) {
  const jsPath = join(rootDir, "packages", pkg, "dist", "index.js");
  const dtsPath = join(rootDir, "packages", pkg, "dist", "index.d.ts");

  if (!existsSync(jsPath)) {
    console.error(`[ERROR] Missing dist/index.js in @actiondock/${pkg}`);
    failed = true;
  }
  if (!existsSync(dtsPath)) {
    console.error(`[ERROR] Missing dist/index.d.ts in @actiondock/${pkg}`);
    failed = true;
  }

  if (pkg !== "core" && existsSync(jsPath)) {
    const content = readFileSync(jsPath, "utf-8");
    if (content.includes("packages/core/src")) {
      console.error(`[ERROR] Package @actiondock/${pkg} dist embedded packages/core/src!`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log(`[SUCCESS] All ${PACKAGES.length} ActionDock packages built successfully!`);
