import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  generateSourceSkillMd,
  generateStandaloneSkillMd,
  generateCompositeSkillMd,
  RUNTIME_REFERENCE_REL_PATH,
  renderRuntimeReferenceContent,
} from "../src/skill/templates";
import type { ProjectConfig } from "@actiondock/core";

/**
 * 技能说明轻量化验证：
 * - 三种自动模板不展开完整 Schema（formatInputSchema/formatOutputSchema 字段明细）；
 * - 只读与破坏性标注、业务描述与 Playbook 指引保留；
 * - 运行参考文件内容完整且路径单一事实源；
 * - 复合插槽名称与相对位置兼容。
 */

const complexInputSchema = {
  type: "object",
  properties: {
    target: { type: "string", description: "目标主机名" },
    replicas: { type: "number", minimum: 1, maximum: 100 },
    nested: {
      type: "object",
      properties: {
        inner: { type: "array", items: { type: "string" } },
      },
    },
  },
  required: ["target"],
};

const complexOutputSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ok", "failed"] },
    details: { type: "object", properties: { code: { type: "number" } } },
  },
};

const baseConfig: ProjectConfig = {
  id: "pkg.skill-lite",
  name: "Skill Lite",
  version: "1.0.0",
  description: "轻量化技能样本",
  playbooksDir: "playbooks",
} as ProjectConfig;

const actions = [
  {
    id: "deploy",
    description: "部署服务到目标环境",
    inputSchema: complexInputSchema,
    outputSchema: complexOutputSchema,
    annotations: { readOnly: false, destructive: true },
  },
  {
    id: "inspect",
    description: "只读巡检目标状态",
    inputSchema: complexInputSchema,
    annotations: { readOnly: true },
  },
];

const playbooks = [
  {
    id: "release-flow",
    filePath: "playbooks/release.md",
    name: "发布流程",
    description: "标准发布操作规程",
  },
];

describe("技能说明轻量化", () => {
  it("源码型模板不展开完整 Schema，保留标注与业务描述", () => {
    const md = generateSourceSkillMd(baseConfig, actions as any, playbooks as any);

    // 不出现完整字段展开明细（Schema 字段级渲染标记）
    assert.ok(!md.includes("- 输入参数:"));
    assert.ok(!md.includes("- 输出字段:"));
    // 不出现 Schema 内部字段描述文本
    assert.ok(!md.includes("目标主机名"));

    // 能力路由信息保留
    assert.ok(md.includes("pkg.skill-lite/deploy"));
    assert.ok(md.includes("部署服务到目标环境"));
    // 安全标注保留
    assert.ok(md.includes("破坏性操作（执行前须向用户确认）"));
    assert.ok(md.includes("只读操作"));
    // 规程摘要与相对路径保留
    assert.ok(md.includes("release-flow"));
    assert.ok(md.includes("./playbooks/release.md"));
    // describe 调用示例保留
    assert.ok(md.includes("ad describe"));
    // 结果信封说明保留
    assert.ok(md.includes("### 结构化响应解析"));
  });

  it("独立运行型模板不展开完整 Schema", () => {
    const md = generateStandaloneSkillMd(baseConfig, actions as any, playbooks as any, "node ./entry.mjs");

    assert.ok(!md.includes("- 输入参数:"));
    assert.ok(!md.includes("- 输出字段:"));
    assert.ok(!md.includes("目标主机名"));
    assert.ok(md.includes("node ./entry.mjs describe"));
    assert.ok(md.includes("破坏性操作（执行前须向用户确认）"));
  });

  it("复合模板不展开完整 Schema 且插槽名称兼容", () => {
    const md = generateCompositeSkillMd(
      "Lite Suite",
      "复合轻量化套件",
      [
        {
          config: baseConfig,
          actions: actions.map((a) => ({ id: a.id, description: a.description })),
          playbooks: playbooks as any,
          packageDir: "lite",
        },
      ],
      {
        customSections: [{ slot: "after-actions", content: "## 自定义段落\n\n用户自定义内容。" }],
      }
    );

    assert.ok(!md.includes("- 输入参数:"));
    assert.ok(!md.includes("- 输出字段:"));
    // 复合模板槽位内容正确插入 after-actions 位置
    const actionsIdx = md.indexOf("## 可用 Action 工具清单");
    const customIdx = md.indexOf("## 自定义段落");
    assert.ok(actionsIdx > 0);
    assert.ok(customIdx > actionsIdx);
  });

  it("运行参考内容承载完整安装指引与按需排查原则", () => {
    const ref = renderRuntimeReferenceContent({
      dependencyStepLabel: "安装技能源码依赖",
      relinkStepLabel: "完成安装后重新链接本技能",
      invocationStyle: "global-ad",
    });

    assert.ok(ref.includes("npm install -g @actiondock/cli"));
    assert.ok(ref.includes("npm install --omit=dev"));
    assert.ok(ref.includes("ad doctor"));
    assert.ok(ref.includes("ad link"));
    assert.ok(ref.includes("按需排查原则"));
  });

  it("Node 目录型参考使用自身入口，不要求全局安装 ad", () => {
    const ref = renderRuntimeReferenceContent({
      dependencyStepLabel: "安装技能运行目录依赖",
      relinkStepLabel: "完成安装后重新链接本技能",
      invocationStyle: "node-entry",
      entryRelPath: "node ./entry.mjs",
    });

    assert.ok(ref.includes("node ./entry.mjs list"));
    assert.ok(ref.includes("不要求全局安装"));
  });

  it("参考文件路径常量为单一事实源相对路径", () => {
    assert.strictEqual(RUNTIME_REFERENCE_REL_PATH, "references/actiondock-runtime.md");
  });
});

describe("运行参考文件物化与冲突保护", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-ref-file-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("写出参考文件到 references 子目录且可读取", async () => {
    const { writeRuntimeReferenceFile } = await import("../src/export-source");
    writeRuntimeReferenceFile(tempDir, {
      dependencyStepLabel: "安装技能源码依赖",
      relinkStepLabel: "完成安装后重新链接本技能",
      invocationStyle: "global-ad",
    });

    const refPath = join(tempDir, RUNTIME_REFERENCE_REL_PATH);
    assert.strictEqual(existsSync(refPath), true);
    const content = readFileSync(refPath, "utf-8");
    assert.ok(content.includes("npm install -g @actiondock/cli"));
  });

  it("与已有声明资产同路径冲突时报错不覆盖", async () => {
    const { writeRuntimeReferenceFile } = await import("../src/export-source");
    const refPath = join(tempDir, RUNTIME_REFERENCE_REL_PATH);
    mkdirSync(join(tempDir, "references"), { recursive: true });
    writeFileSync(refPath, "用户声明资产内容", "utf-8");

    assert.throws(
      () =>
        writeRuntimeReferenceFile(tempDir, {
          dependencyStepLabel: "安装技能源码依赖",
          relinkStepLabel: "完成安装后重新链接本技能",
          invocationStyle: "global-ad",
        }),
      /conflict|already exists|Refusing/i
    );

    // 用户文件未被覆盖
    assert.strictEqual(readFileSync(refPath, "utf-8"), "用户声明资产内容");
  });
});
