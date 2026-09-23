# 快速上手指南

ActionDock 2.x 写一次 Action，同时交付 CLI、MCP、HTTP 和 Agent Skill。

内置测试沙箱、状态存储、配置体系、运行追踪与可复现打包。

```text
$ npm install -g @actiondock/cli
$ ad init hello && cd hello
[OK] Initialized ActionDock project in hello

$ ad action create greet --input name:string --output message:string
[OK] Created action greet (actions/greet.ts)
[OK] Generated contract types (.actiondock/generated/actions.d.ts)

$ ad test
[PASS] tests/greet.test.ts (1.2ms, in-memory sandbox)
1 passed, 0 failed

$ ad run greet --json -- name=World
{
  "ok": true,
  "runId": "01JMB394K8V6C1T9A2",
  "data": { "message": "Hello, World!" }
}

$ ad mcp          --> [READY] Model Context Protocol (STDIO/SSE)
$ ad serve        --> [READY] RESTful HTTP Microservice (:8080)
$ ad export skill --> [EXPORT] Self-contained Agent Skill bundle
```

---

## 极简黄金路径

无需手动编写复杂的 JSON Schema，仅需 5 个核心命令即可走通从创建、单测、本地运行到多形态交付的全流程：

- 全局安装命令行工具：
  确保本地 Node.js 版本大于等于 24.12.0，在终端全局安装工具链：
  ```bash
  npm install -g @actiondock/cli
  ```
  安装完成后可验证版本：
  ```bash
  ad --version
  ```

- 初始化项目骨架：
  运行初始化命令并进入生成的项目目录：
  ```bash
  ad init hello
  cd hello
  ```

- 声明并创建 Action：
  直接通过命令行参数声明输入与输出字段，脚手架自动生成强类型契约并维护底层清单，无需手写模式配置：
  ```bash
  ad action create greet --input name:string --output message:string
  ```

- 编写极简业务源码：
  查看自动生成的 `actions/greet.ts` 业务源码，输入与输出自动享受完整的类型提示与校验：
  ```ts
  import { defineAction } from "@actiondock/sdk";
  import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions.d.ts";

  export type Input = ActionInput<"greet">;
  export type Output = ActionOutput<"greet">;

  export default defineAction<Input, Output>(async (input, ctx) => {
    ctx.log.info("Greeting user", input);
    return {
      message: `Hello, ${input.name}!`,
    };
  });
  ```

- 执行纯内存沙箱测试：
  运行单测套件，毫秒级纯内存沙箱与轻量加载机制提供即时反馈：
  ```bash
  ad test
  ```

- 本地命令行即时调用：
  通过本地命令行直接调用动作，验证输入解析与统一数据信封。推荐使用规范的扁平参数赋值协议：
  ```bash
  # 扁平参数规范调用（使用 -- 隔离控制选项与数据入参，推荐）
  ad run greet -- name=World

  # 传递 JSON 标量与结构（:= 递归校验数值为有限数）
  ad run greet -- name=World count:=1

  # 复杂参数推荐使用 JSON 文件传递（与扁平参数互斥）
  ad run greet --input-file input.json

  # 自动化脚本可直接通过标准输入管道传递
  cat input.json | ad run greet --input-file -
  ```
  - 协议边界：`--` 分隔符作为控制平面（ActionDock 选项如 `--json`、`--config`、`--data-dir`、`--profile` 等）与数据平面（Action 入参）的协议边界。
  - 赋值操作符：`path=value` 严格保留为字符串；`path:=json` 严格解析为 JSON 值，递归校验所有数值为有限数（`Number.isFinite`）。
  - 路径语法规则：命名段表示对象属性，纯数字段表示数组连续索引（从 0 开始连续编号，拒绝稀疏数组），根节点始终物化为对象，严格拒绝路径冲突（`INPUT_PATH_CONFLICT`），拦截 `__proto__`、`constructor`、`prototype` 等原型污染敏感属性。
  - 三种输入模式互斥：扁平参数、`--input` 与 `--input-file` 严格互斥，不可混用（`INPUT_CONFLICT`）；未指定输入时默认为 `{}`。
  - 机器输出模式：面向智能体调用推荐使用 `--json`，当参数解析出错时输出标准错误信封并以退出码 2 退出。

  终端标准输出返回统一结构的成功响应信封：
  ```json
  {
    "ok": true,
    "runId": "01JMB394K8V6C1T9A2",
    "data": {
      "message": "Hello, World!"
    }
  }
  ```
  过程日志自动分流至标准错误流，彻底隔离标准输出数据流。

