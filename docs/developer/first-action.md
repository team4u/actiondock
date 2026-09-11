# 深入业务 Action 开发

本指南带领开发者实现一个具备真实外部请求能力的 Action，深入理解从项目初始化、配置声明、单一事实源清单维护、业务执行函数编写、状态持久化到标准单元测试的全流程。

---

## 业务场景描述

实现名为 `github.get-pr` 的 Action：
- 接收仓库全名 `repo` 与 PR 编号 `prNumber` 作为输入参数。
- 从配置体系读取 `GITHUB_TOKEN`。
- 调用 GitHub REST API 获取 Pull Request 详细信息。
- 使用 `ctx.state` 记录最近一次查询时间戳。
- 返回结构化业务数据，并通过测试套件完成验证。

---

## 脚手架创建 Action

在已有 ActionDock 工程中，使用命令行工具脚手架生成动作源码骨架：

```bash
ad new action github.get-pr --desc "获取 GitHub Pull Request 详情与状态"
```

该命令会在 `actions/get-pr.ts` 生成动作执行函数模板，并在 `actiondock.json` 中自动注册动作条目。

---

## `actiondock.json` 单一事实源契约

在 ActionDock 2.0 体系中，根目录下的 `actiondock.json`（规范版本 `schemaVersion: 2`）是动作清单、接口模式与配置项声明的**唯一事实源**。

彻底移除旧版清单，源码不再承载冗余的动作元数据，框架在开发期、构建期和运行期均以 `actiondock.json` 的静态声明为唯一仲裁依据。

### 清单声明规范

在 `actiondock.json` 中完整声明项目元数据、`GITHUB_TOKEN` 配置项以及 `github.get-pr` 动作的接口模式：

```json
{
  "$schema": "https://actiondock.dev/schema/v2/actiondock.json",
  "schemaVersion": 2,
  "id": "my-action",
  "name": "My Action Package",
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
            "description": "仓库全名，例如 team4u/actiondock"
          },
          "prNumber": {
            "type": "number",
            "description": "Pull Request 编号"
          }
        },
        "required": ["repo", "prNumber"]
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
      },
      "uses": [],
      "tags": ["github"]
    }
  }
}
```

### 开发期静态发现原则

ActionDock 倡导开发期静态发现原则：
- **零副作用静态检索**：在执行 `ad info`、`ad list`、`ad playbook list` 以及 MCP 协议工具注册时，系统仅读取分析 `actiondock.json`，严禁动态加载或执行 Action 业务代码，杜绝模块加载副作用。
- **构建规划与静态裁剪**：在执行产物构建（`ad build`）与技能导出（`ad export skill`）时，规划器直接解析 `actiondock.json` 中的 `uses` 闭包与输入输出约束，精确判定打包边界并剔除无用模块。
- **统一接口暴露**：`actiondock.json` 中的 JSON Schema 集中向外部客户端、智能体与控制台暴露统一规范的工具说明。

### 清单契约验证 (`ad validate`)

当调整了 Action 的入参、出参、描述或增删了源码文件时，通过 `ad validate` 进行一致性与模式校验：

- **校验全量清单契约**：
  ```bash
  ad validate
  ```
  校验当前包中所有 Action 的清单契约、入口文件真实存在性与模式规范。
- **校验指定 Action**：
  ```bash
  ad validate github.get-pr
  ```
  在持续集成门禁检查中，精确检验特定 Action 是否完全合规。

---

## 编写 Action 业务源码

在 `actions/get-pr.ts` 中，源码通过 `defineAction` 仅定义纯粹的 `run` 执行函数与必要的输入输出类型逻辑：

```ts
import { defineAction } from "@actiondock/sdk";

// 定义强类型入参接口
export interface GetPrInput {
  repo: string;
  prNumber: number;
}

// 定义强类型出参接口
export interface GetPrOutput {
  id: number;
  number: number;
  title: string;
  state: string;
  url: string;
  lastQueriedAt: string;
}

// 声明 Action 执行函数
export default defineAction<GetPrInput, GetPrOutput>(async (input, ctx) => {
  // 读取配置（支持运行期覆盖、内置 SQLite、环境变量与默认值多级回退）
  const token = ctx.config.get<string>("GITHUB_TOKEN");

  // 输出结构化诊断日志（输出至 stderr，绝不污染 stdout 业务流）
  ctx.log.info(`正在查询 PR #${input.prNumber}（仓库: ${input.repo}）`);

  // 发起网络请求并挂接协作式取消信号
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

  // 状态持久化（存入内嵌状态库，设定生存时间为 3600 秒）
  await ctx.state.set(`last_query:${input.repo}#${input.prNumber}`, now, 3600);

  // 返回符合 outputSchema 契约的业务数据
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

## 本地配置与执行

通过命令行写入持久化配置或配置环境变量：

```bash
# 写入持久化配置
ad config set GITHUB_TOKEN "ghp_mock_token_123"

# 或者设置环境变量
export GITHUB_TOKEN="ghp_mock_token_123"
```

通过 CLI 运行 Action：

```bash
ad run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 1}'
```

输出标准信封结果：

```json
{
  "ok": true,
  "runId": "01JM7X92K4...",
  "data": {
    "id": 123456,
    "number": 1,
    "title": "feat: initialize project",
    "state": "closed",
    "url": "https://github.com/team4u/actiondock/pull/1",
    "lastQueriedAt": "2026-09-01T12:00:00.000Z"
  }
}
```

---

## 编写单元测试

在 `tests/get-pr.test.ts` 中，从 `@actiondock/testing` 导入 `createTestRuntime`，并结合标准测试套件进行确定性验证：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import getPrAction from "../actions/get-pr";

describe("github.get-pr Action 单元测试", () => {
  it("在内存沙箱中执行成功并完成状态记录", async () => {
    // 模拟全局网络请求
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
      // 创建全内存测试沙箱并注入初始配置
      const runtime = createTestRuntime({
        config: {
          GITHUB_TOKEN: "mock-test-token",
        },
      });

      // 执行 Action 并解包结果
      const result = await runtime.run(getPrAction, {
        repo: "team4u/actiondock",
        prNumber: 1,
      });

      // 断言业务返回值
      assert.equal(result.id, 9999);
      assert.equal(result.number, 1);
      assert.equal(result.title, "feat: example pull request");

      // 断言持久化状态已存入内存库
      const record = await runtime.state.get("last_query:team4u/actiondock#1");
      assert.ok(record);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

运行测试：

```bash
npm test
```

---

## 规范要点总结

- **单一事实源原则**：`actiondock.json` 是动作声明、Schema 契约与配置的唯一事实源；源码通过 `defineAction` 专注于纯业务函数实现。通过 `ad validate` 执行一致性门禁校验。
- **配置多级回退**：优先级依次为命令行临时覆写、内置持久化存储、操作系统环境变量、项目配置默认值。
- **通信通道彻底隔离**：标准输出专供结构化 JSON 信封；诊断日志一律经由 `ctx.log` 发送至标准错误输出，防止智能体解析异常。
- **确定性测试先行**：借助 `@actiondock/testing` 与原生 `node:test`，实现无真实外部网络与磁盘污染的高速单测。
