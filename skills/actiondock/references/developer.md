# 参考手册：Action 与规程开发指南

本参考手册面向 ActionDock 工具开发者，涵盖清单契约定义、业务代码实现、运行时上下文 API、级联调度规则以及单元测试规范。

## 内容索引

- [清单契约](#清单契约定义-actiondockjson)
- [类型生成](#自动生成-typescript-类型声明)
- [上下文接口](#运行时上下文-api-速查)
- [级联调用与依赖](#动作级联调用与跨包依赖声明)
- [本地包执行前准备](#本地包执行前准备)
- [命名绑定与远端调用](#动作命名绑定与远端调用)
- [受管进程](#受管进程与系统命令治理)
- [规程编写](#playbook-任务规程编写规范)
- [测试规范](#单元测试与沙箱验证规范)

---

## 清单契约定义 (`actiondock.json`)

每个 Action 包的元数据与输入输出契约必须在工程根目录的 `actiondock.json`（规范版本号为 2）中声明，该文件是包运行时的唯一事实源。

```json
{
  "$schema": "https://actiondock.dev/schema/v2/actiondock.json",
  "schemaVersion": 2,
  "id": "team4u.github-tools",
  "name": "GitHub Tools",
  "version": "2.3.0",
  "description": "GitHub 运维与仓库交互工具集",
  "config": {
    "GITHUB_TOKEN": {
      "type": "string",
      "description": "GitHub 个人访问令牌",
      "secret": true,
      "required": true,
      "env": "GITHUB_TOKEN"
    },
    "MYSQL_*": {
      "type": "object",
      "description": "动态 MySQL 连接配置模板",
      "schema": {
        "type": "object",
        "properties": {
          "host": { "type": "string" },
          "username": { "type": "string" },
          "password": { "type": "string", "secret": true }
        },
        "required": ["host", "username", "password"],
        "additionalProperties": false
      }
    }
  },
  "actions": {
    "list-issues": {
      "entry": "actions/list-issues.ts",
      "description": "获取指定 GitHub 仓库的 Issues 清单",
      "inputSchema": {
        "type": "object",
        "properties": {
          "repo": {
            "type": "string",
            "description": "仓库标识",
            "examples": ["team4u/actiondock"]
          },
          "maxCount": {
            "type": "number",
            "default": 10,
            "examples": [10, 50]
          }
        },
        "required": ["repo"],
        "examples": [
          { "repo": "team4u/actiondock", "maxCount": 20 }
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "items": { "type": "array" },
          "total": { "type": "number", "examples": [1] }
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

- 配置声明规则：
  - 单个 `*` 匹配一个或更多 `[A-Za-z0-9_.-]` 字符；具体键优先，再按模板最长字面前缀、最长后缀选择。模板不允许 `required`、`default`、`env`，不能作为 `get`、`set`、`delete` 的实键。
  - 配置 `schema` 仅支持 `type`（`object`、`array`、`string`、`integer`、`number`、`boolean`）、`properties`、`required`、`additionalProperties`、`items`、`enum`、`minLength`、`maxLength`、`minimum`、`maximum` 与布尔扩展 `secret`。不支持 `$ref`、组合、条件、`default`、`format` 或其他关键字；外层 `type` 与根 `schema.type` 一致，外层 `number` 可以配合 `integer`。
  - 顶层 `secret: true` 隐藏整项；模式中的 `secret: true` 隐藏对应节点。未知字段和类型不符的节点保守隐藏；已经整节点隐藏时不要求 `items` 或 `additionalProperties`。
  - Action 的 `ctx.config.get` 对最终生效值执行模式校验，失败报 `CONFIG_VALUE_INVALID`，错误只包含键名、路径和原因。没有配置时仍返回 `undefined` 或调用方默认值；外层 `required` 只参与诊断。
  - 管理视图不会修改执行原值，也不提供明文读取能力。全局管理脱敏合并各包保护范围；全局写入须通过所有匹配模式。避免将凭据放进清单默认值或枚举约束，对外声明会清理这些敏感内容。
  - `ad config set` 的完整位置值、`--stdin`、扁平赋值及 `--stdin-field` 都先组装完整值，再按模式校验并整键替换，不做部分更新或对象合并。缺少密码等必填字段时报 `CONFIG_VALUE_INVALID` 并保留旧值；字段绑定不意味着保留其他旧字段，完整输入规则见 [cli.md](cli.md#运行时配置与状态持久化-ad-config-ad-state)。

- 清单字段说明：
  - `actions`：声明 Action 标识符、执行源码入口、描述以及输入输出契约。其中 `inputSchema` 与 `outputSchema` 遵循标准 JSON Schema 规范，推荐在字段或根对象层级添加 `examples` 示例数组，增强智能体参数识别精度。
  - `annotations`：可选协议注解元数据。`"actiondock.cli": { "textField": "<field>" }` 指定普通 CLI 默认同步正文，将返回结果的该顶层自有字符串字段输出至 stdout，其余字段输出至 stderr。推荐在 `outputSchema` 中明确声明根对象和必填字符串字段；`ad describe` 展示选择方式，`ad validate` 拦截确定矛盾并报告风险警告。`--json` 保留完整结果，显式 `--text-field` 覆盖默认声明；目录型入口当前忽略该注解，保持原有输出规则。
  - `files`：声明需要随包构建与导出的本地源码或文件目录（如 `src`、`lib` 或辅助模块）。若 Action 内部通过相对路径引用了包内公共模块，必须在此字段声明；未声明的文件在 `ad validate` 与 `ad export skill` 时会触发完整性强校验并直接报错阻断。

---

## 自动生成 TypeScript 类型声明

在 `actiondock.json` 中声明输入输出模式后，通过命令行工具编译生成强类型声明文件，确立单一事实源：

```bash
ad generate types
```

- 契约编译产物：命令将在 `.actiondock/generated/actions.d.ts` 生成对应各 Action 的强类型声明命名空间，包含 `ActionInput<T>` 与 `ActionOutput<T>` 泛型工具类型。
- 脚手架快速起步：使用 `ad action create <id> -i "name:string, count?:number" -o "message:string"` 创建动作时，脚手架会自动完成基础模式登记并触发类型文件刷新。
- 复杂模式深化：命令行 `--input` 与 `--output` 仅支持基础标量类型的扁平简写。若需要添加字段描述（帮助智能体准确识别意图）、枚举约束（`enum`）、嵌套对象结构（`properties`）或数值区间（`minimum`、`maximum`），直接在 `actiondock.json` 中扩展标准 JSON Schema，然后执行 `ad generate types` 刷新类型。

---

## Action 业务实现标准

Action 业务代码必须通过 `defineAction` 默认导出，直接导入并消费生成类型，实现端到端强类型约束：

```typescript
import { defineAction } from "@actiondock/sdk";
import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions.d.ts";

export type Input = ActionInput<"list-issues">;
export type Output = ActionOutput<"list-issues">;

export default defineAction<Input, Output>(async (input, ctx) => {
  // 配置读取：自动遵循多级优先级解析
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

传递给 Action 执行函数的 `ActionContext` 包含以下环境模块：

| 模块名称 | 核心方法签名 | 职责说明 |
| :--- | :--- | :--- |
| `ctx.config` | `get<T>(key: string, defaultValue?: T): T` | 读取配置，遵循 6 级优先级解析；在 Action 内部始终返回未脱敏的完整原值，若有模式则在最终生效值上执行校验 |
| | `has(key: string): boolean` | 检查指定配置项是否存在 |
| `ctx.state` | `get<T>(key: string): Promise<T \| undefined>` | 读取持久化状态数据 |
| | `set<T>(key: string, value: T, ttl?: number): Promise<void>` | 写入状态数据，`ttl` 单位为秒 |
| | `delete(key: string): Promise<boolean>` | 删除指定状态键 |
| | `clear(prefix?: string): Promise<number>` | 清空命名空间或指定前缀下的所有状态 |
| | `keys(prefix?: string): Promise<string[]>` | 列出指定前缀下的所有状态键 |
| | `scope(namespace: string): StateStore` | 派生出隔离命名的子状态存储 |
| `ctx.process` | `run(input: ProcessRunInput, call?: CallOptions): Promise<ProcessRunResult>` | 一次性运行外部命令，超时终止并收集有限输出（详见 [process-execution.md](process-execution.md)） |
| | `start(input: ProcessStartInput, call?: CallOptions): Promise<ProcessStartResult>` | 创建长期受管进程，返回资源元数据与初始游标 |
| | `read(id: string, input: ProcessReadInput, call?: CallOptions): Promise<ReadResult>` | 基于游标读取有界原始输出日志，支持长轮询与断层跳跃 |
| | `write(id: string, input: ProcessWriteInput, call?: CallOptions): Promise<OperationReceipt>` | 向受管进程输入流写入原始字节数据，需持有有效控制令牌 |
| | `stop(id: string, input: ProcessStopInput, call?: CallOptions): Promise<ProcessInfo>` | 优雅终止受管进程并执行跨平台进程树清理 |
| `ctx.actions` | `invoke<I, O>(action: ActionRef \| string, input?: I, options?: ActionInvokeOptions): Promise<O>` | 首参数为字符串或 ActionRef；第三参数可通过 `binding` 选择本地或远端执行目标 |
| `ctx.log` | `info / warn / error / debug(msg: string, data?: unknown): void` | 结构化诊断日志，强制定向至标准错误流 |
| `ctx.progress` | `report(current: number, total?: number, message?: string): void` | 汇报当前执行进度 |
| `ctx.signal` | `signal: AbortSignal` | 协作式中断信号，用于长操作与耗时循环终止 |
| `ctx.run` | `{ id: string; rootId: string; parentId?: string }` | 当前执行任务追踪标识与调用链路快照 |

- 输入解析复用：核心 `resolveInput` 与 `resolveValueInput` 共用解码能力，供 `run`、配置、状态及独立入口复用，不由各命令复制扁平规则。`set` 保留完整位置值的 JSON 或字符串解码，扁平赋值仅在 `--` 后生效；原始字段绑定保留全部文本，沿用管道大小上限与取消语义，已知模式冲突、赋值解析与路径错误先于 stdin 读取或实际写入以退出码 2 拒绝。
- 状态边界：`ad state set` 共用配置写入的输入方式，保留 `-a`、`-n`、`ns:key` 与 `--ttl` 规则，仍整键替换而非合并。`--stdin-field` 只改变输入渠道，不自动加密或脱敏状态；状态读取可能显示原文，不要将配置原值转存到状态并假定仍受配置安全视图保护。

---

## 动作级联调用与跨包依赖声明

Action 之间的相互调度必须通过 `ctx.actions.invoke` 执行，严禁通过物理相对路径直接导入其他 Action 源码：

- 当前宿主内的同包 Action 调用：
  - 默认豁免 `uses`；出于说明或构建裁剪需要显式声明时，使用短标识符，如 `"uses": ["validate-token"]`。
  - 源码短标识符调度：`await ctx.actions.invoke("validate-token", {})`。同包名但跨执行目标的调用不适用此豁免。

- 本机注册表包的使用与跨包引用：
  - 资产挂载与全局共享：在源码模式下，外部 Action 包或导出的浅模式技能分发至宿主机器后，在对应包根目录执行 `ad link .`，登记至本机全局路由表（`~/.actiondock/registry.json`）。该包即可在当前机器内被所有智能体与工程全局共享。
  - 依赖拓扑并入：启用全局链接扫描的宿主可将有效本地注册包纳入依赖图，适用于源码联调。正式工程的本地实现依赖应使用 `ad add` 安装并锁定，不以本机注册表代替可重现的依赖声明；远端依赖另见命名绑定规则。
  - 清单权限显式声明：即使目标包在全局注册表中可见，出于安全治理与闭包防死锁要求，发起调用的 Action 仍必须在其自身的 `actiondock.json` 中声明权限。未声明即调用将被系统拦截并抛出 `UNDECLARED_ACTION_DEPENDENCY` 错误。
  - 清单 uses 字段的三种授权语法：
    - 完全限定形式（推荐）：`"<package-id>/<action-id>"`，精准授权指定动作（如 `"team4u.deploy-tools/health-check"`）。
    - 包级通配形式：`"<package-id>/*"`，授权目标包下的全部动作（如 `"team4u.deploy-tools/*"`）。
    - 裸包名形式：`"<package-id>"`，等效于授权该包下的全部动作（如 `"team4u.deploy-tools"`）。
  - 源码逻辑调度语法：
    ```typescript
    // 方式一：字符串完全限定标识符（推荐）
    const res = await ctx.actions.invoke("team4u.deploy-tools/health-check", { env: "prod" });

    // 方式二：结构化 ActionRef 对象
    const res = await ctx.actions.invoke({
      packageId: "team4u.deploy-tools",
      actionId: "health-check",
    }, { env: "prod" });
    ```
  - 终端直接调用：任意终端目录下均可直接调用已注册的全局动作：
    ```bash
    ad run team4u.deploy-tools/health-check -- env=prod
    ```

- 正式工程的本地依赖：
  - 在工程根目录执行 `ad add <package>` 安装本地实现并锁定版本与内容摘要，写入 `actiondock.lock.json`；同样适用于远端主用、本地备用场景中需要的本地实现。
  - 权限声明与源码调度规则与上述跨包语法完全保持一致。

- 复合包与多包工作区内部引用规范：
  - 工程结构与全局注册：多包复合套件（由 `ad export skill --bundle` 导出或多包工作区）包含多个子包目录（如 `packages/*`），每个子包拥有独立的 `actiondock.json`。在聚合根目录执行 `ad link . -r`（或 `ad link .`）可批量将所有子包登记至全局路由表。
  - 复合包同子包内调用：使用短标识符，清单声明 `"uses": ["local-action"]`，源码调度 `await ctx.actions.invoke("local-action", input)`。
  - 复合包跨子包调用：不同子包具有不同的 `id`，跨子包调用属于标准跨包调度。调用方子包的 Action 清单必须在 `uses` 中声明被调用子包的动作限定名或包名通配符（如 `"uses": ["sub-pkg-b/worker", "sub-pkg-c/*"]`）；源码中必须使用完全限定标识符 `await ctx.actions.invoke("sub-pkg-b/worker", input)`。
  - 严禁物理穿越导入：各子包即使处于同一工作区文件树相邻目录下，也严禁使用相对路径直接 `import` 其他子包的源码，必须通过 `ctx.actions.invoke` 经由运行时分发调度，确保调用链追踪（`rootId`、`parentId`）与取消信号（`ctx.signal`）完整传递。

- 级联调用红线与边界约束：
  - 显式声明原则：跨包或跨目标调用未声明 `uses` 时，即使代码物理可见或已全局挂载，仍会被拦截为 `UNDECLARED_ACTION_DEPENDENCY`；当前宿主内的同包调用保持豁免。
  - 传递依赖隔离原则：若目标包属于间接传递依赖，直接调用将被拦截，除非被直接依赖包可见的 Playbook 显式委托。
  - 纯粹引用原则：`ctx.actions.invoke` 严格仅接受字符串标识符或 `ActionRef` 对象，严禁传入 Action 定义对象或裸函数，违规将抛出 `INVALID_ACTION_REF` 错误。
  - 环路死锁保护：系统内置环路检测与递归配额保护，当调用链成环时抛出 `ACTION_CALL_CYCLE`，派生任务超额时抛出 `ACTION_SUBRUN_LIMIT`。

---

## 本地包执行前准备

本地 `ad run` 为主动作与已发现的本地子动作启用执行前准备：目标授权、环路与配额检查通过后，在首次导入业务模块前检查依赖。`uses` 仅用于授权，未调用的包不会单独触发准备；一次安装仍按安装根的 `package.json` 与工作区配置执行。

若当前工程声明了正式 Action 包依赖，CLI 会在创建宿主前准备建图所需的工程依赖。执行前准备不会改变已组装的宿主快照，安装过程中出现的新 Action 包不会自动注册。已有 `node_modules` 但缺少必需依赖时只报 `DEPENDENCIES_NOT_READY`，不会自动重建。

SDK、`ad serve`、`ad mcp` 默认不新增执行前首装。编程式宿主需要该能力时，在保证建图所需包元数据已可读的前提下，显式传入 `prepareLocalPackage`：

```ts
import { createActionDock } from "@actiondock/core";
import { createLocalPackagePreparer } from "@actiondock/core/project";

const allowInstall = process.env.ACTIONDOCK_AUTO_INSTALL !== "false";
const service = await createActionDock({
  projectRoot: process.cwd(),
  allowInstall,
  prepareLocalPackage: createLocalPackagePreparer({ install: allowInstall }),
});
try {
  const result = await service.execution.run("demo/greet", { name: "Alice" });
  console.log(result);
} finally {
  await service.close();
}
```

- `allowInstall` 控制事务恢复安装；准备器的 `install` 控制执行前首装，两者应使用同一个策略值。`install: false` 仍执行就绪检查。
- 根调用指定 `timeoutMs` 时，准备阶段与后续动作执行共享同一预算：准备超时会先取消安装并等待清理完成，再返回 `ACTION_TIMEOUT` 且不启动业务 handler；准备只消耗部分预算时，动作仅获得剩余预算，不会重新获得完整时限。外部取消与宿主关闭语义不受影响。
- 准备回调接收目标 `identity`、`packageRoot`，以及包含 `signal`、`rootRunId` 的上下文。无物理根目录的运行时与远端目标不会触发回调。
- `createLocalPackagePreparer` 按包实例与快照缓存就绪结果，按根运行与真实安装目录合并在途任务。共享安装成功后，每个包仍须独立检查自己的依赖；共享失败会传给所有等待者，不自动重试或永久缓存失败。
- 一个等待者取消不影响其他等待者；最后一个等待者取消时中止安装，等到底层清理完成才释放工程锁。自定义回调也必须响应 `signal` 并等待清理结束，宿主关闭会等待这些在途准备。
- 子包准备失败不会重跑父动作，也不会撤销父动作此前的副作用。`--no-install` 与 `ACTIONDOCK_AUTO_INSTALL=false` 贯穿 CLI 本地调用链，智能体不得绕过禁装策略手动安装。

---

## 动作命名绑定与远端调用

在同一个 Action 内混合调用本地与远端依赖，或将同一完全限定动作分别调用到多个目标时，保持 `uses` 中的逻辑引用不变，在调用方项目 `.actiondock/bindings.json` 中配置命名绑定：

```ts
await ctx.actions.invoke("pricing/quote", input, { binding: "primary" });
await ctx.actions.invoke("pricing/quote", input, { binding: "fallback" });
```

- SDK 的 `ActionInvokeOptions` 仅包含可选 `binding`，可调用形式 `ctx.actions(ref, input, options)` 同样支持；不传入 Profile、地址或凭证。
- 不指定绑定仅查找 `default`；未配置则保持本地。指定不存在的绑定直接报 `NOT_FOUND`，不自动回退。
- 绑定和 Profile 在执行调用方 Action 的宿主装配时生成快照；`local` 指该宿主，不固定指发起 CLI 的电脑。
- 纯远端依赖不要求安装本地源码；需要本地备用实现时再安装或装载对应包。跨目标调用即使同包名，也必须声明 `uses`。
- 降级由业务显式实现，不能吞掉取消、权限和契约错误；断链后结果可能未知，不能盲目重跑写操作。

完整配置、编程式装配、只读降级示例、运行关联与分布式边界见 [action-bindings.md](action-bindings.md)。

---

## 受管进程与系统命令治理

当 Action 需要调用底层系统命令或与外部进程交互时，严禁使用 Node.js 原生 `node:child_process`，必须使用 `ctx.process` 统一接口。核心规则与交互模式如下（详见 [process-execution.md](process-execution.md)）：

- 一次性执行 `run`：适用于短时有界命令，自动收集有限输出并提供超时强制阻断与缓冲区截断保护，配合 SDK 导出的 `decodeText` 安全解码。
- 长期交互进程 `start`：对于交互式会话（如 REPL、终端交互），通过 `start` 启动后直接调用 `write` 提交指令（进程运行中即可写入）；输出通过游标 `read` 长轮询获取，配合 `createStreamDecoder` 增量多字节解码避免跨分块乱码。
- 确定性测试红线：单元测试中严禁唤起操作系统真实子进程，必须使用 `@actiondock/testing` 提供的 `FakeProcessDriver` 进行确定性全生命周期模拟。

---

## Playbook 任务规程编写规范

Playbook 用于将分散的原子 Action 编排为针对特定业务场景的标准作业流程。规程模板通过 `ad playbook create <id>` 生成，包含清单声明与 Markdown 文件正文两部分：

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

ActionDock 提供了纯内存测试沙箱 `createTestRuntime`，测试执行无需真实网络或外部数据库。针对下游动作依赖与多目标命名绑定，通过 `runtime.actions`（`MockActionInvoker` 实例）进行细粒度模拟、异常注入与调用断言，完整指南参见 [testing.md](testing.md)。

- 内存状态与配置驱动执行：

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

- 下游动作多目标绑定与显式降级模拟：

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ActionDockError } from "@actiondock/core";
import { createTestRuntime } from "@actiondock/testing";
import { defineAction } from "@actiondock/sdk";

const orderAction = defineAction({
  uses: ["pricing/quote"],
  run: async (input: { sku: string }, ctx) => {
    try {
      return await ctx.actions.invoke(
        "pricing/quote",
        { sku: input.sku },
        { binding: "primary" }
      );
    } catch (error: any) {
      if (
        ctx.signal.aborted ||
        !["SERVICE_RESULT_UNKNOWN", "NETWORK_ERROR"].includes(error?.code)
      ) {
        throw error;
      }
      return await ctx.actions.invoke(
        "pricing/quote",
        { sku: input.sku },
        { binding: "fallback" }
      );
    }
  },
});

describe("多目标绑定降级模拟", () => {
  it("主服务异常时降级至本地备用报价并验证调用历史", async () => {
    const runtime = createTestRuntime({ packageId: "order-pkg" });

    // 主服务注入指定可用性故障
    runtime.actions.register(
      "pricing/quote",
      () => {
        throw new ActionDockError(
          "SERVICE_RESULT_UNKNOWN",
          "Primary pricing cluster unavailable"
        );
      },
      { binding: "primary" }
    );

    // 备用服务返回静态结果
    runtime.actions.register(
      "pricing/quote",
      { price: 88, currency: "CNY" },
      { binding: "fallback" }
    );

    const result = await runtime.run(orderAction, { sku: "SKU-99" });
    assert.deepStrictEqual(result, { price: 88, currency: "CNY" });

    // 断言调用历史与参数快照
    const calls = runtime.actions.calls;
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].binding, "primary");
    assert.strictEqual(calls[1].binding, "fallback");
  });
});
```

- 受管子进程事件驱动模拟：针对涉及系统命令与子进程调用的 Action，严禁唤起真实进程，必须使用 `FakeProcessDriver` 进行确定性事件模拟：

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime, FakeProcessDriver } from "@actiondock/testing";
import gitStatusAction from "../actions/git-status.ts";

describe("受管进程执行测试", () => {
  it("使用 FakeProcessDriver 模拟进程输出与退出", async () => {
    const fakeDriver = new FakeProcessDriver();

    fakeDriver.onSpawn = (handle) => {
      handle.emitOutput("stdout", "## main...origin/main\n");
      handle.emitExit({ code: 0, signal: null });
      handle.emitOutputClosed("natural");
    };

    const runtime = createTestRuntime({
      platform: {
        processDriver: fakeDriver,
      } as any,
    });

    const result = await runtime.run(gitStatusAction, {
      workingDirectory: "/workspace",
    });

    assert.equal(result.branch, "main...origin/main");
    assert.equal(fakeDriver.spawnCalls.length, 1);
  });
});
```
