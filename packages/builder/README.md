# @actiondock/builder

ActionDock 2.x 构建规划、目录交付与技能导出包。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/builder` 负责静态分析依赖关系、构建 Node.js 目录交付产物、打包标准 npm 压缩包以及将工具和规程导出为可分发的 Agent Skill 资产。在 ActionDock 2.x 中，Skill 模板生成与规程渲染能力已统一归位并入本包作为内置支持。

---

## 核心组件与能力

### SelectionPlanner 依赖闭包计算器

通过静态分析依赖关系与 Playbook 规程，无需执行任何业务代码，杜绝模块加载过程中的副作用：

- 规划模型：[SelectionPlanner](./src/planner.ts) 读取 `actiondock.json` 与 Playbook 的 YAML 头部，提取 Actions 与 Playbooks 映射。
- 递归依赖闭包：自顶向下递归解析 Action 的 `uses` 声明列表，构建完整的静态调用图。
- 规程驱动按需剪枝：支持针对特定 Playbook 进行定向打包，自动计算并仅保留该 Playbook 直接或间接调用的最小 Action 集合，实现依赖按需裁剪。
- 静态资产收集：自动识别并关联声明的静态资产文件。

### buildProject 目录交付产物构建

[buildProject](./src/build.ts) 将 Action Package 构建为包含运行入口、依赖闭包与静态资产的 Node.js 目录交付产物：

- 目录交付格式：生成标准 Node.js 可执行目录，无需单文件二进制编译器，天然跨平台兼容。
- 预置生产依赖：支持 `--vendor-deps` 选项，将锁定的生产依赖物化至产物目录内，实现离线自包含运行。
- 可重现构建检验：支持 `--require-reproducible` 选项，当存在不受控的生命周期安装脚本时严格报错阻断，保证构建确定性。
- 标准归档打包：支持 `--archive` 选项，自动将构建目录打包为标准 `.zip` 压缩归档文件。

### packProject npm 包打包

[packProject](./src/pack.ts) 将 Action Package 打包为符合 npm 规范的 `.tgz` 压缩包：

- 标准分发包生成：生成可直接发布至 npm 注册表或通过包管理器安装的 tarball 产物。
- 预检模式：支持 `--dry-run` 选项，完整校验打包清单、动作列表与文件总数，无需实际写入磁盘。
- 完整性校验：自动计算并输出打包产物的字节大小与 SHA-256 校验和。

### SkillExporter 与技能导出

[SkillExporter](./src/exporter.ts)、`exportSkill` 以及 `exportCompositeSkill` 导出函数将原子 Action 与操作规程 Playbook 打包导出为面向主流 AI 智能体生态的标准 Agent Skill 资产：

- 默认单包浅导出机制：默认采用单包源码浅闭包导出，仅复制当前包自身源码与规程，产物清单完整保留 `uses` 跨包逻辑契约，不物理拷贝外部包源码，单包结构纯粹透明，天然支持配合 `playbooks` 或 `actions` 执行规程驱动剪枝。
- 显式外部依赖物化：支持 `bundleDeps` 选项。当显式开启且依赖闭包跨越外部已链接包时，自顶向下递归解析依赖链并将外部依赖包物理物化进产物根目录的 `packages/*` 子目录，展开为自包含的微型工作区产物结构；展开为复合形态时与过滤参数严格互斥（抛出 `FILTERS_UNSUPPORTED_FOR_COMPOSITE` 错误）。
- 独立自包含 Node 目录型导出：支持 `standalone` 选项（等价于 `mode: "node"`），生成免全局 `ad` 命令行工具的自包含目录，内置独立运行脚本与说明书，配合 `vendorDeps` 可实现生产依赖完全内置。
- 本地依赖完整性强校验：严格断言 Action 源码中的相对路径导入。若引用了未在 `actions` 且未在 `files` 字段中声明的本地模块，直接中断构建并抛出 `BuilderError`（错误码 `UNMET_LOCAL_DEPENDENCY`），彻底杜绝缺失依赖的产物分发。
- 生成 SKILL.md 指令：提取 Playbook 规程内容与工具元数据，合成符合智能体规范的操作指南文档与声明头部。
- 复合套件导出与说明书定制：支持 `exportCompositeSkill` 函数将工作区内的多个包统一导出为复合工作区技能套件；支持通过 `customMdPath` 注入插槽定制模板，通过 `skillMdOnly` 实现就地仅原位刷新说明书。
- 压缩归档：支持 `archive` 选项将导出的技能目录打包为 `.zip` 或 `.tar.gz` 格式。

---

## 编程调用示例

```ts
import {
  buildProject,
  packProject,
  SelectionPlanner,
  SkillExporter,
  exportSkill,
  exportCompositeSkill,
} from "@actiondock/builder";

// 计算依赖规划闭包
const planner = new SelectionPlanner({ projectRoot: "/path/to/project" });
const plan = planner.plan({ projectRoot: "/path/to/project", playbooks: ["review-pr"] });

// 构建 Node.js 目录交付产物
const buildResult = await buildProject({
  projectRoot: "/path/to/project",
  outDir: "./dist/delivery",
  archive: true,
});

// 打包为 npm tarball
const packResult = await packProject({
  projectRoot: "/path/to/project",
  outDir: "./dist/npm",
});

// 默认源码单包浅导出（支持规程定向裁剪）
const skillResult = await exportSkill({
  projectRoot: "/path/to/project",
  outDir: "./dist/skills/review-pr",
  playbooks: ["review-pr"],
});

// 显式物化外部依赖导出（展开为微型工作区）
const bundledResult = await exportSkill({
  projectRoot: "/path/to/project",
  outDir: "./dist/skills/bundled",
  bundleDeps: true,
});

// 独立自包含 Node.js 目录型导出（免全局 ad 命令行，物化生产依赖）
const standaloneResult = await exportSkill({
  projectRoot: "/path/to/project",
  outDir: "./dist/skills/standalone",
  standalone: true,
  vendorDeps: true,
});

// 复合套件聚合导出与就地原位刷新说明书
const compositeResult = await exportCompositeSkill({
  bundleName: "vip-agent-tools",
  projectRoots: ["/path/to/pkg-a", "/path/to/pkg-b"],
  outDir: "./dist/composite-skill",
  customMdPath: "/path/to/SKILL.custom.md",
});
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
