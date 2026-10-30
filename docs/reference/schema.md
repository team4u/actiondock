# 参考手册：actiondock.json 清单规范

在 ActionDock 中，工程根目录的 `actiondock.json` 是元数据声明的唯一事实源。它定义配置项、跨包依赖、动作契约与操作规程映射。

框架在检索、执行期模式校验、依赖裁剪与技能导出时，统一以 `actiondock.json` 作为仲裁依据。

---

## 根级字段定义

根级对象基于 ActionDockManifest 契约，遵循以下字段规范：

- 模式规范指示：`$schema`
  类型为字符串。指向官方规范约束文档，标准规范地址为 `https://actiondock.dev/schema/v2.json`。
- 清单规范版本：`schemaVersion`
  类型为整数。新项目推荐声明为 `2`。运行时仍兼容 `1` 或缺省。
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
  类型为字符串数组。声明除默认目录之外需打包收集的本地模块或资产路径。例如 `["src", "assets"]`。
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

`config` 映射下的每个条目以配置键名作为唯一标识，用于规范配置的类型、默认值与环境变量映射。键名支持具体键以及包含单个 `*` 通配符的模板定义（例如 `MYSQL_*`）：

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
    },
    "MYSQL_*": {
      "description": "MySQL 动态数据库连接配置模板",
      "type": "object",
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
  }
}
```

配置项属性约束说明：

- 配置项描述：`description`
  类型为字符串。描述配置用途与格式要求。对外公开的元数据严禁携带敏感凭据。
- 数据类型约束：`type`
  类型为枚举字符串，支持 `string`、`number`、`boolean`、`object`、`array`。若定义了内嵌 `schema`，外层 `type` 必须同 `schema.type` 保持一致。
- 细粒度校验模式：`schema`
  支持针对复杂对象或数组进行细粒度校验。仅允许使用受限关键字集：
  - 核心类型：`type`（支持 `object`、`array`、`string`、`integer`、`number`、`boolean`）。
  - 对象与数组：`properties`、`required`、`additionalProperties`、`items`。
  - 范围与约束：`enum`、`minLength`、`maxLength`、`minimum`、`maximum`。
  - 扩展敏感标记：`secret`（布尔值）。
  - 明确拒绝其他关键字：严禁使用 `$ref`、模式组合（`allOf`、`anyOf`、`oneOf`）、`default`、`format` 等特性。
- 敏感标记：`secret`
  类型为布尔值。顶层配置声明 `secret: true` 时整项隐藏。内嵌字段声明时仅隐藏该字段节点。数据结构不符时系统保守隐藏。根节点标记敏感时不强制要求配置 `items`。
- 默认值：`default`
  任意符合类型约束的值。环境与存储未指定时回退使用。通配模板不允许配置默认值。对外声明会剥离敏感默认值。
- 外部环境变量映射：`env`
  类型为字符串或字符串数组（`string | string[]`）。支持指定单个环境变量名或按优先级排序的候选列表。通配模板严禁配置环境变量映射。
- 是否必填：`required`
  类型为布尔值。作为静态诊断标识。通配模板严禁标记为必填。
- 允许单次调用覆盖：`allowInvocationOverride`
  类型为布尔值。元数据声明字段，标识配置项是否允许单次调用临时覆盖。

通配模板匹配与解析规则：

- 模板支持单个 `*` 通配符，匹配 1 个及以上 `[A-Za-z0-9_.-]` 字符。
- 匹配优先级由高到低依次为：具体精确键 > 最长字面前缀 > 最长字面后缀。
- 模板不参与环境变量的隐式枚举与缺失诊断，在模式中单独展示并统计匹配计数。

---

## 动作声明规范 (actions)

`actions` 映射下的每个键名为动作的完整标识符（如 `sample.greet` 或 `github.get-pr`）。

> [!NOTE]
> `ad action create` 提供基础类型简写，适用于生成初始骨架。复杂契约直接在 `actiondock.json` 中使用 JSON Schema 定义。随后执行 `ad generate types` 刷新类型。

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
            "description": "用户姓名",
            "examples": ["张三", "李四"]
          }
        },
        "required": ["name"],
        "additionalProperties": false,
        "examples": [
          { "name": "张三" }
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "message": {
            "type": "string",
            "examples": ["你好，张三！"]
          },
          "count": {
            "type": "number",
            "examples": [1]
          }
        },
        "required": ["message", "count"]
      },
      "uses": [],
      "tags": ["greeting", "demo"],
      "annotations": {
        "audience": ["all"],
        "actiondock.cli": { "textField": "message" }
      }
    }
  }
}
```

动作属性约束说明：

- 源码入口路径：`entry`
  类型为字符串，必填项。相对于项目根目录的源码文件路径。
- 动作功能描述：`description`
  类型为字符串。供 MCP 协议工具说明、智能体能力检索与开发者阅读。
- 输入参数模式约束：`inputSchema`
  类型为标准 JSON Schema 对象或布尔值。引擎在调用 `run` 前自动校验。可在字段或根层级通过 `examples` 补充调用示例。
- 输出结果模式约束：`outputSchema`
  类型为标准 JSON Schema 对象或布尔值。运行时在动作返回后执行出参合法性校验。支持通过 `examples` 补充输出结构样例。
- 级联依赖声明：`uses`
  类型为字符串数组。列出当前动作直接调用的子动作标识。构建与导出工具根据该字段分析依赖闭包。
- 分类标签：`tags`
  类型为字符串数组。用于在 `ad info` 与 `ad list` 中进行分类筛选。
- 协议注解元数据：`annotations`
  类型为键值映射对象。承载协议适配器与调用入口元数据。
  - `"actiondock.cli": { "textField": "message" }` 声明 CLI 默认同步输出的正文字段。该字段对应结果中的顶层属性。
  - `ad describe` 展示默认字段。`ad validate` 拦截确定矛盾。显式 `--text-field` 优先于默认声明。`--json` 模式保留完整信封。
  - 该注解不改变业务返回值与执行记录。目录型入口不应用此注解。

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
  类型为字符串数组。列出规程执行中可能调度的动作标识。该列表作为导出裁剪与委托的依据。

---

## 清单校验与验证规则

使用 `ad validate` 对 `actiondock.json` 执行静态合规性校验：

- 结构完整性校验：校验根字段是否满足版本 `schemaVersion: 2` 的约束。
- 路径可达性校验：校验所有 `entry` 指定的文件是否存在。
- 模式有效性校验：校验 `inputSchema` 与 `outputSchema` 为合法的 JSON Schema 对象。
- 引用闭包校验：校验 `playbooks` 与 `uses` 中引用的动作是否已在清单或锁文件中声明。
