# Agent 开发协作指引 - ActionDock 2.0

- **核心定位**：ActionDock 2.0 是面向 AI Agent Action 与 Skill 的开发、测试、构建与分发工具链。
- **运行时与引擎**：Bun（原生 TypeScript 运行、`Bun.build` 独立编译器、`bun:sqlite` 内置存储）。
- **代码库分层结构**：
  - `packages/sdk`：`@actiondock/sdk`（极简公共 SDK：`defineAction`、`ActionContext`、`execCli`、`spawnDetached`、`Config`、`StateStore`、`ActionInvoker`、`Logger`、`createTestRuntime`）。
  - `packages/core`：`@actiondock/core`（公共领域内核：`project`、`runtime`、`storage`、`schema`、`build`、`export`、`standalone`）。
  - `packages/mcp`：`@actiondock/mcp`（Model Context Protocol 适配器：STDIO/HTTP Transport、Tool 映射、取消链路）。
  - `packages/cli`：`@actiondock/cli`（CLI 门面工具链：`init`、`info`、`action`、`mcp`、`playbook`、`config`、`state`、`runs`、`test`、`build`、`export skill`）。
  - `examples/*`：官方示例 Action Packages。
- **常用验证命令**：
  - 执行所有单元与集成测试：`bun test`
  - 执行全量 TypeScript 类型检查：`bun run typecheck`
- **文档与输出风格规范**：
  - **禁止使用数字序号**：排版一律采用无序列表符号（`- `），不得使用数字列表（如 `1.`、`2.`、`3.`）。
  - **严禁使用表情符号**：严禁在文档或输出中添加任何表情符号与图标。
  - **杜绝中英文夹杂**：标题、括号及正文中不得添加非必要的英文翻译和短语，仅保留必要的类名、方法名、包名、命令与专有名词。
  - **严禁粗体嵌套行内代码**：严禁在 Markdown 粗体标签内部嵌套行内代码反引号，反引号会导致文档解析引擎破坏粗体闭合标签并直接渲染出原始双星号；行内代码必须独立于粗体之外书写。
  - **规范术语表述**：严禁使用「制品」等生硬词汇，统一表述为「框架」、「产物」或「资产」等规范清晰术语。

