import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { extractPrereleaseTag } from "./lib/semver.js";
import { discoverWorkspacePackages } from "./lib/discover-workspace-packages.js";

const rootDir = resolve(import.meta.dirname, "..");

/**
 * 拓扑顺序定义的子包发布清单（依赖拓扑顺序硬编码，成员来自工作区发现单一事实源）
 */
interface PackageInfo {
  name: string;
  dir: string;
}

/** 发布顺序按依赖拓扑排列：sdk -> core -> testing -> builder -> mcp -> cli */
const PUBLISH_ORDER = ["sdk", "core", "testing", "builder", "mcp", "cli"];

const PUBLISH_PACKAGES: PackageInfo[] = discoverWorkspacePackages(rootDir)
  .filter((pkg) => PUBLISH_ORDER.includes(pkg.shortName))
  .sort((a, b) => PUBLISH_ORDER.indexOf(a.shortName) - PUBLISH_ORDER.indexOf(b.shortName));

function runCmd(cmd: string, args: string[], options: { cwd?: string; allowFailure?: boolean; captureOutput?: boolean } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd || rootDir,
    encoding: "utf8",
    stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.status !== 0 && !options.allowFailure) {
    const errorMsg = options.captureOutput
      ? (result.stderr || result.stdout || "").trim()
      : `Command failed with code ${result.status}`;
    throw new Error(`Failed to execute: ${cmd} ${args.join(" ")}\n${errorMsg}`);
  }

  return result;
}

function resolveTargetVersion(): string {
  const corePkg = JSON.parse(readFileSync(join(rootDir, "packages", "core", "package.json"), "utf8"));
  return corePkg.version;
}

function resolveTargetDistTag(version: string, customTag?: string): string {
  if (customTag) return customTag;

  const prereleaseTag = extractPrereleaseTag(version);
  if (prereleaseTag) {
    return prereleaseTag;
  }
  return "latest";
}

function getRemotePackageInfo(pkgName: string, version: string): { exists: boolean; shasum?: string } {
  const res = runCmd("npm", ["view", `${pkgName}@${version}`, "dist.shasum", "--json"], {
    allowFailure: true,
    captureOutput: true,
  });

  if (res.status !== 0 || !res.stdout.trim()) {
    return { exists: false };
  }

  try {
    const data = JSON.parse(res.stdout.trim());
    return {
      exists: true,
      shasum: typeof data === "string" ? data : data["dist.shasum"] || data.shasum,
    };
  } catch {
    return { exists: false };
  }
}

