import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateCompositeSkillMd,
  parseCustomSections,
  parseCustomSkillDeclaration,
  type CompositeSkillPackageInfo,
} from "@actiondock/core";
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

    expect(sections.map((s) => s.slot)).toEqual(["append", "after-init", "append"]);
    expect(sections[0].content).toContain("首段无标记内容");
    expect(sections[1].content).toContain("初始化后内容");
    expect(sections[2].content).toContain("末尾内容");
  });

  it("throws on unknown slot names", () => {
    expect(() =>
      parseCustomSections("<!-- actiondock:slot after-inti -->\n内容")
    ).toThrow(/Valid slots/);
  });

  it("parses frontmatter description override", () => {
    const declaration = parseCustomSkillDeclaration(CUSTOM_DECLARATION);
    expect(declaration.description).toBe("自定义复合套件描述");
    expect(declaration.sections.map((s) => s.slot)).toEqual(["after-init", "append"]);
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

    const idxInit = md.indexOf("## ActionDock 运行时初始化");
    const idxSoftLink = md.indexOf("### 数据目录持久化软链");
    const idxDescribe = md.indexOf("## 动作参数契约按需调阅");
    const idxAppend = md.indexOf("## 参考文档");

    expect(idxInit).toBeGreaterThan(-1);
    expect(idxSoftLink).toBeGreaterThan(idxInit);
    expect(idxSoftLink).toBeLessThan(idxDescribe);
    expect(idxAppend).toBeGreaterThan(md.indexOf("## 故障排查与环境安装指引"));

    // frontmatter description 为未覆盖的原始描述
    expect(md).toContain("description: 套件描述");
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

    expect(result.skillMdFile).toBe(join(outDir, "SKILL.md"));
    expect(existsSync(result.skillMdFile!)).toBe(true);
    expect(existsSync(join(outDir, "packages"))).toBe(false);
    expect(existsSync(join(outDir, "package.json"))).toBe(false);
    expect(result.packagesCount).toBe(2);
    expect(result.actionsCount).toBe(2);
    expect(result.playbooksCount).toBe(1);

    const md = readFileSync(result.skillMdFile!, "utf-8");
    expect(md).toContain("description: 自定义复合套件描述");
    expect(md).toContain("`test.pkg-a/a.echo`: a.echo description");
    expect(md).toContain("`test.pkg-b/b.ping`: b.ping description");
    expect(md).toContain("- [pb-a](./pkg-a/playbooks/pb-a.md): pb-a description");

    const idxInit = md.indexOf("## ActionDock 运行时初始化");
    const idxSoftLink = md.indexOf("### 数据目录持久化软链");
    const idxDescribe = md.indexOf("## 动作参数契约按需调阅");
    expect(idxSoftLink).toBeGreaterThan(idxInit);
    expect(idxSoftLink).toBeLessThan(idxDescribe);
    expect(md.indexOf("## 参考文档")).toBeGreaterThan(md.indexOf("## 故障排查与环境安装指引"));
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

    expect(result.usedExistingSkillMd).toBeUndefined();
    const md = readFileSync(join(outDir, "SKILL.md"), "utf-8");
    expect(md).toContain("description: 自定义复合套件描述");
    expect(md).toContain("### 数据目录持久化软链");
    expect(md).toContain("## 参考文档");
    expect(existsSync(join(outDir, "packages", "pkg-a", "actiondock.json"))).toBe(true);
  });
});
