import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = resolve(import.meta.dirname, "..");

const subPackages = [
  "sdk",
  "core",
  "builder",
  "runtime-node",
  "testing",
  "mcp",
  "cli",
];

const examplePackages = [
  "github-tools",
];

function getExamplePackages(): string[] {
  const examplesDir = join(rootDir, "examples");
  if (!existsSync(examplesDir)) return examplePackages;
  try {
    const discovered = readdirSync(examplesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(examplesDir, d.name, "package.json")))
      .map((d) => d.name);
    return Array.from(new Set([...examplePackages, ...discovered]));
  } catch {
    return examplePackages;
  }
}

function getTargetVersion(): string {
  const args = process.argv.slice(2);
  let rawVersion = args[0];

  if (rawVersion === "--from-git-tag") {
    rawVersion = process.env.GITHUB_REF_NAME || "";
    if (!rawVersion) {
      const gitRes = spawnSync("git", ["describe", "--tags", "--exact-match"], {
        encoding: "utf8",
      });
      if (gitRes.status === 0) {
        rawVersion = gitRes.stdout.trim();
      }
    }
  }

  if (!rawVersion) {
    console.error("Usage: node ./scripts/bump-version.ts <version | --from-git-tag>");
    process.exit(1);
  }

  let cleaned = rawVersion.trim();
  if (cleaned.startsWith("v")) {
    cleaned = cleaned.slice(1);
  }

  const semverRegex = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
  if (!semverRegex.test(cleaned)) {
    console.error(`Error: Invalid semver version '${cleaned}'`);
    process.exit(1);
  }

  return cleaned;
}

function updateJsonFile(filePath: string, updater: (json: any) => void): void {
  const content = readFileSync(filePath, "utf8");
  const json = JSON.parse(content);
  updater(json);
  writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
}

function main() {
  const targetVersion = getTargetVersion();
  const isPrerelease = targetVersion.includes("-");
  console.log(`Synchronizing version to: ${targetVersion} (prerelease: ${isPrerelease})`);

  // Update root package.json
  const rootPkgPath = join(rootDir, "package.json");
  updateJsonFile(rootPkgPath, (pkg) => {
    pkg.version = targetVersion;
    if (pkg.dependencies) {
      for (const dep of Object.keys(pkg.dependencies)) {
        if (dep.startsWith("@actiondock/")) {
          pkg.dependencies[dep] = isPrerelease ? targetVersion : `^${targetVersion}`;
        }
      }
    }
  });
  console.log(`Updated root package.json -> ${targetVersion}`);

  // Update subpackages
  for (const sub of subPackages) {
    const pkgPath = join(rootDir, "packages", sub, "package.json");
    updateJsonFile(pkgPath, (pkg) => {
      pkg.version = targetVersion;
      if (pkg.dependencies) {
        for (const dep of Object.keys(pkg.dependencies)) {
          if (dep.startsWith("@actiondock/")) {
            pkg.dependencies[dep] = isPrerelease ? targetVersion : `^${targetVersion}`;
          }
        }
      }
      if (pkg.devDependencies) {
        for (const dep of Object.keys(pkg.devDependencies)) {
          if (dep.startsWith("@actiondock/")) {
            pkg.devDependencies[dep] = isPrerelease ? targetVersion : `^${targetVersion}`;
          }
        }
      }
    });
    console.log(`Updated packages/${sub}/package.json -> ${targetVersion}`);
  }

  // Update example packages
  const exampleDirs = getExamplePackages();
  for (const example of exampleDirs) {
    const pkgPath = join(rootDir, "examples", example, "package.json");
    if (existsSync(pkgPath)) {
      updateJsonFile(pkgPath, (pkg) => {
        if (pkg.dependencies) {
          for (const dep of Object.keys(pkg.dependencies)) {
            if (dep.startsWith("@actiondock/")) {
              pkg.dependencies[dep] = isPrerelease ? targetVersion : `^${targetVersion}`;
            }
          }
        }
        if (pkg.devDependencies) {
          for (const dep of Object.keys(pkg.devDependencies)) {
            if (dep.startsWith("@actiondock/")) {
              pkg.devDependencies[dep] = isPrerelease ? targetVersion : `^${targetVersion}`;
            }
          }
        }
      });
      console.log(`Updated examples/${example}/package.json`);
    }
  }

  // Update source files
  // packages/core/src/project/init.ts
  const initTsPath = join(rootDir, "packages", "core", "src", "project", "init.ts");
  let initTs = readFileSync(initTsPath, "utf8");
  const depVer = isPrerelease ? targetVersion : `^${targetVersion}`;
  initTs = initTs.replace(
    /"@actiondock\/sdk":\s*"[^"]+"/,
    `"@actiondock/sdk": "${depVer}"`
  );
  initTs = initTs.replace(
    /"@actiondock\/testing":\s*"[^"]+"/,
    `"@actiondock/testing": "${depVer}"`
  );
  writeFileSync(initTsPath, initTs);
  console.log("Updated packages/core/src/project/init.ts");

  // packages/core/src/version.ts
  const coreVersionTsPath = join(rootDir, "packages", "core", "src", "version.ts");
  writeFileSync(
    coreVersionTsPath,
    `/**\n * ActionDock 核心版本号单一事实源。\n */\nexport const ACTIONDOCK_VERSION = "${targetVersion}";\n`
  );
  console.log("Updated packages/core/src/version.ts");

  // 4. Update lockfile
  console.log("Updating lockfile via npm install...");
  const installRes = spawnSync("npm", ["install"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (installRes.status !== 0) {
    console.error("Failed to update lockfile");
    process.exit(1);
  }

  // 5. Rebuild packages dist
  console.log("Rebuilding monorepo packages dist...");
  const buildRes = spawnSync("node", [join(rootDir, "scripts", "build.ts")], {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (buildRes.status !== 0) {
    console.error("Failed to build monorepo packages dist");
    process.exit(1);
  }

  console.log(`Version bump to ${targetVersion} completed successfully!`);
}

main();
