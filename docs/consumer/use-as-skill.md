# Agent Skill 使用指南

ActionDock 支持将 Action 与 Playbook 打包为标准 Agent Skill 资产。

对于 Skill 的使用者，通常只需安装。
安装完成后，智能体客户端会读取自带的 `SKILL.md` 说明书。
智能体依据说明书自动准备执行环境，并调度底层 Action。

---

## 从 GitHub 安装

推荐使用智能体技能管理工具直接安装：

```bash
npx skills add <owner/repo> -g -y
```

如果仓库中包含多个 Skill，可以通过 `-s` 参数指定具体名称：

```bash
npx skills add <owner/repo> -s <skill-name> -g -y
```

例如安装 ActionDock 官方技能：

```bash
npx skills add team4u/actiondock -g -y
```

安装完成后即可向智能体分配任务，无需手动初始化 ActionDock 宿主环境。

---

## 从本地目录安装

若获取到独立 Skill 源码目录或离线压缩包，将其放入智能体指定的技能目录即可。

`SKILL.md` 会引导智能体自动准备所需环境与依赖。
使用者通常无需手动执行 `npm install`、安装 ActionDock CLI 或执行 `ad link`。

---

## 两种 Skill 交付形态

ActionDock 支持两种交付形态的 Skill：

- **源码型 Skill**：体积精简，包含 Action 源码与清单契约。智能体首次通过 `ad run` 本地调用时，自动准备必需的生产依赖。
- **Node.js 目录型 Skill**：包含已构建的可执行产物。该产物内嵌锁定的运行时依赖，适合开箱即用的交付场景。

两者的使用体验一致：安装 Skill，然后直接向智能体分配任务。

---

## 智能体调度与调用契约

智能体装载 Skill 后，遵循统一的自省与调用契约：

- 契约查验：智能体在调用前通过 `describe` 查验字段模式与赋值样例。源码型使用 `ad describe <id>`，目录型使用其独立入口。两者输出规则可能不同，以当前入口说明为准。
- 规范调用语法：推荐使用 `ad run <action> [control-options] -- <assignments...>`。
- 协议边界：`--` 分隔符作为控制平面选项与数据平面入参的协议边界。
- 两种赋值操作符：
  - `path=value`：严格保留为字符串，不执行 JSON 解析与类型猜测。
  - `path:=json`：严格解析为 JSON 值，递归校验所有数值为有限数（`Number.isFinite`）。
- 路径语法规则：命名段表示对象属性。纯数字段表示数组索引，从 0 连续编号并拒绝稀疏数组。根节点物化为对象。系统拒绝路径冲突（`INPUT_PATH_CONFLICT`），并拦截 `__proto__` 与 `prototype` 等原型污染属性。
- 三种输入方式互斥：扁平参数、`--input` 与 `--input-file` 严格互斥，不可混用（`INPUT_CONFLICT`）。未指定输入时默认为 `{}`。
- 原始文本绑定：`--stdin-field <field>` 将 stdin 正文绑定为顶层字符串入参。该参数可与扁平赋值组合，但不可与内联或文件 JSON 混用。正文保留 BOM 与空白。stdin 源字节与最终入参序列化大小各有默认 10MiB 上限。
- 输出选择：仅需阅读正文时使用默认输出。需要提取完整字段或错误码时传入 `--json`。CLI 支持正文注解与 `--text-field`，目录型入口不支持正文选择选项。参数解析失败时以退出码 2 退出。
- 安全边界：管道不是事务。高风险写入应先完整生成并校验。正文显示失败不等于业务失败，不可自动重跑产生副作用的动作。

---

## 配置与凭据

部分 Skill 在调用外部服务时可能需要 API 令牌、账号凭据或其他配置。

具体配置项由各 Skill 在清单中声明。
通用配置注入方式请参阅 [配置注入与多环境管理](configuration.md)。

---

## 开发与导出 Skill

若需自行开发、测试、构建或导出 Skill，请参阅：

- [构建打包与 Skill 导出规范](../developer/build-and-export.md)
