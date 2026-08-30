# Agent 开发协作指引 - ActionDock 2.0

- **核心定位**：ActionDock 2.0 是面向 AI Agent Action 与 Skill 的开发、测试、构建与分发工具链。
- **运行时与引擎**：Bun（原生 TypeScript 运行、`Bun.build` 独立编译器、`bun:sqlite` 内置存储）。
- **代码库分层结构**：
  - `packages/sdk`：`@actiondock/sdk`（极简公共 SDK：`defineAction`、`ActionContext`、`Config`、`StateStore`、`ActionInvoker`、`Logger`、`createTestRuntime`）。
  - `packages/core`：`@actiondock/core`（公共领域内核：`project`、`runtime`、`storage`、`schema`、`build`、`export`、`standalone`）。
  - `packages/cli`：`@actiondock/cli`（CLI 门面工具链：`init`、`info`、`action`、`playbook`、`config`、`state`、`runs`、`test`、`build`、`export skill`）。
  - `examples/*`：官方示例 Action Packages。
- **常用验证命令**：
  - 执行所有单元与集成测试：`bun test`
  - 执行全量 TypeScript 类型检查：`bun run typecheck`
- **独立编译契约原则（Standalone Contract）**：
  - 在开发态执行（`actiondock action run`）与构建后的独立可执行文件中，`ActionContext` 的语义、配置优先级、状态持久化与输出 JSON Envelope 格式必须保持严格一致。
