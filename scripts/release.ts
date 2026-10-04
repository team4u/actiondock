/**
 * 发版编排脚本（本地发起入口）。
 *
 * 与 GitHub Actions 流水线的职责边界：
 * - 本脚本：提炼变更日志、同步版本号、创建规范提交并推送分支，随后创建
 *   GitHub Release；发布触发事实源始终是 GitHub Release 事件本身。
 * - 流水线（.github/workflows/publish.yml）：监听 Release 发布事件，重新校验、
 *   解析版本类型决定分发标签并执行 npm 发布；本脚本不直接触碰 npm。
 * 两层各司其职，正式发布以 GitHub Release 为唯一触发事实源。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { bumpSemver, parseSemver } from "./lib/semver.ts";
import { createCommandRunner } from "./lib/run-command.ts";

const rootDir = resolve(import.meta.dirname, "..");
const runCmd = createCommandRunner(rootDir);

interface ReleaseOptions {
  version?: string;
  bumpType?: "patch" | "minor" | "major" | "prerelease";
  preId?: string;
  dryRun: boolean;
  skipVerify: boolean;
  push: boolean;
  allowDirty: boolean;
  customNotes?: string;
  overview?: string;
  overviewFile?: string;
}

function getCurrentVersion(): string {
  const rootPkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  return rootPkg.version;
}

function getPreviousVersionRef(): string | null {
  // 优先以 GitHub Release 作为基准版本事实源
  const ghRes = runCmd("gh", ["release", "view", "--json", "tagName", "-q", ".tagName"], {
    allowFailure: true,
    captureOutput: true,
  });
  if (ghRes.status === 0 && ghRes.stdout.trim()) {
    return ghRes.stdout.trim();
  }

  // 回退路径：GitHub Release 不可用时退回本地 git 标签探测。
  // 这仅是本地开发便利，与「以 GitHub Release 为唯一触发事实源」的规范存在张力：
  // 本地标签可能与远端 Release 状态漂移，仅影响提炼日志的基准范围，不影响发布事实。
  // 正式发布流程以 GitHub Release 为准。
  const gitRes = runCmd("git", ["describe", "--tags", "--abbrev=0"], {
    allowFailure: true,
    captureOutput: true,
  });
  if (gitRes.status === 0 && gitRes.stdout.trim()) {
    console.warn(
      `[告警] 未能通过 GitHub CLI 获取最近 Release，已回退至本地 git 标签 ${gitRes.stdout.trim()} 提炼变更日志。`
    );
    console.warn(`[告警] 此为本地开发便利回退，本地标签可能与远端 Release 状态漂移；正式发布以 GitHub Release 为唯一触发事实源。`);
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

function printHelp(): void {
  console.log(`
用法: node scripts/release.ts [版本号] [选项]

参数选项:
  --patch                自增修订号补丁版本 (x.y.Z)
  --minor                自增次版本号 (x.Y.0)
  --major                自增主版本号 (X.0.0)
  --prerelease [preId]   自增预发布版本号 (如 beta, alpha)
  --overview <text>      产品视角解读说明（根据变更体量弹性输入，支持多行文本）
  --overview-file <path> 产品视角解读文件路径（支持完整 Markdown 文档）
  --notes <text>         全量发版说明（覆盖模式，忽略提交列表装配）
  --dry-run              模拟运行模式（不修改文件、不创建提交与 Release）
  --skip-verify          跳过发布前质量检验套件（类型检查、测试与打包烟雾测试）
  --push                 发布提交后推送到远程仓库
  --allow-dirty          允许工作区存在未提交的更改
  --help, -h             查看使用帮助
`);
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
    } else if (arg === "--overview") {
      if (args[i + 1]) {
        options.overview = args[i + 1];
        i++;
      }
    } else if (arg === "--overview-file") {
      if (args[i + 1]) {
        options.overviewFile = args[i + 1];
        i++;
      }
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
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

  // 2. 变更日志提炼与产品解读装配
  const previousRef = getPreviousVersionRef();
  console.log(`基准对照版本: ${previousRef || "初次发布"}`);
  const rawCommits = getCommitSummarySince(previousRef);

  let changelog = "";
  if (options.customNotes) {
    changelog = options.customNotes;
  } else {
    let overview = options.overview?.trim() || "";
    if (options.overviewFile) {
      const filePath = resolve(process.cwd(), options.overviewFile);
      if (!existsSync(filePath)) {
        throw new Error(`指定的产品解读文件不存在: ${filePath}`);
      }
      overview = readFileSync(filePath, "utf8").trim();
    } else if (overview.includes("\\n") && !overview.includes("\n")) {
      overview = overview.replace(/\\n/g, "\n");
    }

    if (overview && rawCommits) {
      changelog = `${overview}\n\n### 变更明细\n\n${rawCommits}`;
    } else if (overview) {
      changelog = overview;
    } else if (rawCommits) {
      changelog = rawCommits;
    } else {
      changelog = `- chore(release): release ${targetVersion}`;
    }
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
