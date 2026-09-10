# 快速上手

本指南面向工具开发者，介绍 Action Package 的初始化、编写规范、单一事实源契约、本地测试与打包交付流程。

---

## 初始化项目骨架

使用 `ad init` 初始化一个全新的 Action Package 项目骨架：

```bash
ad init my-action
cd my-action
npm install
```

初始化生成的项目目录结构如下：

```text
my-action/
├── actiondock.json           # 项目元数据、配置声明与动作清单唯一事实源
├── package.json              # 依赖管理与标准测试脚本
├── tsconfig.json             # TypeScript 现代模块规范配置
├── .gitignore                # 版本管理忽略规则
├── actions/                  # 原子 Action 源码目录
│   └── greet.ts              # 示例 Action 业务执行函数源码
├── playbooks/                # 规程目录
│   └── greet-user.md         # 示例 Playbook 规程
└── tests/                    # 单元测试目录
    └── greet.test.ts         # 测试用例
```

### 标准测试脚本规范

生成的 `package.json` 对齐 Node.js 标准测试规范：

```json
{
  "name": "my-action",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "node --import tsx --test tests/*.test.ts"
  },
  "dependencies": {
    "@actiondock/sdk": "^2.0.2"
  },
  "devDependencies": {
    "@actiondock/testing": "^2.0.2",
    "@types/node": "^22.13.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

在 Node.js 22.13.0 或更高版本底座下，项目默认利用原生 `node:test` 运行器配合 `tsx` 直接加载执行 TypeScript 测试文件，实现零编译等待的亚秒级测试反馈。

---

## 编写 Action 与单一事实源契约

### `actions/` 目录编写规范

- **原子单一职责**：每个 Action 源码文件独立存放于 `actions/` 目录下，负责一项明确具体的工具能力。
- **纯粹执行函数**：源码仅通过 `defineAction` 定义纯粹的 `run` 执行函数与必要的输入输出逻辑，动作的标识、模式定义、标签与依赖声明统一交由 `actiondock.json` 管理。
- **纯粹物理通道**：业务数据仅通过 `run` 方法返回值输出至标准输出；过程日志一律使用 `ctx.log` 写入标准错误输出，严禁使用 `console.log` 混杂输出流。

### `actiondock.json` 单一事实源

在 ActionDock 2.0 中，`actiondock.json`（规范版本 `schemaVersion: 2`）是动作清单、配置项声明与跨包依赖的**唯一事实源**。彻底移除旧版清单，源码不再承载冗余的元数据定义。

示例 `actiondock.json` 清单结构如下：

```json
{
  "$schema": "https://actiondock.dev/schema/v2/actiondock.json",
  "schemaVersion": 2,
  "id": "my-action",
  "name": "My Action Package",
  "version": "0.1.0",
  "description": "问候与演示示例包",
  "config": {
    "SAMPLE_GREETING": {
      "description": "自定义问候语前缀",
      "default": "Hello",
      "type": "string"
    }
  },
  "actions": {
    "sample.greet": {
      "entry": "actions/greet.ts",
      "description": "问候用户的示例动作，演示入参、配置与状态的基本用法",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "被问候者的姓名"
          }
        },
        "required": ["name"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string" },
          "timesGreeted": { "type": "number" }
        },
        "required": ["message", "timesGreeted"]
      },
      "tags": ["sample"]
    }
  }
}
```

### 开发期静态发现原则

ActionDock 遵循开发期静态发现原则：
- **静态发现与能力暴露**：在执行 `ad info`、`ad list`、`ad playbook list` 以及启动 MCP 协议映射时，框架直接读取解析 `actiondock.json` 静态清单，无需也严禁动态执行 Action 的 TypeScript 业务代码，杜绝开发期的副作用与安全风险。
- **构建规划与依赖裁剪**：在执行 `ad build`、`ad pack` 或 `ad export skill` 时，构建引擎基于 `actiondock.json` 中的声明分析依赖闭包并完成静态裁剪。
- **统一模式校验**：外部调用输入与 Action 返回数据均依照 `actiondock.json` 中声明的 JSON Schema 严格校验，杜绝非法入参进入业务执行函数。

### 清单与契约校验 (`ad validate`)

当在项目中调整了配置、新增或修改了 Action 声明与源码入口时，可通过 `ad validate` 校验配置清单的一致性与完整性：

- **校验全量清单契约**：
  ```bash
  ad validate
  ```
  该命令校验当前包中所有 Action 的入口文件存在性、Schema 规范与配置契约。
- **校验指定 Action**：
  ```bash
  ad validate sample.greet
  ```
  在持续集成流水线中针对具体动作进行精准校验。

### Action 源码实现

在 `actions/greet.ts` 中仅定义纯粹的执行处理函数：

```ts
import { defineAction } from "@actiondock/sdk";

interface GreetInput {
  name: string;
}

interface GreetOutput {
  message: string;
  timesGreeted: number;
}

