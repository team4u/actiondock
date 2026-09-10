import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const rootDir = resolve(import.meta.dirname, "..");

/**
 * 拓扑顺序定义的子包发布清单
 */
interface PackageInfo {
  name: string;
  dir: string;
}

const PUBLISH_PACKAGES: PackageInfo[] = [
  { name: "@actiondock/sdk", dir: join(rootDir, "packages", "sdk") },
  { name: "@actiondock/core", dir: join(rootDir, "packages", "core") },
  { name: "@actiondock/testing", dir: join(rootDir, "packages", "testing") },
  { name: "@actiondock/runtime-node", dir: join(rootDir, "packages", "runtime-node") },
  { name: "@actiondock/builder", dir: join(rootDir, "packages", "builder") },
  { name: "@actiondock/mcp", dir: join(rootDir, "packages", "mcp") },
  { name: "@actiondock/cli", dir: join(rootDir, "packages", "cli") },
];

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

  const prereleaseMatch = version.match(/-([a-zA-Z]+)(?:\.|\b)/);
  if (prereleaseMatch) {
    const tag = prereleaseMatch[1].toLowerCase();
    return tag;
  }
  return "latest";
}

function getRemotePackageInfo(pkgName: string, version: string): { exists: boolean; shasum?: string; distTags?: Record<string, string> } {
  const res = runCmd("npm", ["view", `${pkgName}@${version}`, "dist.shasum", "dist-tags", "--json"], {
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
      distTags: data["dist-tags"] || {},
    };
  } catch {
    return { exists: false };
  }
}

function getRemoteDistTags(pkgName: string): Record<string, string> {
  const res = runCmd("npm", ["view", pkgName, "dist-tags", "--json"], {
    allowFailure: true,
    captureOutput: true,
  });

  if (res.status !== 0 || !res.stdout.trim()) {
    return {};
  }

  try {
    return JSON.parse(res.stdout.trim());
  } catch {
    return {};
  }
}

