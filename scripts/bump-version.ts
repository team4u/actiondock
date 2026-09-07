import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = resolve(__dirname, "..");

const subPackages = [
  "sdk",
  "core",
  "builder",
  "runtime-node",
  "runtime-bun",
  "runtime-cli",
  "testing",
  "mcp",
  "cli",
];

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
    console.error("Usage: bun run ./scripts/bump-version.ts <version | --from-git-tag>");
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

  // 1. Update root package.json
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

  // 2. Update subpackages
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

  // 3. Update source files
  // 3.1 packages/core/src/project/init.ts
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

  // 3.2 packages/cli/src/commands/index.ts
  const cliIndexTsPath = join(rootDir, "packages", "cli", "src", "commands", "index.ts");
  let cliIndexTs = readFileSync(cliIndexTsPath, "utf8");
  cliIndexTs = cliIndexTs.replace(/\.version\("[^"]+"\)/, `.version("${targetVersion}")`);
  writeFileSync(cliIndexTsPath, cliIndexTs);
  console.log("Updated packages/cli/src/commands/index.ts");

  // 3.3 packages/runtime-cli/src/commands/version-help.ts
  const versionHelpTsPath = join(rootDir, "packages", "runtime-cli", "src", "commands", "version-help.ts");
  let versionHelpTs = readFileSync(versionHelpTsPath, "utf8");
  versionHelpTs = versionHelpTs.replace(
    /const ver = program\.version\(\) \|\| "[^"]+";/,
    `const ver = program.version() || "${targetVersion}";`
  );
  writeFileSync(versionHelpTsPath, versionHelpTs);
  console.log("Updated packages/runtime-cli/src/commands/version-help.ts");

  // 3.4 packages/runtime-cli/src/program.ts
  const programTsPath = join(rootDir, "packages", "runtime-cli", "src", "program.ts");
  let programTs = readFileSync(programTsPath, "utf8");
  programTs = programTs.replace(
    /const version = options\?\.version \|\| \(isStandalone \? options!\.standalone!\.version : "[^"]+"\);/,
    `const version = options?.version || (isStandalone ? options!.standalone!.version : "${targetVersion}");`
  );
  writeFileSync(programTsPath, programTs);
  console.log("Updated packages/runtime-cli/src/program.ts");

  // 4. Rebuild CLI dist
  console.log("Rebuilding @actiondock/cli dist bundle...");
  const buildRes = spawnSync("bun", ["run", "--cwd", join(rootDir, "packages", "cli"), "build"], {
    stdio: "inherit",
  });
  if (buildRes.status !== 0) {
    console.error("Failed to build CLI dist");
    process.exit(1);
  }

  console.log(`Version bump to ${targetVersion} completed successfully!`);
}

main();
