# 编写你的第一个业务 Action

本教程将带领您编写一个具备真实业务能力的 Action，涵盖输入输出校验、配置读取、状态持久化、日志输出与单元测试。

---

## 业务场景：GitHub PR 审查工具

我们将实现一个名为 `github.get-pr` 的 Action：
1. 接收 `repo`（仓库全名）与 `prNumber`（PR 编号）。
2. 从配置读取 `GITHUB_TOKEN`。
3. 调用 GitHub REST API 获取 PR 详情。
4. 使用 `ctx.state` 记录最近一次查询时间。
5. 返回结构化结果。

---

## 1. 定义 Action

在 `actions/get-pr.ts` 中写入以下代码：

```ts
import { defineAction } from "@actiondock/sdk";

// 1. 定义强类型接口
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

// 2. 声明 Action
export default defineAction<GetPrInput, GetPrOutput>({
  id: "github.get-pr",
  description: "获取指定 GitHub 仓库的 Pull Request 详细信息",

  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "仓库全名 (例如 team4u/actiondock)" },
      prNumber: { type: "number", description: "PR 编号" },
    },
    required: ["repo", "prNumber"],
  },

  outputSchema: {
    type: "object",
    properties: {
      id: { type: "number" },
      number: { type: "number" },
      title: { type: "string" },
      state: { type: "string" },
      url: { type: "string" },
      lastQueriedAt: { type: "string" },
    },
    required: ["id", "number", "title", "state", "url", "lastQueriedAt"],
  },

  async run(input, ctx) {
    // A. 读取配置 (环境变量、SQLite 或项目默认值)
    const token = ctx.config.get<string>("GITHUB_TOKEN");

    // B. 输出结构化日志 (走 stderr，绝不污染 stdout 数据流)
    ctx.log.info(`正在查询 PR #${input.prNumber} (仓库: ${input.repo})`);

    // C. 发起网络请求 (透传 ctx.signal 以支持协作式取消)
    const res = await fetch(`https://api.github.com/repos/${input.repo}/pulls/${input.prNumber}`, {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        "User-Agent": "ActionDock-Agent",
      },
      signal: ctx.signal,
    });

    if (!res.ok) {
      throw new Error(`GitHub API 请求失败: HTTP ${res.status}`);
    }

    const data = (await res.json()) as any;
    const now = new Date().toISOString();

    // D. 状态持久化 (存储到内置 SQLite)
    await ctx.state.set(`last_query:${input.repo}#${input.prNumber}`, now);

    return {
      id: data.id,
      number: data.number,
      title: data.title,
      state: data.state,
      url: data.html_url,
      lastQueriedAt: now,
    };
  },
});
```

---

## 2. 配置与本地运行

设置环境变量或项目配置：

```bash
# 方式 A：设置环境变量
export GITHUB_TOKEN="ghp_xxx"

# 方式 B：写入 ActionDock SQLite 配置库
ac config set GITHUB_TOKEN "ghp_xxx"
```

运行 Action：

```bash
ac run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 1}'
```

查看 stdout 输出：
```json
{
  "ok": true,
  "runId": "01JM7X...",
  "data": {
    "id": 123456,
    "number": 1,
    "title": "feat: initial commit",
    "state": "closed",
    "url": "https://github.com/team4u/actiondock/pull/1",
    "lastQueriedAt": "2026-08-30T12:00:00.000Z"
  }
}
```

---

## 3. 编写极速纯内存单元测试

在 `tests/get-pr.test.ts` 中使用 `@actiondock/sdk` 提供的 `createTestRuntime`：

```ts
import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import getPrAction from "../actions/get-pr";

describe("github.get-pr Action", () => {
  it("可以在内存沙箱中秒级执行与验证", async () => {
    // 1. 初始化纯内存测试运行时（无需启动真实数据库或网络服务）
    const runtime = createTestRuntime({
      config: {
        GITHUB_TOKEN: "mock-token",
      },
    });

    // 2. 在测试沙箱中执行
    const result = await runtime.run(getPrAction, {
      repo: "team4u/actiondock",
      prNumber: 1,
    });

    // 3. 断言执行结果
    expect(result.number).toBe(1);
    expect(result.state).toBeDefined();

    // 4. 断言持久化状态已写入内存 SQLite
    const lastQuery = await runtime.state.get("last_query:team4u/actiondock#1");
    expect(lastQuery).toBeDefined();
  });
});
```

执行测试：
```bash
bun test
```
耗时通常小于 5ms。

---

## 核心机制总结

1. **类型与校验一体**：TypeScript 类型负责编码期推导，JSON Schema 负责运行期 Ajv 拦截与 LLM 发现。
2. **5 级配置解析**：`ctx.config` 自动依序回退（调用覆盖 > SQLite 存储 > 环境变量 > 项目默认值 > 代码兜底）。
3. **物理通道隔离**：业务数据走 `stdout`，诊断日志走 `stderr`，彻底避免大模型解析报错。
