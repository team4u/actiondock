# 参考手册：Action 与规程开发指南

本参考手册面向 ActionDock 工具开发者，涵盖清单契约定义、业务代码实现、运行时上下文 API、级联调度规则以及单元测试规范。

---

## 清单契约定义 (`actiondock.json`)

每个 Action 包的元数据与输入输出契约必须在工程根目录的 `actiondock.json`（规范版本号为 2）中声明，该文件是包运行时的唯一事实源。

```json
{
  "$schema": "https://actiondock.dev/schema/v2/actiondock.json",
  "schemaVersion": 2,
  "id": "team4u.github-tools",
  "name": "GitHub Tools",
  "version": "2.2.0",
  "description": "GitHub 运维与仓库交互工具集",
  "config": {
    "GITHUB_TOKEN": {
      "type": "string",
      "description": "GitHub 个人访问令牌",
      "secret": true,
      "required": true,
      "env": "GITHUB_TOKEN"
    }
  },
  "actions": {
    "list-issues": {
      "entry": "actions/list-issues.ts",
      "description": "获取指定 GitHub 仓库的 Issues 清单",
      "inputSchema": {
        "type": "object",
        "properties": {
          "repo": { "type": "string", "description": "仓库标识" },
          "maxCount": { "type": "number", "default": 10 }
        },
        "required": ["repo"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "items": { "type": "array" },
          "total": { "type": "number" }
        },
        "required": ["items", "total"]
      },
      "uses": ["validate-token"]
    },
    "validate-token": {
      "entry": "actions/validate-token.ts",
      "description": "校验当前访问令牌有效性",
      "inputSchema": {
        "type": "object",
        "properties": {}
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "valid": { "type": "boolean" }
        },
        "required": ["valid"]
      }
    }
  },
  "files": [
    "src"
  ]
}
```

- 清单字段说明：
  - `actions`：声明 Action 标识符、执行源码入口、描述以及输入输出契约。
  - `files`：声明需要随包构建与导出的本地源码或文件目录（如 `src`、`lib` 或辅助模块）。若 Action 内部通过相对路径引用了包内公共模块，必须在此字段声明；未声明的文件在 `ad validate` 与 `ad export skill` 时会触发完整性强校验并直接报错阻断。

---

## Action 业务实现标准