function computeLocalTarballShasum(pkgDir: string): { tarballPath: string; shasum: string } {
  const packRes = runCmd("npm", ["pack", "--json"], {
    cwd: pkgDir,
    captureOutput: true,
  });

  const packInfo = JSON.parse(packRes.stdout.trim());
  const tarballFilename = packInfo[0].filename;
  const tarballPath = join(pkgDir, tarballFilename);

  const fileBuffer = readFileSync(tarballPath);
  const shasum = createHash("sha1").update(fileBuffer).digest("hex");

  return { tarballPath, shasum };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const skipVerify = args.includes("--skip-verify");

  let customTargetTag: string | undefined;
  const tagArgIdx = args.indexOf("--target-tag");
  if (tagArgIdx !== -1 && args[tagArgIdx + 1]) {
    customTargetTag = args[tagArgIdx + 1];
  }

  const targetVersion = resolveTargetVersion();
  const targetDistTag = resolveTargetDistTag(targetVersion, customTargetTag);
  const tempDistTag = `temp-${targetVersion}-${Date.now().toString(36)}`;

  console.log("=== ActionDock 2.0 发布流程 ===");
  console.log(`目标版本: ${targetVersion}`);
  console.log(`目标分发标签: ${targetDistTag}`);
  console.log(`临时分发标签: ${tempDistTag}`);
  console.log(`模拟运行模式: ${dryRun ? "是" : "否"}`);

  // 1. 预检查与原有 dist-tags 备份
  console.log("\n[1/5] 备份既有分发标签指针与不可变性校验...");
  const distTagBackup: Record<string, string | null> = {};
  const localTarballs: Record<string, { path: string; shasum: string }> = {};

  for (const pkg of PUBLISH_PACKAGES) {
    console.log(`- 检查 ${pkg.name}...`);
    const remoteDistTags = dryRun ? {} : getRemoteDistTags(pkg.name);
    distTagBackup[pkg.name] = remoteDistTags[targetDistTag] || null;
    console.log(`  当前 ${targetDistTag} 指向: ${distTagBackup[pkg.name] || "<空>"}`);

    // 生成本地打包产物并计算摘要
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

  // 2. 临时分发标签隔离发布
  console.log(`\n[2/5] 使用临时标签 (${tempDistTag}) 按拓扑顺序发布子包...`);
  const publishedPackages: string[] = [];

  try {
    for (const pkg of PUBLISH_PACKAGES) {
      console.log(`- 发布 ${pkg.name}@${targetVersion} [标签: ${tempDistTag}]...`);
      if (dryRun) {
        console.log(`  [模拟] 执行: npm publish ${localTarballs[pkg.name].path} --access public --tag ${tempDistTag}`);
      } else {
        const remoteInfo = getRemotePackageInfo(pkg.name, targetVersion);
        if (remoteInfo.exists && remoteInfo.shasum === localTarballs[pkg.name].shasum) {
          // 确保临时标签指向该版本
          runCmd("npm", ["dist-tag", "add", `${pkg.name}@${targetVersion}`, tempDistTag], {
            allowFailure: true,
          });
        } else {
          runCmd("npm", ["publish", localTarballs[pkg.name].path, "--access", "public", "--tag", tempDistTag], {
            cwd: pkg.dir,
          });
        }
      }
      publishedPackages.push(pkg.name);
    }
  } catch (error) {
    console.error("\n发布阶段发生异常，由于使用临时标签隔离，外部使用者未受影响。");
    throw error;
  }

  // 3. 发布后烟雾验证
  if (!skipVerify && !dryRun) {
    console.log(`\n[3/5] 验证临时标签下的包可见性与完整性...`);
    for (const pkg of PUBLISH_PACKAGES) {
      const viewRes = runCmd("npm", ["view", `${pkg.name}@${tempDistTag}`, "version"], {
        captureOutput: true,
        allowFailure: true,
      });
      if (viewRes.status !== 0 || !viewRes.stdout.includes(targetVersion)) {
        throw new Error(`临时标签验证失败: ${pkg.name}@${tempDistTag} 未能正确定位到 ${targetVersion}`);
      }
      console.log(`  ✔ ${pkg.name}@${tempDistTag} 验证通过`);
    }
  } else {
    console.log("\n[3/5] 跳过远端临时标签验证");
  }

  // 4. 原子分发指针切换与回滚机制
  console.log(`\n[4/5] 原子切换正式分发标签 (${targetDistTag} -> ${targetVersion})...`);
  const promotedPackages: string[] = [];

  try {
    for (const pkg of PUBLISH_PACKAGES) {
      console.log(`- 指针切换: ${pkg.name} ${targetDistTag} => ${targetVersion}`);
      if (dryRun) {
        console.log(`  [模拟] 执行: npm dist-tag add ${pkg.name}@${targetVersion} ${targetDistTag}`);
      } else {
        runCmd("npm", ["dist-tag", "add", `${pkg.name}@${targetVersion}`, targetDistTag]);
      }
      promotedPackages.push(pkg.name);
    }
  } catch (promotionError) {
    console.error("\n分发指针切换失败！正在执行自动回滚...");
    for (const promotedPkg of promotedPackages) {
      const prevVersion = distTagBackup[promotedPkg];
      try {
        if (prevVersion) {
          console.log(`  回滚 ${promotedPkg} ${targetDistTag} => ${prevVersion}`);
          if (!dryRun) {
            runCmd("npm", ["dist-tag", "add", `${promotedPkg}@${prevVersion}`, targetDistTag], {
              allowFailure: true,
            });
          }
        } else {
          console.log(`  回滚 ${promotedPkg} 移除 ${targetDistTag}`);
          if (!dryRun) {
            runCmd("npm", ["dist-tag", "rm", promotedPkg, targetDistTag], {
              allowFailure: true,
            });
          }
        }
      } catch (rollbackErr) {
        console.error(`  回滚 ${promotedPkg} 失败:`, rollbackErr);
      }
    }
    throw promotionError;
  }

  // 5. 清理临时分发标签
  console.log(`\n[5/5] 清理临时分发标签 (${tempDistTag})...`);
  for (const pkg of PUBLISH_PACKAGES) {
    if (dryRun) {
      console.log(`  [模拟] 执行: npm dist-tag rm ${pkg.name} ${tempDistTag}`);
    } else {
      runCmd("npm", ["dist-tag", "rm", pkg.name, tempDistTag], {
        allowFailure: true,
      });
    }
  }

  console.log(`\n发布成功！全量 7 个子包已成功发布并推广至 ${targetDistTag} 标签。`);
}

main().catch((err) => {
  console.error("\n发布流程终止:", err);
  process.exit(1);
});
