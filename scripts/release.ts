import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const rootDir = resolve(import.meta.dirname, "..");

interface ReleaseOptions {
  version?: string;
  bumpType?: "patch" | "minor" | "major" | "prerelease";
  preId?: string;
  dryRun: boolean;
  skipVerify: boolean;
  push: boolean;
  allowDirty: boolean;
  customNotes?: string;
}

function runCmd(
  cmd: string,
  args: string[],
  options: { cwd?: string; allowFailure?: boolean; captureOutput?: boolean } = {}
): SpawnSyncReturns<string> {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd || rootDir,
    encoding: "utf8",
    stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0 && !options.allowFailure) {
    const errorMsg = options.captureOutput
      ? (result.stderr || result.stdout || "").trim()
      : `命令执行失败，退出码: ${result.status}`;
    throw new Error(`执行失败: ${cmd} ${args.join(" ")}\n${errorMsg}`);
  }

  return result;
}

function getCurrentVersion(): string {
  const rootPkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  return rootPkg.version;
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

function parseSemver(v: string): Semver {
  const cleaned = v.trim().replace(/^v/, "");
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    throw new Error(`非法的语义化版本号: '${v}'`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
}

function bumpSemver(current: string, type: "patch" | "minor" | "major" | "prerelease", preId = "beta"): string {
  const parsed = parseSemver(current);
  if (type === "major") {
    return `${parsed.major + 1}.0.0`;
  }
  if (type === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  if (type === "patch") {
    if (parsed.prerelease) {
      return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
    }
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
  if (type === "prerelease") {
    if (parsed.prerelease) {
      const match = parsed.prerelease.match(/^(.*?)(?:\.(\d+))?$/);
      if (match) {
        const id = match[1];
        const num = match[2] ? parseInt(match[2], 10) + 1 : 0;
        return `${parsed.major}.${parsed.minor}.${parsed.patch}-${id}.${num}`;
      }
    }
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-${preId}.0`;
  }
  return current;
}

function getPreviousVersionRef(): string | null {
  const ghRes = runCmd("gh", ["release", "view", "--json", "tagName", "-q", ".tagName"], {
    allowFailure: true,
    captureOutput: true,
  });
  if (ghRes.status === 0 && ghRes.stdout.trim()) {
    return ghRes.stdout.trim();
  }

  const gitRes = runCmd("git", ["describe", "--tags", "--abbrev=0"], {
    allowFailure: true,
    captureOutput: true,
  });
  if (gitRes.status === 0 && gitRes.stdout.trim()) {
    return gitRes.stdout.trim();
  }

  return null;
}

function getCommitSummarySince(ref: string | null): string {
  const range = ref ? `${ref}..HEAD` : "HEAD";
  const res = runCmd("git", ["log", range, "--pretty=format:%s"], {
    allowFailure: true,
    captureOutput: true,
  });

  if (res.status !== 0 || !res.stdout.trim()) {
    return "";
  }

  const lines = res.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("chore(release):"));

  if (lines.length === 0) {
    return "";
  }

  return lines.map((l) => `- ${l}`).join("\n");
}

function parseCliArgs(): ReleaseOptions {
  const args = process.argv.slice(2);
  const options: ReleaseOptions = {
    dryRun: false,
    skipVerify: false,
    push: false,
    allowDirty: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--skip-verify") {
      options.skipVerify = true;
    } else if (arg === "--push") {
      options.push = true;
    } else if (arg === "--allow-dirty") {
      options.allowDirty = true;
    } else if (arg === "--patch") {
      options.bumpType = "patch";
    } else if (arg === "--minor") {
      options.bumpType = "minor";
    } else if (arg === "--major") {
      options.bumpType = "major";
    } else if (arg === "--prerelease") {
      options.bumpType = "prerelease";
      if (args[i + 1] && !args[i + 1].startsWith("--")) {
        options.preId = args[i + 1];
        i++;
      }
    } else if (arg === "--notes") {
      if (args[i + 1]) {
        options.customNotes = args[i + 1];
        i++;
      }
    } else if (!arg.startsWith("--") && !options.version) {
      options.version = arg;
    }
    i++;
  }

  return options;
}

function isGhCliAvailable(): boolean {
  const res = spawnSync("gh", ["--version"], {
    encoding: "utf8",
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return res.status === 0;
}

function isGhAuthenticated(): boolean {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    return true;
  }
  const res = spawnSync("gh", ["auth", "status"], {
    encoding: "utf8",
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return res.status === 0;
}

async function main() {
  const options = parseCliArgs();
  const currentVersion = getCurrentVersion();

  let targetVersion = options.version;
  if (!targetVersion) {
    const bumpType = options.bumpType || "patch";
    targetVersion = bumpSemver(currentVersion, bumpType, options.preId || "beta");
  }

  targetVersion = targetVersion.replace(/^v/, "");
  parseSemver(targetVersion);

  const isPrerelease = targetVersion.includes("-");

  console.log("=== ActionDock 自动化发版流程 (GitHub Release 模式) ===");
  console.log(`当前版本: ${currentVersion}`);
  console.log(`目标版本: ${targetVersion} (预发布: ${isPrerelease ? "是" : "否"})`);
  console.log(`模拟运行模式: ${options.dryRun ? "是" : "否"}`);

  // 1. 工作区状态检查
  if (!options.allowDirty) {
    const statusRes = runCmd("git", ["status", "--porcelain"], { captureOutput: true });
    if (statusRes.stdout.trim()) {
      throw new Error("Git 工作区存在未提交的更改，请先提交或贮藏后再执行发版！");
    }
  }

  const branchRes = runCmd("git", ["rev-parse", "--abbrev-ref", "HEAD"], { captureOutput: true });
  const currentBranch = branchRes.stdout.trim();
  console.log(`当前分支: ${currentBranch}`);

  // 2. 变更日志提炼
  const previousRef = getPreviousVersionRef();
  console.log(`基准对照版本: ${previousRef || "初次发布"}`);
  let changelog = options.customNotes || getCommitSummarySince(previousRef);
  if (!changelog) {
    changelog = `- chore(release): release ${targetVersion}`;
  }

  console.log("\n提炼的发版变更日志:");
  console.log(changelog);
  console.log("");

  // 3. 发布前全量质量校验
  if (options.skipVerify) {
    console.log("提示: 已指定 --skip-verify，跳过质量检验套件。");
  } else {
    console.log("执行全量质量检验套件...");
    console.log("- 执行 TypeScript 类型检查...");
    runCmd("npm", ["run", "typecheck"]);

    console.log("- 执行单元与集成测试...");
    runCmd("npm", ["test"]);

    console.log("- 执行打包烟雾测试...");
    runCmd("npm", ["run", "test:pack"]);
    console.log("质量检验全部通过。\n");
  }

  if (options.dryRun) {
    console.log("[模拟运行] 模拟模式下不执行实际的文件修改、提交与发布。");
    console.log(`预期提交说明:\nchore(release): release ${targetVersion}\n\n${changelog}`);
    console.log(`预期发布命令:\ngh release create ${targetVersion} --title "Release ${targetVersion}" --notes "${changelog.replace(/"/g, '\\"')}" ${isPrerelease ? "--prerelease" : ""}`);
    return;
  }

  // 4. 版本同步
  console.log(`同步 Monorepo 版本号至 ${targetVersion}...`);
  runCmd("node", [join(rootDir, "scripts", "bump-version.ts"), targetVersion]);

  // 5. 创建规范提交（纯提交模式，无需本地打 tag）
  console.log("创建发版提交...");
  runCmd("git", ["add", "-A"]);
  const commitMsg = `chore(release): release ${targetVersion}\n\n${changelog}`;
  runCmd("git", ["commit", "-m", commitMsg]);

  // 6. 推送分支
  console.log(`推送分支代码至远程仓库...`);
  runCmd("git", ["push", "origin", currentBranch]);

  // 7. 直接创建并发布 GitHub Release
  if (isGhCliAvailable() && isGhAuthenticated()) {
    console.log(`正在通过 GitHub CLI 创建 GitHub Release ${targetVersion}...`);
    const ghArgs = [
      "release",
      "create",
      targetVersion,
      "--title",
      `Release ${targetVersion}`,
      "--notes",
      changelog,
    ];
    if (isPrerelease) {
      ghArgs.push("--prerelease");
    }
    runCmd("gh", ghArgs);
    console.log(`GitHub Release 创建成功！已自动触发流水线发布至 npm。`);
  } else {
    console.log(`\n代码与发版提交已成功推送至远程 ${currentBranch} 分支。`);
    console.log(`请通过以下任一方式发布 GitHub Release（流水线将自动监听到并发布至 npm）：`);
    console.log(`- 命令行发布：`);
    console.log(`  gh release create ${targetVersion} --title "Release ${targetVersion}" --notes "${changelog.replace(/"/g, '\\"')}" ${isPrerelease ? "--prerelease" : ""}`);
    console.log(`- GitHub 网页端发布：`);
    console.log(`  在 Releases 页面点击 Draft a new release，输入版本号 ${targetVersion} 并粘贴上述更新说明点击发布。`);
  }
}

main().catch((err) => {
  console.error("\n发版流程终止:", err.message || err);
  process.exit(1);
});
