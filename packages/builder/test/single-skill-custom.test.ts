import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateSourceSkillMd,
  generateStandaloneSkillMd,
  parseCustomSkillDeclaration,
} from "../src/skill";
import { exportSkill } from "../src/exporter";
import type { ProjectConfig } from "@actiondock/core";

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

function createFixturePackage(
  pkgDir: string,
  pkgId: string,
  actionId: string,
  options?: { playbookId?: string; description?: string }
): void {
  mkdirSync(join(pkgDir, "actions"), { recursive: true });
  writeJson(join(pkgDir, "actiondock.json"), {
    $schema: "https://actiondock.dev/schema/v2/actiondock.json",
    schemaVersion: 2,
    id: pkgId,
    name: "fixture-package",
    version: "0.1.0",
    description: options?.description || "Original package description",
    actions: {
      [actionId]: {
        entry: "actions/task.ts",
        description: `${actionId} description`,
        inputSchema: { type: "object", properties: {} },
      },
    },
    ...(options?.playbookId
      ? {
          playbooks: {
            [options.playbookId]: {
              entry: `playbooks/${options.playbookId}.md`,
              description: `${options.playbookId} description`,
            },
          },
        }
      : {}),
  });
  writeFileSync(join(pkgDir, "actions", "task.ts"), "export default async () => ({});\n", "utf-8");
  if (options?.playbookId) {
    mkdirSync(join(pkgDir, "playbooks"), { recursive: true });
    writeFileSync(
      join(pkgDir, "playbooks", `${options.playbookId}.md`),
      `# ${options.playbookId}\n`,
      "utf-8"
    );
  }
}

const CUSTOM_DECLARATION = `---
description: 自定义单包技能描述
---

<!-- actiondock:slot intro -->
> 注意：本技能处于灰度测试中。

<!-- actiondock:slot after-init -->
### 宿主环境特殊声明
此操作包需配置特殊环境变量。

<!-- actiondock:slot after-describe -->
> 参数提示：请参考各 Action 的契约。

<!-- actiondock:slot after-invoke -->
> 调用提示：推荐使用扁平赋值。

<!-- actiondock:slot after-playbooks -->
> 规程执行前请确认系统备份就绪。

<!-- actiondock:slot after-actions -->
### 附加扩展清单
- \`custom.helper\`: 辅助扩展工具

<!-- actiondock:slot append -->
## 团队支持渠道
- Slack: #agent-support
`;