function computeLocalTarballShasum(pkgDir: string): { tarballPath: string; shasum: string } {
  const packRes = runCmd("npm", ["pack", "--json"], {
    cwd: pkgDir,
    captureOutput: true,
  });

  // npm < 11 的 pack --json 输出为数组；npm >= 11 为按包名索引的对象形态
  // （与 packages/builder/src/pack.ts runNpmPack 的双形态解析口径一致）
  const parsed: unknown = JSON.parse(packRes.stdout.trim());
  let items: Array<{ filename?: unknown }>;
  if (Array.isArray(parsed)) {
    items = parsed as Array<{ filename?: unknown }>;
  } else if (typeof parsed === "object" && parsed !== null) {
    items = Object.values(parsed).filter(
      (entry): entry is { filename?: unknown } =>
        typeof entry === "object" && entry !== null && "filename" in entry
    );
  } else {
    items = [];
  }
  const filenames = items
    .map((item) => item.filename)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  const tarballFilename = filenames[filenames.length - 1];
  if (!tarballFilename) {
    throw new Error(
      `npm pack --json output did not contain a tarball filename for ${pkgDir}. Output:\n${packRes.stdout}`
    );
  }
  const tarballPath = join(pkgDir, tarballFilename);

  const fileBuffer = readFileSync(tarballPath);
  const shasum = createHash("sha1").update(fileBuffer).digest("hex");

  return { tarballPath, shasum };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  let customTargetTag: string | undefined;
  const tagArgIdx = args.indexOf("--target-tag");
  if (tagArgIdx !== -1 && args[tagArgIdx + 1]) {
    customTargetTag = args[tagArgIdx + 1];
  }

  const targetVersion = resolveTargetVersion();
  const targetDistTag = resolveTargetDistTag(targetVersion, customTargetTag);

  console.log("=== ActionDock 2.0 发布流程 ===");
  console.log(`目标版本: ${targetVersion}`);
  console.log(`目标分发标签: ${targetDistTag}`);
  console.log(`模拟运行模式: ${dryRun ? "是" : "否"}`);

  try {
    // 1. 全包版本强一致性校验与不可变性校验
    console.log("\n[1/2] 全包版本强一致性校验与不可变性校验...");

    // 全包版本强一致性断言校验
    console.log(`- 校验根目录与全部 ${PUBLISH_PACKAGES.length} 个子包版本强一致性...`);
    const versionMismatches: string[] = [];
    const rootPkgPath = join(rootDir, "package.json");
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
    if (rootPkg.version !== targetVersion) {
      versionMismatches.push(`根目录 (package.json): 实际 ${rootPkg.version}，预期 ${targetVersion}`);
    }

    for (const pkg of PUBLISH_PACKAGES) {
      const pkgJsonPath = join(pkg.dir, "package.json");
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      if (pkgJson.version !== targetVersion) {
        versionMismatches.push(`${pkg.name}: 实际 ${pkgJson.version}，预期 ${targetVersion}`);
      }
    }

    if (versionMismatches.length > 0) {
      const errorMsg = `全包版本强一致性断言校验失败，以下包版本与目标版本 (${targetVersion}) 不一致:\n` +
        versionMismatches.map((m) => `  - ${m}`).join("\n");
      console.error(`\n[ERROR] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    console.log(`  [OK] 根目录与全部 ${PUBLISH_PACKAGES.length} 个子包版本均严格一致 (${targetVersion})`);

    const localTarballs: Record<string, { path: string; shasum: string }> = {};

    for (const pkg of PUBLISH_PACKAGES) {
      console.log(`- 检查 ${pkg.name}...`);
      const { tarballPath, shasum } = computeLocalTarballShasum(pkg.dir);
      localTarballs[pkg.name] = { path: tarballPath, shasum };

      if (!dryRun) {
        const remoteInfo = getRemotePackageInfo(pkg.name, targetVersion);
        if (remoteInfo.exists) {
          if (remoteInfo.shasum === shasum) {
            console.log(`  版本 ${targetVersion} 已存在且摘要匹配 (${shasum})，将跳过实际发布`);
          } else {
            throw new Error(
              `包不可变性违规: ${pkg.name}@${targetVersion} 已存在于远端且摘要不一致！\n远端: ${remoteInfo.shasum}\n本地: ${shasum}`
            );
          }
        }
      }
    }

    // 2. 按拓扑顺序直接发布子包（携带目标分发标签）
    console.log(`\n[2/2] 按拓扑顺序直接发布子包至 ${targetDistTag} 标签...`);
    for (const pkg of PUBLISH_PACKAGES) {
      console.log(`- 发布 ${pkg.name}@${targetVersion} [标签: ${targetDistTag}]...`);
      const publishArgs = ["publish", localTarballs[pkg.name].path, "--access", "public", "--tag", targetDistTag];
      if (process.env.GITHUB_ACTIONS) {
        publishArgs.push("--provenance");
      }
      if (dryRun) {
        console.log(`  [模拟] 执行: npm ${publishArgs.join(" ")}`);
      } else {
        const remoteInfo = getRemotePackageInfo(pkg.name, targetVersion);
        if (remoteInfo.exists && remoteInfo.shasum === localTarballs[pkg.name].shasum) {
          console.log(`  版本已存在于远端且摘要一致，跳过上传`);
        } else {
          let published = false;
          const maxPublishRetries = 3;
          for (let pAttempt = 1; pAttempt <= maxPublishRetries; pAttempt++) {
            try {
              runCmd("npm", publishArgs, {
                cwd: pkg.dir,
              });
              published = true;
              break;
            } catch (publishErr) {
              if (pAttempt < maxPublishRetries) {
                console.log(`  [重试] ${pkg.name} 发布失败，等待 5 秒后重试 (${pAttempt + 1}/${maxPublishRetries})...`);
                await sleepMs(5000);
              } else {
                throw publishErr;
              }
            }
          }
        }
      }
      if (!dryRun) {
        await sleepMs(2000);
      }
    }

    console.log(`\n发布成功！根目录与全部 ${PUBLISH_PACKAGES.length} 个子包已成功发布至 ${targetDistTag} 标签。`);
  } finally {
    // 清理可能遗留在子包目录下的 *.tgz 压缩文件
    for (const pkg of PUBLISH_PACKAGES) {
      try {
        if (existsSync(pkg.dir)) {
          const files = readdirSync(pkg.dir);
          for (const file of files) {
            if (file.endsWith(".tgz")) {
              rmSync(join(pkg.dir, file), { force: true });
            }
          }
        }
      } catch {
        // 忽略子包目录清理异常
      }
    }
  }
}

main().catch((err) => {
  console.error("\n发布流程终止:", err);
  process.exit(1);
});
