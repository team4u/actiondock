# Agent 开发协作指引 - ActionDock 2.0

- **核心定位**：ActionDock 2.0 是面向 AI Agent Action 与 Skill 的开发、测试、构建与分发工具链。
- **运行时与引擎**：Bun（原生 TypeScript 运行、`Bun.build` 独立编译器、`bun:sqlite` 内置存储）。
- **代码库分层结构**：
  - `packages/sdk`：`@actiondock/sdk`（极简公共 SDK：`defineAction`、`ActionContext`、`Config`、`StateStore`、`ActionInvoker`、`Logger`、`createTestRuntime`）。
  - `packages/core`：`@actiondock/core`（公共领域内核：`project`、`runtime`、`storage`、`schema`、`build`、`export`、`standalone`）。
  - `packages/mcp`：`@actiondock/mcp`（Model Context Protocol 适配器：STDIO/HTTP Transport、Tool 映射、取消链路）。
  - `packages/cli`：`@actiondock/cli`（CLI 门面工具链：`init`、`info`、`action`、`mcp`、`playbook`、`config`、`state`、`runs`、`test`、`build`、`export skill`）。
  - `examples/*`：官方示例 Action Packages。
- **常用验证命令**：
  - 执行所有单元与集成测试：`bun test`
  - 执行全量 TypeScript 类型检查：`bun run typecheck`
- **独立编译契约原则（Standalone Contract）**：
  - 在开发态执行（`actiondock action run`）与构建后的独立可执行文件中，`ActionContext` 的语义、配置优先级、状态持久化与输出 JSON Envelope 格式必须保持严格一致。
- **外部 CLI 执行规范（CLI Execution in Actions & Core）**：
  - **路径解析**：Windows 下 npm 全局命令是 `.cmd` shim，必须通过 `Bun.which("command")` 解析完整绝对路径后再 spawn。
  - **防管道死锁**：外部 CLI 进程（如 browser/daemon/node 子进程）可能遗留子句柄导致异步流 EOF 挂死，调用外部进程应统一采用 `Bun.spawnSync` 同步排空管道。
  - **防阻塞与取消**：必须设置超时兜底，多步执行间检查 `ctx.signal?.aborted` 响应外部取消。非零退出码由业务层灵活判定。
