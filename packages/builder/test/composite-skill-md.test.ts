import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateCompositeSkillMd,
  parseCustomSections,
  parseCustomSkillDeclaration,
  type CompositeSkillPackageInfo,
} from "../src/skill";
import { exportCompositeSkill } from "../src/exporter";

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

function createFixturePackage(
  workspaceDir: string,
  dirName: string,
  pkgId: string,
  actionId: string,
  options?: { playbookId?: string }
): void {
  const pkgDir = join(workspaceDir, dirName);
  mkdirSync(join(pkgDir, "actions"), { recursive: true });
  writeJson(join(pkgDir, "actiondock.json"), {
    $schema: "https://actiondock.dev/schema/v2/actiondock.json",
    schemaVersion: 2,
    id: pkgId,
    name: dirName,
    version: "0.1.0",
    description: `${dirName} description`,
    actions: {
      [actionId]: {
        entry: "actions/echo.ts",
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
  writeFileSync(join(pkgDir, "actions", "echo.ts"), "export default async () => ({});\n", "utf-8");
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
description: 自定义复合套件描述
---

<!-- actiondock:slot after-init -->
### 数据目录持久化软链

OpenClaw 宿主专用说明。

<!-- actiondock:slot append -->
## 参考文档

- [ActionDock](https://team4u.github.io/actiondock)
`;

describe("Composite SKILL.md custom declaration", () => {
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-composite-skill-md-"));
    workspaceDir = join(tempDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("parses slot markers and routes leading content to append", () => {
    const sections = parseCustomSections(`首段无标记内容

<!-- actiondock:slot after-init -->
初始化后内容
<!-- actiondock:slot append -->
末尾内容
`);

    assert.deepStrictEqual(sections.map((s) => s.slot), ["append", "after-init", "append"]);
    assert.ok((sections[0].content).includes("首段无标记内容"));
    assert.ok((sections[1].content).includes("初始化后内容"));
    assert.ok((sections[2].content).includes("末尾内容"));
  });

  it("throws on unknown slot names", () => {
    assert.throws(() =>
      parseCustomSections("<!-- actiondock:slot after-inti -->\n内容"), /Valid slots/);
  });

  it("parses frontmatter description override", () => {
    const declaration = parseCustomSkillDeclaration(CUSTOM_DECLARATION);
    assert.strictEqual(declaration.description, "自定义复合套件描述");
    assert.deepStrictEqual(declaration.sections.map((s) => s.slot), ["after-init", "append"]);
  });

  it("injects custom sections at their slots in generated SKILL.md", () => {
    const packages: CompositeSkillPackageInfo[] = [
      {
        config: {
          id: "test.pkg-a",
          name: "Pkg A",
          version: "0.1.0",
          description: "Package A",
        } as CompositeSkillPackageInfo["config"],
        actions: [{ id: "a.echo", description: "Echo action" }],
        playbooks: [{ id: "pb-a", filePath: "pb-a.md", description: "Playbook A" }],
        packageDir: "pkg-a",
      },
    ];

    const md = generateCompositeSkillMd("test-bundle", "套件描述", packages, {
      customSections: parseCustomSkillDeclaration(CUSTOM_DECLARATION).sections,
    });

    const idxDescribe = md.indexOf("## 动作参数契约按需调阅");
    const idxTroubleshoot = md.indexOf("## 故障排查与环境安装指引");
    const idxSoftLink = md.indexOf("### 数据目录持久化软链");
    const idxAppend = md.indexOf("## 参考文档");

    assert.ok(!(md).includes("## ActionDock 运行时初始化"));
    assert.ok((idxDescribe) > -1);
    assert.ok((idxTroubleshoot) > idxDescribe);
    assert.ok((idxSoftLink) > idxTroubleshoot);
    assert.ok((idxAppend) > idxSoftLink);

    // frontmatter description 为未覆盖的原始描述
    assert.ok((md).includes("description: 套件描述"));
  });

  it("skillMdOnly regenerates only SKILL.md from manifests plus custom declaration", async () => {
    createFixturePackage(workspaceDir, "pkg-a", "test.pkg-a", "a.echo", { playbookId: "pb-a" });
    createFixturePackage(workspaceDir, "pkg-b", "test.pkg-b", "b.ping");
    writeFileSync(join(workspaceDir, "SKILL.custom.md"), CUSTOM_DECLARATION, "utf-8");

    const outDir = join(tempDir, "out");
    const result = await exportCompositeSkill({
      bundleName: "test-bundle",
      projectRoots: [join(workspaceDir, "pkg-a"), join(workspaceDir, "pkg-b")],
      outDir,
      workspaceRoot: workspaceDir,
      skillMdOnly: true,
    });

    assert.strictEqual(result.skillMdFile, join(outDir, "SKILL.md"));
    assert.strictEqual(existsSync(result.skillMdFile!), true);
    assert.strictEqual(existsSync(join(outDir, "packages")), false);
    assert.strictEqual(existsSync(join(outDir, "package.json")), false);
    assert.strictEqual(result.packagesCount, 2);
    assert.strictEqual(result.actionsCount, 2);
    assert.strictEqual(result.playbooksCount, 1);

    const md = readFileSync(result.skillMdFile!, "utf-8");
    assert.ok((md).includes("description: 自定义复合套件描述"));
    assert.ok((md).includes("`test.pkg-a/a.echo`: a.echo description"));
    assert.ok((md).includes("`test.pkg-b/b.ping`: b.ping description"));
    assert.ok((md).includes("- [pb-a](./pkg-a/playbooks/pb-a.md): pb-a description"));

    const idxDescribe = md.indexOf("## 动作参数契约按需调阅");
    const idxTroubleshoot = md.indexOf("## 故障排查与环境安装指引");
    const idxSoftLink = md.indexOf("### 数据目录持久化软链");
    assert.ok(!(md).includes("## ActionDock 运行时初始化"));
    assert.ok((idxSoftLink) > idxTroubleshoot);
    assert.ok((md.indexOf("## 参考文档")) > idxSoftLink);
  });

  it("full composite export bakes custom sections into the bundle SKILL.md", async () => {
    createFixturePackage(workspaceDir, "pkg-a", "test.pkg-a", "a.echo");
    const customPath = join(tempDir, "my.custom.md");
    writeFileSync(customPath, CUSTOM_DECLARATION, "utf-8");

    const outDir = join(tempDir, "bundle");
    const result = await exportCompositeSkill({
      bundleName: "test-bundle",
      projectRoots: [join(workspaceDir, "pkg-a")],
      outDir,
      customMdPath: customPath,
    });

    assert.strictEqual(result.usedExistingSkillMd, undefined);
    const md = readFileSync(join(outDir, "SKILL.md"), "utf-8");
    assert.ok((md).includes("description: 自定义复合套件描述"));
    assert.ok((md).includes("### 数据目录持久化软链"));
    assert.ok((md).includes("## 参考文档"));
    assert.strictEqual(existsSync(join(outDir, "packages", "pkg-a", "actiondock.json")), true);
  });
});

