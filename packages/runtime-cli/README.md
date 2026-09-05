# @actiondock/runtime-cli

ActionDock 2.0 共享运行时命令与输出渲染器。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/runtime-cli` 封装了开发态 CLI 工具链与编译后独立二进制产物通用的核心命令集，以及格式化信封输出渲染器。

---

## 核心定位

为了保证在源码开发模式与独立二进制产物模式下的体验完全一致，ActionDock 采用命令下沉设计：

- 上层门面 `@actiondock/cli` 负责承接 Node.js 命令行调用并集成构建类命令。
- 下沉包 `@actiondock/runtime-cli` 承载所有纯运行时命令，同时被编译打包嵌入到二进制产物中。
- 无论通过源码 `ad` 调用还是直接运行编译后的独立二进制文件，均共享同一套命令逻辑与输出格式。

---

## 共享运行时命令集

- `info`：查看当前项目的元数据配置、Action 列表与 Playbook 规程，支持位置参数模式匹配与树形结构展现。
- `action`：管理与执行 Action，包含 `action list`（列表）、`action show`（详情）、`action validate`（模式验证）以及核心别名 `run`（执行）。
- `playbook`：浏览包内的操作规程，包含 `playbook list`（列表）与 `playbook show`（内容查看）。
- `config`：查看与修改持久化配置，支持按优先级读取和动态更新。
- `state`：检索与维护持久化状态，支持按命名空间隔离、按键名前缀列举、设置存活时间以及批量清理。
- `runs`：查看历史执行记录与链路追踪，包含运行状态、输入快照、输出数据和异常信息。
- `serve`：启动 HTTP 远程调度微服务，提供基于标准 Web 协议的动作调用端点。
- `mcp`：以 STDIO 或 HTTP 协议启动 MCP 服务，将包内 Action 映射为标准 Tool 供智能体调度。

---

## 信封输出渲染器

提供规范的输出格式化与错误处理逻辑：

### 标准化信封结构

当通过 `--envelope` 或 `--json` 参数调用时，渲染器输出符合统一契约的 JSON 信封：

```ts
// 成功响应信封
{
  "ok": true,
  "data": { ... },
  "meta": { ... }
}

// 失败响应信封
{
  "ok": false,
  "error": {
    "code": "INPUT_VALIDATION_FAILED",
    "message": "输入参数未能通过模式校验",
    "details": [ ... ]
  }
}
```

### 控制台友好排版

在默认终端交互模式下，渲染器自动根据数据类型输出排版整齐的人类可读内容：

- 纯文本表格：用于展示 Action 列表、配置项键值、状态记录与运行历史。
- 键值树形图：用于展开显示单条记录的深层嵌套字段。
- 诊断信息格式化：高亮输出错误码、错误提示与调用堆栈建议。

### 退出状态码策略

遵循规范的命令行退出状态码约定：

- `0`：命令成功执行完毕。
- `1`：运行时逻辑异常或业务执行失败。
- `2`：命令行参数校验失败或必填选项缺失。

---

## 开源协议

本项目采用 Apache-2.0 开源协议。