describe("Single package SKILL.custom.md custom declaration", () => {
  let tempDir: string;
  let pkgDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-single-skill-custom-"));
    pkgDir = join(tempDir, "my-pkg");
    mkdirSync(pkgDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("generateSourceSkillMd injects custom sections into matching slots and overrides description", () => {
    const config: ProjectConfig = {
      id: "team.single-ops",
      name: "Single Ops",
      version: "1.0.0",
      description: "原始单包描述",
      playbooksDir: "playbooks",
    } as ProjectConfig;

    const actions = [{ id: "sync-data", description: "同步数据" }];
    const playbooks = [
      { id: "sync-sop", filePath: "playbooks/sync-sop.md", description: "数据同步规程" },
    ];

    const parsed = parseCustomSkillDeclaration(CUSTOM_DECLARATION);
    const md = generateSourceSkillMd(config, actions as any, playbooks as any, {
      customSections: parsed.sections,
      description: parsed.description,
    });

    assert.ok(md.includes("description: 自定义单包技能描述"));
    assert.ok(md.includes("> 注意：本技能处于灰度测试中。"));
    assert.ok(md.includes("### 宿主环境特殊声明"));
    assert.ok(md.includes("> 参数提示：请参考各 Action 的契约。"));
    assert.ok(md.includes("> 调用提示：推荐使用扁平赋值。"));
    assert.ok(md.includes("> 规程执行前请确认系统备份就绪。"));
    assert.ok(md.includes("### 附加扩展清单"));
    assert.ok(md.includes("## 团队支持渠道"));

    const idxIntro = md.indexOf("> 注意：本技能处于灰度测试中。");
    const idxInit = md.indexOf("## ActionDock 运行时");
    const idxAfterInit = md.indexOf("### 宿主环境特殊声明");
    const idxDescribe = md.indexOf("### 动作参数契约按需调阅");
    const idxAfterDescribe = md.indexOf("> 参数提示：请参考各 Action 的契约。");
    const idxInvoke = md.indexOf("### 执行 Action");
    const idxAfterInvoke = md.indexOf("> 调用提示：推荐使用扁平赋值。");
    const idxPlaybooks = md.indexOf("## 业务操作规程");
    const idxAfterPlaybooks = md.indexOf("> 规程执行前请确认系统备份就绪。");
    const idxActions = md.indexOf("## Action 目录");
    const idxAfterActions = md.indexOf("### 附加扩展清单");
    const idxTroubleshoot = md.indexOf("## 故障排查与环境安装指引");
    const idxAppend = md.indexOf("## 团队支持渠道");

    assert.ok(idxIntro > 0);
    assert.ok(idxInit > idxIntro);
    assert.ok(idxAfterInit > idxInit);
    assert.ok(idxDescribe > idxAfterInit);
    assert.ok(idxAfterDescribe > idxDescribe);
    assert.ok(idxInvoke > idxAfterDescribe);
    assert.ok(idxAfterInvoke > idxInvoke);
    assert.ok(idxPlaybooks > idxAfterInvoke);
    assert.ok(idxAfterPlaybooks > idxPlaybooks);
    assert.ok(idxActions > idxAfterPlaybooks);
    assert.ok(idxAfterActions > idxActions);
    assert.ok(idxTroubleshoot > idxAfterActions);
    assert.ok(idxAppend > idxTroubleshoot);
  });

  it("generateStandaloneSkillMd injects custom sections into standalone template", () => {
    const config: ProjectConfig = {
      id: "team.single-ops",
      name: "Single Ops",
      version: "1.0.0",
      description: "原始单包描述",
      playbooksDir: "playbooks",
    } as ProjectConfig;

    const actions = [{ id: "sync-data", description: "同步数据" }];
    const playbooks = [
      { id: "sync-sop", filePath: "playbooks/sync-sop.md", description: "数据同步规程" },
    ];

    const parsed = parseCustomSkillDeclaration(CUSTOM_DECLARATION);
    const md = generateStandaloneSkillMd(config, actions as any, playbooks as any, "node ./entry.mjs", {
      customSections: parsed.sections,
      description: parsed.description,
    });

    assert.ok(md.includes("description: 自定义单包技能描述"));
    assert.ok(md.includes("> 注意：本技能处于灰度测试中。"));
    assert.ok(md.includes("### 宿主环境特殊声明"));
    assert.ok(md.includes("### 附加扩展清单"));
    assert.ok(md.includes("## 团队支持渠道"));
  });

  it("exportSkill applies custom declaration via customMdPath in source mode", async () => {
    createFixturePackage(pkgDir, "team.single-ops", "sync-data", { playbookId: "sync-sop" });
    const customPath = join(tempDir, "custom-rules.md");
    writeFileSync(customPath, CUSTOM_DECLARATION, "utf-8");

    const outDir = join(tempDir, "dist", "exported-skill");
    const result = await exportSkill({
      projectRoot: pkgDir,
      mode: "source",
      outDir,
      customMdPath: customPath,
    });

    assert.strictEqual(result.usedExistingSkillMd, undefined);
    const md = readFileSync(join(outDir, "SKILL.md"), "utf-8");
    assert.ok(md.includes("description: 自定义单包技能描述"));
    assert.ok(md.includes("### 宿主环境特殊声明"));
    assert.ok(md.includes("## 团队支持渠道"));
  });

  it("exportSkill auto-discovers SKILL.custom.md in package root in source mode", async () => {
    createFixturePackage(pkgDir, "team.single-ops", "sync-data");
    writeFileSync(join(pkgDir, "SKILL.custom.md"), CUSTOM_DECLARATION, "utf-8");

    const outDir = join(tempDir, "dist", "exported-skill");
    const result = await exportSkill({
      projectRoot: pkgDir,
      mode: "source",
      outDir,
    });

    assert.strictEqual(result.usedExistingSkillMd, undefined);
    const md = readFileSync(join(outDir, "SKILL.md"), "utf-8");
    assert.ok(md.includes("description: 自定义单包技能描述"));
    assert.ok(md.includes("### 宿主环境特殊声明"));
    assert.ok(md.includes("## 团队支持渠道"));
  });

  it("exportSkill throws BuilderError when customMdPath does not exist", async () => {
    createFixturePackage(pkgDir, "team.single-ops", "sync-data");
    await assert.rejects(
      () =>
        exportSkill({
          projectRoot: pkgDir,
          mode: "source",
          customMdPath: join(tempDir, "non-existent.custom.md"),
        }),
      /Custom skill declaration file not found/
    );
  });

  it("exportSkill prioritizes custom declaration generation over implicit pre-existing SKILL.md", async () => {
    createFixturePackage(pkgDir, "team.single-ops", "sync-data");
    writeFileSync(join(pkgDir, "SKILL.md"), "# Pre-existing SKILL.md\n", "utf-8");
    writeFileSync(join(pkgDir, "SKILL.custom.md"), CUSTOM_DECLARATION, "utf-8");

    const outDir = join(tempDir, "dist", "exported-skill");
    const result = await exportSkill({
      projectRoot: pkgDir,
      mode: "source",
      outDir,
    });

    // 存在自定义声明时，不会被无意遗留的隐式 SKILL.md 阻断生成
    assert.strictEqual(result.usedExistingSkillMd, undefined);
    const md = readFileSync(join(outDir, "SKILL.md"), "utf-8");
    assert.ok(md.includes("description: 自定义单包技能描述"));
    assert.ok(md.includes("### 宿主环境特殊声明"));
  });

  it("exportSkill respects explicit skillMdPath even if SKILL.custom.md exists", async () => {
    createFixturePackage(pkgDir, "team.single-ops", "sync-data");
    const explicitSkillPath = join(tempDir, "explicit-SKILL.md");
    writeFileSync(explicitSkillPath, "# Explicit Static Skill Document\n", "utf-8");
    writeFileSync(join(pkgDir, "SKILL.custom.md"), CUSTOM_DECLARATION, "utf-8");

    const outDir = join(tempDir, "dist", "exported-skill");
    const result = await exportSkill({
      projectRoot: pkgDir,
      mode: "source",
      outDir,
      skillMdPath: explicitSkillPath,
    });

    // 显式指定 skillMdPath 时按用户意图直接复用该文件
    assert.strictEqual(result.usedExistingSkillMd, explicitSkillPath);
    const md = readFileSync(join(outDir, "SKILL.md"), "utf-8");
    assert.ok(md.includes("# Explicit Static Skill Document"));
  });

  it("exportSkill applies custom declaration in node mode", async () => {
    createFixturePackage(pkgDir, "team.single-ops", "sync-data");
    writeFileSync(join(pkgDir, "SKILL.custom.md"), CUSTOM_DECLARATION, "utf-8");

    const outDir = join(tempDir, "dist", "exported-node-skill");
    const result = await exportSkill({
      projectRoot: pkgDir,
      mode: "node",
      outDir,
    });

    assert.strictEqual(result.usedExistingSkillMd, undefined);
    const md = readFileSync(join(outDir, "SKILL.md"), "utf-8");
    assert.ok(md.includes("description: 自定义单包技能描述"));
    assert.ok(md.includes("### 宿主环境特殊声明"));
    assert.ok(md.includes("node ./entry.mjs"));
  });

  it("exportSkill throws BuilderError when skillMdPath and customMdPath are both specified", async () => {
    createFixturePackage(pkgDir, "team.single-ops", "sync-data");
    await assert.rejects(
      () =>
        exportSkill({
          projectRoot: pkgDir,
          mode: "source",
          skillMdPath: "some/static.md",
          customMdPath: "some/custom.md",
        }),
      /cannot be used together/
    );
  });

  it("exportSkill throws BuilderError when explicit skillMdPath does not exist", async () => {
    createFixturePackage(pkgDir, "team.single-ops", "sync-data");
    await assert.rejects(
      () =>
        exportSkill({
          projectRoot: pkgDir,
          mode: "source",
          skillMdPath: join(tempDir, "non-existent-skill.md"),
        }),
      /Skill document file not found/
    );
  });
});