Action 业务代码必须通过 [`defineAction`](file:///root/code/action-dock/packages/sdk/src/action.ts) 默认导出，显式声明输入与输出类型契约：

```typescript
import { defineAction } from "@actiondock/sdk";

export interface Input {
  repo: string;
  maxCount?: number;
}

export interface Output {
  items: Array<{ id: string; title: string }>;
  total: number;
}

export default defineAction<Input, Output>(async (input, ctx) => {
  // 配置读取：自动遵循 5 级优先级解析
  const token = ctx.config.get<string>("GITHUB_TOKEN");

  // 持久化状态：跨生命周期持久化存储（支持秒级过期 TTL）
  const lastSync = await ctx.state.get<string>("last_sync");
  await ctx.state.set("last_sync", new Date().toISOString(), 3600);

  // 结构化日志：强制定向至标准错误流，严禁使用 console.log 污染标准输出
  ctx.log.info(`正在抓取仓库数据: ${input.repo}`);

  // 进度报告：向上层调用者汇报执行百分比
  ctx.progress.report(1, 10, "正在连接服务接口");

  // 响应式取消：检测超时中断与调用方取消信号
  if (ctx.signal.aborted) {
    throw new Error("任务已被调用方中止");
  }

  // 动作级联调用：严格仅接受动作标识符或 ActionRef，严禁传入动作定义对象
  await ctx.actions.invoke("validate-token", {});

  return {
    items: [],
    total: 0,
  };
});
```

---

## 运行时上下文 API 速查

传递给 Action 执行函数的 [`ActionContext`](file:///root/code/action-dock/packages/sdk/src/types.ts) 包含以下环境模块：

| 模块名称 | 核心方法签名 | 职责说明 |
| :--- | :--- | :--- |
| `ctx.config` | `get<T>(key: string, defaultValue?: T): T` | 读取配置，自动遵循 5 级优先级解析 |
| | `has(key: string): boolean` | 检查指定配置项是否存在 |
| `ctx.state` | `get<T>(key: string): Promise<T \| undefined>` | 读取持久化状态数据 |
| | `set<T>(key: string, value: T, ttl?: number): Promise<void>` | 写入状态数据，`ttl` 单位为秒 |
| | `delete(key: string): Promise<boolean>` | 删除指定状态键 |
| | `clear(prefix?: string): Promise<number>` | 清空命名空间或指定前缀下的所有状态 |
| | `keys(prefix?: string): Promise<string[]>` | 列出指定前缀下的所有状态键 |
| | `scope(namespace: string): StateStore` | 派生出隔离命名的子状态存储 |
| `ctx.process` | `exec(command: string, args?: string[], options?: ProcessExecOptions): Promise<ProcessResult>` | 执行外部命令，具备超时、取消与缓冲区超限保护 |
| | `spawn(command: string, args?: string[], options?: ProcessExecOptions): Promise<ProcessResult>` | 启动外部命令子进程，返回标准化结果 |
| `ctx.actions` | `invoke<I, O>(action: ActionRef \| string, input?: I): Promise<O>` | 级联调用其他 Action，严格仅接受字符串 ID 或 ActionRef |
| `ctx.log` | `info / warn / error / debug(msg: string, data?: unknown): void` | 结构化诊断日志，强制定向至标准错误流 |
| `ctx.progress` | `report(current: number, total?: number, message?: string): void` | 汇报当前执行进度 |
| `ctx.signal` | `signal: AbortSignal` | 协作式中断信号，用于长操作与耗时循环终止 |
| `ctx.run` | `{ id: string; rootId: string; parentId?: string }` | 当前执行任务追踪标识与调用链路快照 |

---

## 动作级联调用与依赖声明

Action 之间的相互调度必须通过 `ctx.actions.invoke` 执行，严禁通过物理相对路径直接导入其他 Action 源码：

- 同包内部 Action 调用：
  - 在发起方 Action 的 `uses` 清单中填入目标 Action 的短标识符。
  - 源码中直接通过标识符调度：`await ctx.actions.invoke("validate-token", {})`。
- 跨包外部 Action 调用：
  - 在工程根目录执行 `ad add <package>` 安装并锁定外部包，更新 `actiondock.lock.json`。
  - 在发起方 Action 的 `uses` 清单中填入目标 Action 的完全限定标识符。
  - 源码中使用完全限定标识符或结构化 `ActionRef` 调度：
    ```typescript
    // 方式一：字符串完全限定标识符
    const res = await ctx.actions.invoke("team4u.deploy-tools/health-check", { env: "prod" });

    // 方式二：结构化 ActionRef 对象
    const res = await ctx.actions.invoke({
      packageId: "team4u.deploy-tools",
      actionId: "health-check",
    }, { env: "prod" });
    ```
- 级联调用红线与边界约束：
  - 显式声明原则：未在清单 `uses` 中声明的级联调用，即使目标代码物理可见，执行时也会被系统拦截并抛出 `UNDECLARED_ACTION_DEPENDENCY` 错误。
  - 纯粹引用原则：`ctx.actions.invoke` 严格仅接受字符串标识符或 `ActionRef` 对象，严禁传入 Action 定义对象或裸函数，违规将抛出 `INVALID_ACTION_REF` 错误。
  - 环路死锁保护：系统内置环路检测与递归配额保护，当调用链成环时抛出 `ACTION_CALL_CYCLE`，派生任务超额时抛出 `ACTION_SUBRUN_LIMIT`。

---

## Playbook 任务规程编写规范

Playbook 用于将分散的原子 Action 编排为针对特定业务场景的标准作业流程。规程模板通过 `ad new playbook <id>` 生成，包含清单声明与 Markdown 文件正文两部分：

```markdown
# 业务部署流水线标准规程

本文档规范生产环境服务部署的标准操作步骤。

## 前置环境检查
调用健康检查动作确认集群可用性：
- 目标 Action：\`team4u.deploy-tools/health-check\`

## 执行构建部署
执行打包产物发布：
- 目标 Action：\`team4u.deploy-tools/release\`

## 验证与回滚预案
检查应用健康状态并在异常时自动回滚。
```

规程引用的所有 Action 标识符必须在对应项目的 `actiondock.json` 的 `playbooks.<id>.actions` 节点中完整登记，并执行 `ad playbook validate` 确保全部引用真实存在。

---

## 单元测试与沙箱验证规范

ActionDock 提供了纯内存测试沙箱 [`createTestRuntime`](file:///root/code/action-dock/packages/testing/src/runtime.ts)，测试执行无需真实网络或外部数据库：

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import listIssuesAction from "../actions/list-issues.ts";

describe("team4u.github-tools/list-issues", () => {
  it("使用模拟配置与内存状态执行成功", async () => {
    const runtime = createTestRuntime({
      config: { GITHUB_TOKEN: "mock-token-value" },
      state: { last_sync: "2026-01-01T00:00:00Z" },
    });

    const result = await runtime.run(listIssuesAction, {
      repo: "team4u/actiondock",
    });

    assert.equal(result.total, 0);
  });
});
```
