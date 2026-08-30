# 测试与验证指南

ActionDock 2.0 提供了开箱即用的轻量测试基础设施，让您能够在无需启动真实数据库、无需复杂 Mock 框架的前提下，快速进行高效的单元测试、集成测试与编译契约测试。

---

## 使用 `createTestRuntime` 进行单元测试

`@actiondock/sdk` 内置了 `createTestRuntime` 工具函数，专为 Action 的单元测试打造。

### 核心特性
* **纯内存隔离**：基于 `MemoryStateStore`、`MemoryConfig` 与 `MemoryLogger`，零磁盘读写，执行速度极快（单测通常在 1ms 内完成）。
* **支持初始数据预填**：可在创建测试环境时预填 Mock 配置或初始 State 状态。
* **支持捕获日志与调用链路**：可通过 `runtime.logger.logs` 断言日志输出。

### 单元测试代码示例

在项目的 `tests/` 目录下创建 `tests/github-tools.test.ts`：

```ts
import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import listPrsAction from "../actions/list-prs";
import reviewPrAction from "../actions/review-pr";

describe("GitHub Tools Action 单元测试", () => {
  it("测试 list-prs 正确读取配置并过滤数据", async () => {
    // 创建带有 Mock 配置的轻量测试运行时
    const runtime = createTestRuntime({
      config: {
        GITHUB_TOKEN: "mock-token-xyz",
        DEFAULT_REPO: "owner/repo",
      },
    });

    // 执行 Action
    const result = await runtime.run(listPrsAction, {
      repo: "owner/repo",
      state: "open",
    });

    // 断言返回值
    expect(result.items).toBeDefined();
    expect(result.total).toBeGreaterThanOrEqual(0);

    // 断言日志输出
    expect(runtime.logger.logs.some((l) => l.message.includes("owner/repo"))).toBe(true);
  });

  it("测试 review-pr 复合 Action 正确写入持久化状态", async () => {
    const runtime = createTestRuntime({
      actions: [listPrsAction], // 注册允许组合调用的子 Action
      state: {
        last_reviewed_pr: 100,
      },
    });

    const result = await runtime.run(reviewPrAction, {
      prNumber: 101,
      title: "feat: add support for new feature",
    });

    expect(result.verdict).toBeDefined();

    // 验证 State 状态变更
    const savedState = await runtime.state.get("last_reviewed_pr");
    expect(savedState).toBe(101);
  });
});
```

---

## 运行测试命令

使用 `ac test` 或 `bun test` 执行测试：

```bash
# 运行项目内的所有测试
ac test

# 匹配指定文件名的测试
ac test github-tools

# 查看全仓库单测与覆盖情况
bun test
```

---

## 独立编译契约测试（Contract Testing）

为了确保 Action 在**本地开发态**与**编译后独立二进制态**下的执行结果完全一致，推荐在 CI 中加入契约测试：

```ts
import { describe, expect, it } from "bun:test";
import { buildProject } from "@actiondock/core";

describe("独立编译契约测试", () => {
  it("验证编译后的独立二进制返回标准 JSON Envelope", async () => {
    // 编译独立二进制
    const buildRes = await buildProject({ projectRoot: "." });

    // 直接通过系统进程调用编译产物
    const proc = Bun.spawnSync([buildRes.executablePath, "run", "sample.greet", "--input", '{"name": "CI"}'], {
      stdout: "pipe",
    });

    expect(proc.exitCode).toBe(0);

    // 解析标准输出 JSON Envelope
    const res = JSON.parse(proc.stdout.toString());
    expect(res.ok).toBe(true);
    expect(res.data.message).toContain("CI");
  });
});
```
