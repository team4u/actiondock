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
- **独立编译契约原则（Standalone Contract）**：
  - 在开发态执行（`actiondock action run`）与构建后的独立可执行文件中，`ActionContext` 的语义、配置优先级、状态持久化与输出 JSON Envelope 格式必须保持严格一致。
- **外部 CLI 执行规范（CLI Execution in Actions & Core）**：
  - **路径解析**：Windows 下 npm 全局命令是 `.cmd` shim，必须通过 `Bun.which("command")` 解析完整绝对路径后再 spawn。
  - **防管道死锁与后台守护进程**：
    - **普通同步命令**：使用 `execCli` / `Bun.spawnSync` 一次性排空管道并关闭句柄，避免无头进程残留句柄导致异步流挂死。
    - **拉守护进程的命令（如 `agent-browser open`）**：严禁使用带 pipe 的同步等待（daemon 继承 stderr/stdout 句柄常驻导致管道永不 EOF 挂死），必须使用 `spawnDetached`（stdio 全 ignore 异步 fire + `await child.exited` 错开冷启动 + 轮询 probe 确认就绪）；daemon 存活后的后续操作（如 `get/click/type/snapshot`）再使用常规 `execCli`。
  - **防阻塞与取消**：必须设置超时兜底，多步执行间检查 `ctx.signal?.aborted` 响应外部取消。非零退出码由业务层灵活判定。
- **依赖与 Link 规范（Dependencies & Link Contract）**：
  - **契约保持**：`package.json` 始终声明 `"@actiondock/sdk": "^2.0.0"`，**严禁**修改为 `link:` 或相对路径，保证跨机器分发与独立构建一致性。
  - **开发态解析**：未发布 npm 时，全局一次性 `cd packages/sdk && bun link`，新项目内执行 `bun link @actiondock/sdk`。
  - **双 Link 区分**：`ac link` 是 ActionDock 全局路由表注册（跨目录调度 `ac run <pkg>/<action>`）；`bun link` 是 Node/Bun 依赖解析（填充 `node_modules`）。两者职责独立，开发态通常都需要执行。
  - **工作区与子项目自动感知**：`ac link [path]` 支持单包与工作区容器目录。在包含多个子包的目录执行时，会自动注册 Workspace 并扫描子包；后续在工作区内新增子包无需重新 link，全局路由与 `ac info` 自动动态感知。
- **能力发现与模糊探索规范（Capability Discovery with `ac info`）**：
  - **首选探索入口**：Agent 接收到业务操作指令或需要探索可用能力时，**首选执行 `ac info <patterns...>` 或 `ac info -i <pattern>`** 进行意图模糊搜索，先确认有哪些 Package、Action、Playbook 适合当前任务。
  - **决议机制**：唯一命中时自动展开该包完整详情与配置依赖；多项命中时输出匹配包清单；未命中时默认降级展示全量已注册包。

