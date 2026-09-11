# @actiondock/builder

ActionDock 2.0 构建规划、目录交付与技能导出包。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.12.0-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/builder` 负责静态分析依赖关系、构建 Node.js 目录交付产物、打包标准 npm 压缩包以及将工具和规程导出为可分发的 Agent Skill 资产。

---

## 核心组件与能力

### BuildPlanner 依赖闭包计算器

通过静态分析依赖关系与 Playbook 规程，无需执行任何业务代码，杜绝模块加载过程中的副作用：

- 规划模型：[SelectionPlanner](file:///root/code/action-dock/packages/builder/src/planner.ts)（别名 BuildPlanner）读取 `actiondock.json` 与 Playbook 的 YAML 头部，提取 Actions 与 Playbooks 映射。
- 递归依赖闭包：自顶向下递归解析 Action 的 `uses` 声明列表，构建完整的静态调用图。
- 规程驱动按需剪枝：支持针对特定 Playbook 进行定向打包，自动计算并仅保留该 Playbook 直接或间接调用的最小 Action 集合，实现依赖按需裁剪。
- 静态资产收集：自动识别并关联声明的静态资产文件。

### buildProject 目录交付产物构建

[buildProject](file:///root/code/action-dock/packages/builder/src/build.ts) 将 Action Package 构建为包含运行入口、依赖闭包与静态资产的 Node.js 目录交付产物：

- 目录交付格式：生成标准 Node.js 可执行目录，无需单文件二进制编译器，天然跨平台兼容。
- 预置生产依赖：支持 `--vendor-deps` 选项，将锁定的生产依赖物化至产物目录内，实现离线自包含运行。
- 可重现构建检验：支持 `--require-reproducible` 选项，当存在不受控的生命周期安装脚本时严格报错阻断，保证构建确定性。
- 标准归档打包：支持 `--archive` 选项，自动将构建目录打包为标准 `.zip` 压缩归档文件。
- 原单文件二进制编译选项（`--target` 与 `--bytecode`）已彻底删除，统一采用 Node.js 目录交付格式。

### packProject npm 包打包

[packProject](file:///root/code/action-dock/packages/builder/src/pack.ts) 将 Action Package 打包为符合 npm 规范的 `.tgz` 压缩包：

- 标准分发包生成：生成可直接发布至 npm 注册表或通过包管理器安装的 tarball 产物。
- 预检模式：支持 `--dry-run` 选项，完整校验打包清单、动作列表与文件总数，无需实际写入磁盘。
- 完整性校验：自动计算并输出打包产物的字节大小与 SHA-256 校验和。

### SkillExporter 技能导出器

[SkillExporter](file:///root/code/action-dock/packages/builder/src/exporter.ts) 将原子 Action 与操作规程 Playbook 打包导出为面向主流 AI 智能体生态的标准 Agent Skill 资产：

- 生成 SKILL.md 指令：提取 Playbook 规程内容与工具元数据，合成符合智能体规范的操作指南文档与声明头部。
- 源码模式技能导出：使用 `--mode source`（默认模式），保留 TypeScript 源码与依赖声明，适合具备 Node.js 运行环境的智能体容器直接运行。
- 本地依赖完整性强校验：严格断言 Action 源码中的相对路径导入。若引用了未在 `actions` 且未在 `files` 字段中声明的本地模块，直接中断构建并抛出 `BuilderError`（错误码 `UNMET_LOCAL_DEPENDENCY`），彻底杜绝缺失依赖的产物分发。
- 自包含 Node 目录技能导出：使用 `--mode node`，将自包含的 Node.js 交付目录与技能文档一体化打包，开箱即用。
- 复合套件导出：支持 `--bundle` 选项将工作区内的多个包统一导出为复合工作区技能套件。
- 压缩归档：支持 `--archive` 选项将导出的技能目录打包为 `.zip` 或 `.tar.gz` 格式。

---

## 编程调用示例

```ts
import { buildProject, packProject, SelectionPlanner, SkillExporter } from "@actiondock/builder";

// 计算依赖规划闭包
const planner = new SelectionPlanner({ projectRoot: "/path/to/project" });
const plan = planner.createPlan({ playbookId: "review-pr" });

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

// 导出 Agent Skill 资产
const exporter = new SkillExporter({ projectRoot: "/path/to/project" });
const skillResult = await exporter.export({
  outputDir: "./dist/skills",
  playbookId: "review-pr",
  mode: "source",
});
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
