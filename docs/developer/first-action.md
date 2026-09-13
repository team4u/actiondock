# Action 核心模型与开发指南

Action 是 ActionDock 体系中最基础的原子能力单元。

它封装了一个具体的、确定性的任务（如查询数据库、调用第三方 API、处理文本、执行本地命令等），并通过强类型与模式规范约束其输入和输出。本指南系统介绍 Action 的契约设计哲学、`ActionContext` 上下文能力以及端到端的业务开发流程。

---

## Action 定义契约与设计哲学

在 ActionDock 2.0 中，`actiondock.json` 是元数据与契约模式的唯一事实源。每个 Action 的标识、描述、模式校验及依赖均在清单中声明，源码专注于纯粹的业务执行逻辑。

### 动作声明形式

使用 `@actiondock/sdk` 的 `defineAction` 声明业务执行函数。

函数式声明（推荐）：

```ts
import { defineAction } from "@actiondock/sdk";

export interface GreetInput {
  name: string;
}

export interface GreetOutput {
  message: string;
}

export default defineAction<GreetInput, GreetOutput>(async (input, ctx) => {
  return {
    message: `Hello, ${input.name}!`,
  };
});
```

对象式声明：

```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  async run(input, ctx) {
    return {
      message: `Hello, ${input.name}!`,
    };
  },
});
```

---

## ActionContext 运行时上下文

每次执行 Action 时，底层运行时引擎均向 `run` 方法注入全新的 `ActionContext` 实例，提供受控的系统交互能力：

- `ctx.config`：分层配置读取接口，支持运行期覆盖、内置 SQLite、环境变量与默认值多级回退。
- `ctx.state`：持久化键值存储接口，基于当前包命名空间物理隔离，支持存活时间（TTL）自动失效。
- `ctx.actions`：动作相互调用接口，支持级联调度下游 Action，内置调用栈深度限制与环路死锁阻断。
- `ctx.process`：统一受管进程接口，提供短时命令一次性运行 `run`、长期交互进程启动 `start`、独占控制权治理与逐流增量读取能力。
- `ctx.log`：结构化日志输出接口，日志严格输出至标准错误流，彻底隔离标准输出流，杜绝污染 JSON 数据信封。
- `ctx.progress`：阶段进度报告接口，支持实时上报任务进度。
- `ctx.signal`：协作式取消信号 `AbortSignal`，当任务被客户端主动取消或超时时自动触发中止。
- `ctx.run`：当前执行链路元数据，包含 `id`（本次运行标识）、`rootId`（根调用标识）和 `parentId`（父级调用标识）。

---

## 业务 Action 实战开发

以实现 GitHub Pull Request 查询动作 `github.get-pr` 为例：

### 清单声明契约

在 `actiondock.json` 中声明配置项与动作模式：

```json
{
  "$schema": "https://actiondock.dev/schema/v2/actiondock.json",
  "schemaVersion": 2,
  "id": "my-action",
  "name": "GitHub Action Package",
  "version": "0.1.0",
  "description": "GitHub 工具集示例",
  "config": {
    "GITHUB_TOKEN": {
      "description": "GitHub 个人访问令牌",
      "secret": true,
      "type": "string",
      "env": "GITHUB_TOKEN"
    }
  },
  "actions": {
    "github.get-pr": {
      "entry": "actions/get-pr.ts",
      "description": "获取指定 GitHub 仓库的 Pull Request 详细信息",
      "inputSchema": {
        "type": "object",
        "properties": {
          "repo": {
            "type": "string",
            "description": "仓库全名，例如 team4u/actiondock",
            "examples": ["team4u/actiondock"]
          },
          "prNumber": {
            "type": "number",
            "description": "Pull Request 编号",
            "examples": [42]
          }
        },
        "required": ["repo", "prNumber"],
        "examples": [
          { "repo": "team4u/actiondock", "prNumber": 42 }
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "id": { "type": "number" },
          "number": { "type": "number" },
          "title": { "type": "string" },
          "state": { "type": "string" },
          "url": { "type": "string" },
          "lastQueriedAt": { "type": "string" }
        },
        "required": ["id", "number", "title", "state", "url", "lastQueriedAt"]
      }
    }
  }
}
```

> [!TIP]
> 推荐在模式中通过 `examples` 字段提供具体取值样例，帮助智能体精准掌握参数格式与类型预期。

### 编写 Action 业务实现

在 `actions/get-pr.ts` 中实现业务逻辑：

```ts
import { defineAction } from "@actiondock/sdk";

export interface GetPrInput {
  repo: string;
  prNumber: number;
}

export interface GetPrOutput {
  id: number;
  number: number;
  title: string;
  state: string;
  url: string;
  lastQueriedAt: string;
}

export default defineAction<GetPrInput, GetPrOutput>(async (input, ctx) => {
  const token = ctx.config.get<string>("GITHUB_TOKEN");

  ctx.log.info(`正在查询 PR #${input.prNumber}（仓库: ${input.repo}）`);

  const res = await fetch(
    `https://api.github.com/repos/${input.repo}/pulls/${input.prNumber}`,
    {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        "User-Agent": "ActionDock-Agent",
      },
      signal: ctx.signal,
    }
  );

  if (!res.ok) {
    throw new Error(`GitHub API 请求失败，状态码: ${res.status}`);
  }

  const data = (await res.json()) as any;
  const now = new Date().toISOString();

  // 状态持久化记录最近一次查询时间，缓存 3600 秒
  await ctx.state.set(`last_query:${input.repo}#${input.prNumber}`, now, 3600);

  return {
    id: data.id,
    number: data.number,
    title: data.title,
    state: data.state,
    url: data.html_url,
    lastQueriedAt: now,
  };
});
```

---

## 编写确定性单元测试

在 `tests/get-pr.test.ts` 中使用 `@actiondock/testing` 纯内存测试运行时进行验证：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import getPrAction from "../actions/get-pr.js";

describe("github.get-pr 动作测试", () => {
  it("在内存沙箱中执行成功并完成状态记录", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 9999,
          number: 1,
          title: "feat: example pull request",
          state: "open",
          html_url: "https://github.com/team4u/actiondock/pull/1",
        }),
      } as any;
    };

    try {
      const runtime = createTestRuntime({
        config: {
          GITHUB_TOKEN: "mock-test-token",
        },
      });

      const result = await runtime.run(getPrAction, {
        repo: "team4u/actiondock",
        prNumber: 1,
      });

      assert.equal(result.id, 9999);
      assert.equal(result.number, 1);
      assert.equal(result.title, "feat: example pull request");

      const record = await runtime.state.get("last_query:team4u/actiondock#1");
      assert.ok(record);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

---

## 本地执行与模式验证

- 执行静态校验：
  ```bash
  ad validate github.get-pr
  ```

- 执行 Action：
  ```bash
  ad run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 1}'
  ```

标准输出始终返回纯净的 JSON 结果信封，诊断日志全部重定向至标准错误流。