- 一键多形态即刻交付：
  同一份 Action 业务代码无需重写或修改，即可直接交付为多种服务形态：
  ```bash
  # 启动标准 MCP 协议服务，直连 Cursor、Windsurf 或 Claude Desktop
  ad mcp

  # 启动生产级 RESTful HTTP 微服务
  ad serve

  # 导出自包含 Agent 技能包，供智能体客户端索引规程与调用
  ad export skill
  ```

---

## 进阶特性与底层机制

当项目需要深度定制输入输出校验规则、引入持久化状态、编排业务规程或构建独立交付包时，可以进一步使用以下进阶能力。

### 清单契约与手动模式定义

在底层架构中，`actiondock.json` 是项目元数据、动作声明与配置项的唯一事实源。使用 `ad action create` 时工具会自动维护该文件，开发者亦可随时手动修改扩展复杂校验约束：

```json
{
  "$schema": "https://actiondock.dev/schema/v2/actiondock.json",
  "schemaVersion": 2,
  "id": "hello",
  "name": "Hello Tools",
  "version": "0.1.0",
  "config": {
    "DEFAULT_GREETING": {
      "description": "默认问候语前缀",
      "type": "string",
      "default": "Hello"
    }
  },
  "actions": {
    "greet": {
      "entry": "actions/greet.ts",
      "description": "问候用户并记录状态",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "用户名称",
            "minLength": 1
          }
        },
        "required": ["name"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string" },
          "count": { "type": "number" }
        },
        "required": ["message", "count"]
      }
    }
  }
}
```

手动修改清单结构后，执行以下命令即可同步刷新生成的类型契约：

```bash
ad generate types
```

类型生成器将在 `.actiondock/generated/actions.d.ts` 中输出对齐的 TypeScript 接口。

此外，可随时运行 `ad describe <id>` 调阅编码顾问，查看字段模式规范、Flat 编码指引与建议赋值样例展示，辅助人类开发者与智能体准确传参。

### 状态持久化与配置体系

在业务逻辑中，通过 `ctx` 访问运行时提供的状态与配置能力：

```ts
import { defineAction } from "@actiondock/sdk";
import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions.d.ts";

export type Input = ActionInput<"greet">;
export type Output = ActionOutput<"greet">;

export default defineAction<Input, Output>(async (input, ctx) => {
  // 从配置系统读取参数，支持多级回退
  const prefix = ctx.config.get<string>("DEFAULT_GREETING", "Hello");

  // 访问持久化状态存储
  const count = ((await ctx.state.get<number>(`greet:${input.name}`)) || 0) + 1;
  await ctx.state.set(`greet:${input.name}`, count);

  ctx.log.info(`用户 ${input.name} 累计问候 ${count} 次`);

  return {
    message: `${prefix}, ${input.name}!`,
    count,
  };
});
```

### 操作规程与安全边界

为防止大模型在复杂任务中产生幻觉或越权操作，可以在 `playbooks/` 目录下编写纯 Markdown 业务规程：

```markdown
# 用户问候标准作业规程

当会话中有新用户进入时，按以下时序执行：

- 验证用户真实姓名，严禁使用未经核实的匿名代号。
- 调用 greet 执行问候并检索历史频次。
- 若频次大于 1，在回答中体现老用户关怀。
```

规程在导出 Agent 技能包时会自动与动作打包，引导智能体按照人类预设的正确时序与安全边界执行。

### 独立交付包构建

如果需要将项目打包为免全局依赖的独立交付目录，可使用构建命令：

```bash
ad build
```

该命令将分析所有动作依赖，生成包含内嵌生产依赖与入口的独立产物目录，在目标机器上仅需 Node.js 运行时即可直接执行。

### 底层包机制与运行原理

脚手架在底层基于 Node.js 现代原生生态构建：

- 测试底层机制：`ad test` 底层依托 Node.js 原生测试运行器与轻量加载器 `tsx`，支持零编译即时加载测试文件。
- 依赖管理底座：`package.json` 声明基础依赖，供底层 npm 或其他包管理器按需安装，开发者日常开发无需记忆繁琐的包管理命令，统一使用 ad 体系操作即可。
