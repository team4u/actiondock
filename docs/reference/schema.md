# 参考手册：actiondock.json 清单规范

在 ActionDock 2.0 体系中，位于工程根目录的 `actiondock.json` 是项目元数据、配置项声明、跨包依赖、原子动作契约与操作规程映射的唯一事实源。

框架在静态检索（`ad info`、`ad list`）、运行期入参出参模式校验、构建依赖静态裁剪（`ad build`）与技能导出（`ad export skill`）时，统一以 `actiondock.json` 作为唯一仲裁依据。

---

## 根级字段定义

根级对象基于 ActionDockManifest 契约，遵循以下字段规范：

- 模式规范指示：`$schema`
  类型为字符串。指向官方规范约束文档，标准规范地址为 `https://actiondock.dev/schema/v2.json`（亦兼容早期路径 `https://actiondock.dev/schema/v2/actiondock.json`）。
- 清单规范版本：`schemaVersion`
  类型为整数。新项目推荐并应当声明为 `2`；运行时为保障向后兼容，仍接受 `1` 或缺省。
- 包唯一标识：`id`
  类型为字符串。作为当前包在本地与远程调用中的命名空间标识，遵循小写字母、数字、中划线与点号组合。若缺省则自动基于当前工程目录名推断。
- 包友好名称：`name`
  类型为字符串。展示给开发者与智能体的前端友好名称。
- 语义化版本号：`version`
  类型为字符串。遵循语义化版本规范，例如 `1.0.0`。
- 包功能简述：`description`
  类型为字符串。用于在 `ad info` 与智能体发现阶段提供意图匹配依据。
- 跨包外部依赖映射：`dependencies`
  类型为键值映射对象。声明逻辑包标识到 npm 包名或本地路径的映射，例如 `{"team4u.infra": "@team4u/infra"}`。
- 显式打包资产：`files`
  类型为字符串数组。声明除默认的 `actions/` 与 `playbooks/` 之外需要被打包收集的本地模块或资产路径（例如 `["src", "assets"]`）。
- 静态资产文件列表：`assets`
  类型为字符串数组。声明需包含的静态资产或数据模板文件路径。
- 全局配置项声明：`config`
  类型为键值映射对象。定义当前包所依赖的配置项元数据与回退规则。
- 动作声明映射：`actions`
  类型为键值映射对象。定义包内所有原子 Action 的入口、描述与模式约束。
- 规程声明映射：`playbooks`
  类型为键值映射对象。定义包内面向智能体的操作规程文档与动作引用关联。
- 动作源码目录：`actionsDir`
  类型为字符串。向后兼容过渡字段，指定 Action 源码目录，默认值为 `actions`。
- 规程文档目录：`playbooksDir`
  类型为字符串。向后兼容过渡字段，指定 Playbook 规程文档目录，默认值为 `playbooks`。

---

## 配置声明规范 (config)

`config` 映射下的每个条目以配置键名作为唯一标识，用于规范配置的类型、默认值与环境变量映射：

```json
{
  "config": {
    "GITHUB_TOKEN": {
      "description": "GitHub 个人访问令牌",
      "type": "string",
      "secret": true,
      "required": true,
      "env": ["GITHUB_TOKEN", "GH_TOKEN"]
    },
    "REQUEST_TIMEOUT_MS": {
      "description": "网络请求超时毫秒数",
      "type": "number",
      "default": 5000,
      "allowInvocationOverride": true
    }
  }
}
```

配置项属性约束说明：

- 配置项描述：`description`
  类型为字符串。描述配置用途与格式要求。
- 数据类型约束：`type`
  类型为枚举字符串，支持 `string`、`number`、`boolean`、`object`、`array`。
- 默认值：`default`
  任意符合类型约束的值。当环境与存储均未指定该配置时回退使用。
- 敏感标记：`secret`
  类型为布尔值。标记为 `true` 时，CLI 查看与日志记录中自动执行掩码脱敏，防止凭据泄露。
- 外部环境变量映射：`env`
  类型为字符串或字符串数组（`string | string[]`）。支持指定单个环境变量名或按优先级排序的环境变量候选列表。
- 是否必填：`required`
  类型为布尔值。标记为 `true` 时，调用前若未能解析到有效值将直接阻断执行。
- 允许单次调用覆盖：`allowInvocationOverride`
  类型为布尔值。元数据声明字段，标识配置项是否设计为允许在单次调用中通过参数临时覆盖。

---

## 动作声明规范 (actions)

`actions` 映射下的每个键名为动作的完整标识符（如 `sample.greet` 或 `github.get-pr`）：

```json
{
  "actions": {
    "sample.greet": {
      "entry": "actions/greet.ts",
      "description": "执行用户个性化问候",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "用户姓名"
          }
        },
        "required": ["name"],
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": { "type": "string" },
          "count": { "type": "number" }
        },
        "required": ["message", "count"]
      },
      "uses": [],
      "tags": ["greeting", "demo"],
      "annotations": {
        "audience": ["all"]
      }
    }
  }
}
```

动作属性约束说明：

- 源码入口路径：`entry`
  类型为字符串，必填项。相对于项目根目录的 TypeScript 或 JavaScript 源码文件路径。
- 动作功能描述：`description`
  类型为字符串。供 MCP 协议工具说明、智能体能力检索与开发者阅读。
- 输入参数模式约束：`inputSchema`
  类型为标准 JSON Schema 对象或布尔值。运行时在调用 `run` 前由引擎自动执行严格校验。
- 输出结果模式约束：`outputSchema`
  类型为标准 JSON Schema 对象或布尔值。运行时在动作返回后执行出参合法性校验。
- 级联依赖声明：`uses`
  类型为字符串数组。列出当前动作直接调用的子动作标识。构建与导出工具根据该字段分析依赖闭包。
- 分类标签：`tags`
  类型为字符串数组。用于在 `ad info` 与 `ad list` 中进行分类筛选。
- 协议注解元数据：`annotations`
  类型为键值映射对象。用于承载向下透传给 MCP 协议客户端或上层编排器的元数据注解。

---

## 规程声明规范 (playbooks)

`playbooks` 映射下的每个键名为操作规程的唯一标识符（如 `greet-user`）：

```json
{
  "playbooks": {
    "greet-user": {
      "entry": "playbooks/greet-user.md",
      "description": "新用户入会标准问候操作规程",
      "actions": ["sample.greet"]
    }
  }
}
```

规程属性约束说明：

- 规程入口路径：`entry`
  类型为字符串，必填项。相对于根目录的 Markdown 规程入口文件路径。对应文件正文应为纯 Markdown，严禁编写 YAML Frontmatter。
- 规程描述：`description`
  类型为字符串。阐明该规程适用的业务场景与触发条件。
- 关联动作清单：`actions`
  类型为字符串数组。列出规程执行过程中可能被调度的动作标识列表，作为导出裁剪与能力委托的依据。

---

## 清单校验与验证规则

使用 `ad validate` 对 `actiondock.json` 执行静态合规性校验：

- 结构完整性校验：验证根字段是否满足版本 `schemaVersion: 2` 的必要约束。
- 路径可达性校验：验证所有 `entry` 指定的文件在磁盘上真实存在。
- 模式有效性校验：验证 `inputSchema` 与 `outputSchema` 为合法的 JSON Schema 规范对象。
- 引用闭包校验：验证 `playbooks` 与 `uses` 中引用的动作在清单中已声明或已在锁文件中注册。
