# @actiondock/builder

ActionDock 2.0 构建规划、编译器调度与技能导出包。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/builder` 负责静态分析依赖关系、调度外部 Bun 编译器管线以及将工具和规程打包导出为可分发的 Agent Skill 资产。

---

## 核心组件与能力

### BuildPlanner 依赖闭包计算器

通过纯文本与声明式元数据静态分析依赖关系，无需执行任何用户 TypeScript 业务代码，杜绝模块加载过程中的副作用：

- **清单事实源驱动**：读取 `actiondock.manifest.json` 与 Playbook 的 YAML 头部，精确提取 Actions 与 Playbooks 映射。
- **递归依赖闭包**：自顶向下递归解析 Action 的 `uses` 声明列表，构建完整的静态调用图。
- **规程驱动按需剪枝**：支持针对特定 Playbook 进行定向打包，自动计算并仅保留该 Playbook 直接或间接调用的最小 Action 集合，实现 Tree-shaking 瘦身。
- **静态资产收集**：自动识别并关联清单中声明的外部静态资产文件。

### BunCompiler 外部编译器调度器

封装对外部 Bun 编译器的调度，将 Action Package 编译为目标平台的单文件独立二进制产物：

- **前置参数严密校验**：在发起编译前严格校验入口文件有效性、输出目录权限、字节码编译标志与代码混淆压缩参数。
- **跨平台目标架构适配**：支持指定跨平台交叉编译目标架构，覆盖 `linux-x64`、`linux-arm64`、`darwin-x64`、`darwin-arm64`、`windows-x64` 等主流平台。
- **编译器调用与错误归一化**：通过外部进程安全调度 `bun build --compile`，捕获编译器标准错误输出并转换为结构化错误代码。
- **构建元数据提取**：自动计算产物文件的字节大小、耗时以及 SHA-256 校验和。

### SkillExporter 技能导出器

将原子 Action 与操作规程 Playbook 打包导出为面向主流 AI 智能体生态的标准 Agent Skill 资产：

- **生成 SKILL.md 文档**：提取 Playbook SOP 内容与工具元数据，合成符合智能体规范的操作指南文档与声明头部。
- **源码模式技能导出**：保留 TypeScript 源码与依赖声明，适合在具备 Node.js 运行环境的智能体容器中直接运行。
- **独立二进制模式技能导出**：内嵌经过编译的单文件可执行产物，智能体宿主无需安装 Node.js 或 Bun 即可开箱即用。
- **标准压缩归档**：支持将导出的技能目录无缝归档打包为 `.zip` 或 `.tar.gz` 压缩格式，便于分发上传。

---

## 编程调用示例

```ts
import { BuildPlanner, BunCompiler, SkillExporter } from "@actiondock/builder";

// 计算依赖规划闭包
const planner = new BuildPlanner({ projectRoot: "/path/to/project" });
const plan = planner.createPlan({ playbookId: "review-pr" });

// 调度外部编译器
const compiler = new BunCompiler();
const buildResult = await compiler.compile({
  entrypoint: plan.entrypoint,
  outfile: "./dist/review-pr-tool",
  minify: true,
});

// 导出便携式技能
const exporter = new SkillExporter({ projectRoot: "/path/to/project" });
const exportResult = await exporter.export({
  outputDir: "./dist/skills",
  playbookId: "review-pr",
  standalone: true,
});
```

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
