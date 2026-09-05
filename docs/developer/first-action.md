# 深入业务 Action 开发

本教程带领开发者编写一个具备真实业务能力的 Action，深入理解从项目初始化、清单契约维护、强类型与模式定义、配置读取、外部请求、状态持久化到标准测试的全流程。

---

## 业务场景描述

实现名为 `github.get-pr` 的 Action：
- 接收仓库全名 `repo` 与 PR 编号 `prNumber` 作为输入参数。
- 从配置体系读取 `GITHUB_TOKEN`。
- 调用 GitHub REST API 获取 Pull Request 详细信息。
- 使用 `ctx.state` 记录最近一次查询时间。
- 返回结构化业务数据，并通过测试套件完成验证。

---

## 脚手架与目录规范

通过初始化命令构建项目：

```bash
ad init my-action
cd my-action
npm install
```

生成的完整结构如下：

```text
my-action/
├── actiondock.json           # 项目元数据与配置声明
├── actiondock.manifest.json  # 声明式元数据清单事实源
├── package.json              # 依赖与标准测试脚本
├── tsconfig.json             # TypeScript 配置
├── .gitignore                # 忽略文件列表
├── actions/                  # Action 源码目录
│   └── get-pr.ts             # 本教程编写的业务 Action
├── playbooks/                # 规程目录
└── tests/                    # 单元测试目录
    └── get-pr.test.ts        # 业务测试用例
```

其中 `package.json` 包含 Node.js 官方标准测试脚本：

```json
{
  "scripts": {
    "test": "node --import tsx --test tests/*.test.ts"
  }
}
```

---

## 清单契约复用与维护

ActionDock 2.0 强制倡导声明式契约驱动。在编写业务代码之前，Action 的契约需在 `actiondock.manifest.json` 中予以声明。

可以通过脚手架命令一键生成源码并注册契约条目：

```bash
ad action create github.get-pr --desc "获取指定 GitHub 仓库的 Pull Request 详细信息" --file get-pr.ts
```

该命令会在 `actiondock.manifest.json` 中自动登记契约：

```json
{
  "schemaVersion": 1,
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
  },
  "assets": []
}
```

### 清单契约复用的核心机制

- **构建规划与静态裁剪**：在执行产物打包时，规划器直接解析静态清单的 `uses` 闭包与输入输出约束，无需执行 Action 的实际业务代码，既安全又高效。
- **协议层无缝暴露**：MCP 适配器直接依据清单暴露工具列表，在服务启动时无需加载全部业务模块即可完成能力就绪通告。
- **模式单点事实源**：清单中的 Schema 契约作为单一事实源，与源码中的 `defineAction` 保持对齐，避免口径漂移。

---

## 编写 Action 源码

在 `actions/get-pr.ts` 中实现业务逻辑：

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

// 声明 Action
export default defineAction<GetPrInput, GetPrOutput>({
  id: "github.get-pr",
  description: "获取指定 GitHub 仓库的 Pull Request 详细信息",

  inputSchema: {
    type: "object",
    properties: {
      repo: {
        type: "string",
        description: "仓库全名，例如 team4u/actiondock",
      },
      prNumber: {
        type: "number",
        description: "Pull Request 编号",
      },
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
    // 1. 读取配置（支持运行期覆盖、内置 SQLite、环境变量与默认值回退）
    const token = ctx.config.get<string>("GITHUB_TOKEN");

    // 2. 输出结构化诊断日志（输出至 stderr，绝不污染 stdout 业务流）
    ctx.log.info(`正在查询 PR #${input.prNumber}（仓库: ${input.repo}）`);

    // 3. 发起网络请求并挂接取消信号
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

    // 4. 状态持久化（存入内嵌状态库，设定生存时间为 3600 秒）
    await ctx.state.set(`last_query:${input.repo}#${input.prNumber}`, now, 3600);

    // 5. 返回符合 outputSchema 契约的业务数据
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

在 `tests/get-pr.test.ts` 中使用 `@actiondock/testing` 与标准测试套件：

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
      // 创建全内存测试沙箱
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

- **清单与源码双轨契约**：静态清单 `actiondock.manifest.json` 供依赖裁剪与工具暴露；源码 `defineAction` 负责运行期强校验与业务实现。
- **配置多级回退**：优先级依次为命令行临时覆写、内置持久化存储、操作系统环境变量、项目配置默认值。
- **通信通道彻底隔离**：标准输出专供结构化 JSON 信封；诊断日志一律经由 `ctx.log` 发射至标准错误输出，防止智能体解析异常。
- **确定性测试先行**：借助 `@actiondock/testing` 与原生 `node:test`，实现无真实外部网络与磁盘污染的高速单测。