export default defineAction<GreetInput, GreetOutput>(async (input, ctx) => {
  // 读取配置项（具备多级回退）
  const greeting = ctx.config.get<string>("SAMPLE_GREETING", "Hello");

  // 读取并自增状态计数
  const count = ((await ctx.state.get<number>("greet_count")) || 0) + 1;
  await ctx.state.set("greet_count", count);

  // 记录结构化诊断日志（输出至 stderr）
  ctx.log.info(`问候 ${input.name}，累计问候次数：${count}`);

  return {
    message: `${greeting}, ${input.name}!`,
    timesGreeted: count,
  };
});
```

---

## 本地执行与调试

使用 `ad run` 在本地调用并测试 Action：

```bash
ad run sample.greet --input '{"name": "ActionDock"}'
```

输出标准信封结构数据：

```json
{
  "ok": true,
  "runId": "01JXYZ789...",
  "data": {
    "message": "Hello, ActionDock!",
    "timesGreeted": 1
  }
}
```

---

## 运行单元测试

在 `tests/greet.test.ts` 中从 `@actiondock/testing` 导入 `createTestRuntime`，验证 Action 行为：

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import greetAction from "../actions/greet";

describe("greet action", () => {
  it("应当完成问候并累加状态计数", async () => {
    const runtime = createTestRuntime({
      config: { SAMPLE_GREETING: "Hi" },
    });

    const res1 = await runtime.run(greetAction, { name: "Alice" });
    assert.equal(res1.message, "Hi, Alice!");
    assert.equal(await runtime.state.get("greet_count"), 1);

    const res2 = await runtime.run(greetAction, { name: "Bob" });
    assert.equal(res2.message, "Hi, Bob!");
    assert.equal(await runtime.state.get("greet_count"), 2);
  });
});
```

执行测试套件：

```bash
npm test
# 或使用 CLI 门面命令
ad test
```

---

## 引入与复用跨包依赖

在实际开发中，开发者常常需要复用生态中已发布的公共 Action（例如 GitHub 工具集或数据处理工具）。ActionDock 提供受原子事务保护的依赖管理命令：

```bash
ad add @actiondock/example-tools
```

执行该命令后，框架会自动完成以下动作：
- 调用包管理器安装目标依赖至 `node_modules`。
- 校验目标包的 `actiondock.json` 清单规范，并将依赖关系自动记录在当前工程的 `actiondock.json` 中的 `dependencies` 字段。
- 更新单一事实源锁文件 `actiondock.lock.json`，固化依赖包的精确版本与完整性散列。
- 若安装或模式校验失败，底层原子事务机制会自动回滚所有更改，杜绝配置文件损坏。

安装完成后，可以在当前项目的 `actiondock.json` 的 `actions.<id>.uses` 声明依赖项，并在 Action 源码中通过 `ctx.actions.invoke` 安全调度该跨包能力。

若项目后续需要移除该依赖，执行：

```bash
# 支持传入 npm 包名或逻辑包标识符
ad remove @actiondock/example-tools
```

执行移除时，框架具备以下安全保护：
- 反向引用拦截：若当前项目的 Action 的 `uses` 声明或 Playbook 规程仍在调用该依赖，命令将主动拒绝移除并抛出依赖冲突错误，防止误删导致业务故障。
- 契约与锁文件同步：从 `package.json`、`actiondock.json` 与 `actiondock.lock.json` 中同步清理依赖项。
- 历史数据保护：保留该包的历史持久化配置与状态存储命名空间，避免误删导致业务数据丢失。

---

## 打包与交付产物构建

ActionDock 2.0 提供了标准的目录型构建、npm Action 包打包与智能体 Skill 导出工具链：

- Node 目录型交付产物构建（ad build）：
  ```bash
  # 构建标准可运行 Node.js 目录产物
  ad build

  # 生成标准 zip 归档压缩包并物化锁定生产依赖
  ad build --archive --vendor-deps
  ```
  生成包含独立入口、配置隔离和依赖闭包的 Node.js 运行目录或归档文件，方便在任何安装有 Node.js 的服务器或容器环境中部署运行。
- 标准 npm Action 包打包（ad pack）：
  ```bash
  # 生成用于 npm 发布的标准 tarball (.tgz)
  ad pack

  # 执行打包预检
  ad pack --dry-run
  ```
- 导出为 Agent Skill 资产（ad export skill）：
  ```bash
  # 导出源码型 Skill 资产
  ad export skill --mode source

  # 导出自包含 Node 目录型 Skill 资产
  ad export skill --mode node --vendor-deps
  ```
  生成包含标准化 `SKILL.md` 的技能目录，便于消费端智能体快速加载使用。

---

## 下一步导引

- 阅读 [深入业务 Action 开发](file:///root/code/action-dock/docs/developer/first-action.md) 了解真实外部请求、进程管理与持久化。
- 阅读 [编写 Playbook 规程](file:///root/code/action-dock/docs/developer/playbooks.md) 掌握面向智能体的标准化规程沉淀。
- 阅读 [单元测试与沙箱验证](file:///root/code/action-dock/docs/developer/testing.md) 深入探索确定性时钟推进、进程执行模拟与内存存储。
- 阅读 [构建规划与产物导出](file:///root/code/action-dock/docs/developer/build-and-export.md) 了解依赖闭包裁剪、依赖物化与可复现性校验。
