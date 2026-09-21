# Agent Skill 使用指南

ActionDock 支持将 Action 与 Playbook 打包为标准 Agent Skill 资产。

对于 Skill 的使用者，通常只需要完成**安装**。安装完成后，智能体客户端会读取 Skill 自带的 `SKILL.md` 说明书，并根据其中的指导自动完成必要的运行环境准备、能力发现与调度调用。

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

安装完成后即可直接向智能体提出任务，无需手动初始化 ActionDock 运行环境。

---

## 从本地目录安装

如果获取的是独立 Skill 源码目录或离线压缩包，将其解压或放置到智能体支持的技能目录即可。

Skill 内部的 `SKILL.md` 会引导智能体自动准备所需环境和依赖，通常不需要使用者手动执行 `npm install`、安装 ActionDock CLI 或执行 `ad link`。

---

## 两种 Skill 交付形态

ActionDock 支持两种交付形态的 Skill：

- **源码型 Skill**：体积精简，包含 Action 源码与清单契约。智能体会根据 Skill 内置说明自动完成运行环境准备。
- **Node.js 目录型 Skill**：包含已经构建完毕的可执行产物，内嵌锁定的运行时依赖，适合需要开箱即用交付环境的场景。

对 Skill 使用者而言，两者的使用体验基本一致：**安装 Skill，然后直接向智能体提出业务任务。**

---

## 智能体调度与调用契约

智能体装载 Skill 后，底层遵循统一的自省与调用契约：

- 契约查验：智能体在调用前执行 `ad describe <id>` 调阅编码顾问，动态获取字段模式明细、Flat 编码指引与建议赋值样例展示，杜绝参数幻觉。
- 规范调用语法：推荐使用 `ad run <action> [control-options] -- <assignments...>`。
- 协议边界：`--` 分隔符作为控制平面（选项如 `--json`、`--config`、`--data-dir`、`--profile`）与数据平面（Action 入参）的协议边界。
- 两种赋值操作符：
  - `path=value`：严格保留为字符串，不执行 JSON 解析与类型猜测。
  - `path:=json`：严格解析为 JSON 值，递归校验所有数值为有限数（`Number.isFinite`）。
- 路径语法规则：命名段表示对象属性，纯数字段表示数组索引（从 0 开始连续编号，拒绝稀疏数组），根节点始终物化为对象，路径冲突严格拒绝（`INPUT_PATH_CONFLICT`），拦截 `__proto__`、`constructor`、`prototype` 等原型污染敏感属性。
- 三种输入模式互斥：扁平参数、`--input` 与 `--input-file` 严格互斥，不可混用（`INPUT_CONFLICT`）；未指定输入时默认为 `{}`。
- 机器输出模式：面向智能体调用推荐使用 `--json`，当参数解析出错时输出标准错误信封并以退出码 2 退出。

---

## 配置与凭证

部分 Skill 在调用外部服务（如代码仓库、云平台或数据库）时可能需要 API 令牌、账号凭据或其他配置。

具体配置项由各 Skill 自身在清单中声明。ActionDock 的通用配置注入方式请参阅 [配置注入与多环境管理](configuration.md)。

---

## 开发与导出 Skill

如需自行开发、测试、构建或导出 Skill，请参阅：

- [构建打包与 Skill 导出规范](../developer/build-and-export.md)
