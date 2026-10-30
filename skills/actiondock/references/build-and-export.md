# 参考手册：构建打包与 Skill 导出指南

本参考手册规范 ActionDock 工程构建、npm 打包、Agent Skill 技能导出与自定义复合说明书的使用规范。

---

## 交付形态对比与选型

ActionDock 支持三种标准化交付形态：

- 源码型技能（`ad export skill -m source`）：
  - 交付目录包含 ActionDock 清单、TypeScript 源码与任务规程。
  - 交付目录适合已有 ActionDock 执行环境的宿主直接挂载，体积最轻量。
- Node.js 目录型交付产物（`ad build` 或 `ad export skill -m node`）：
  - 交付目录内包含经过解析的生产依赖（`--vendor-deps`），包含独立启动脚本。
  - 交付目录适合无需全局安装 ActionDock 的自包含执行环境。
- npm 分发压缩包（`ad pack`）：
  - 打包为标准 `.tgz` 压缩包，用于团队共享或发布至私有 npm 仓库。

---

## Agent Skill 导出模式

通过 `ad export skill` 可将 Action 包导出为技能目录。主流智能体客户端可识别该目录。主流客户端包括 Claude Desktop、OpenClaw 与 Cursor。

### 单包浅模式导出与规程裁剪

```bash
# 默认源码浅模式导出（推荐生产共享形态）
ad export skill -P team4u.github-tools --out ./dist/github-tools-skill

# 依赖物化型导出（免安装、自包含交付）
ad export skill -P team4u.github-tools --mode node --vendor-deps --out ./dist/github-tools-node

# 规程驱动裁剪导出（仅保留该规程及其依赖的 Action 闭包）
ad export skill -P team4u.github-tools --playbook review-pr --out ~/.claude/skills/review-pr
```

### 源码浅模式导出与全局注册共享最佳实践

- 浅模式导出轻量定位：`ad export skill` 默认采用源码浅模式导出。产物仅包含当前包源码、`actiondock.json` 与 `SKILL.md`。下游跨包依赖以纯逻辑 `uses` 声明保留。产物不携带外部依赖副本。
- 消费端全局注册共享：
  - 产物部署至宿主环境后，直接在技能根目录执行链接命令。
  - 命令会将技能登记至本机全局路由表（`~/.actiondock/registry.json`）。
  - 本地首次通过 `ad run` 调用时，默认自动安装缺失的直接生产依赖。
  - 用户亦可手动执行预先安装：
    ```bash
    npm install --omit=dev
    ```
  - 注册链接命令：
    ```bash
    ad link .
    ```
  - 该命令将技能包登记至全局路由表。本机上的智能体、命令行与其他 Action 工程均可直接识别并共享调用。
- 包内公共代码显式纳管：源码型技能默认仅拷贝清单中注册的 Action 源码与规程。Action 引用包内其他目录（如 `src/` 或 `lib/`）或辅助模块时，必须在 `actiondock.json` 的 `files` 字段中显式声明该目录（例如 `"files": ["src"]`）。
- 相对导入完整性强校验：构建规划器在导出时扫描 Action 的相对路径导入。若 Action 引用了未在 `actions` 与 `files` 中声明的本地文件，规划器直接抛出错误并阻断。错误码为 `UNMET_LOCAL_DEPENDENCY`。此机制杜绝交付损坏产物。

### 多包工作区批量导出

```bash
# 批量独立导出工作区下的所有子包
ad export skill --workspace --out ./dist/skills
```

### 复合套件聚合导出 (`--bundle`)

将多个子包融合成一个统一的复合工作区技能目录，生成聚合说明书与聚合依赖声明：

```bash
# 聚合当前工作区为单一复合技能
ad export skill --bundle vip-agent-tools --out ./dist/vip-agent-tools-skill
```

- 复合套件批量全局注册：复合技能套件部署后，先在聚合根目录下安装生产依赖（`npm install --omit=dev`）。随后执行 `ad link . -r`（或 `ad link .`）。系统会自动递归挂载全部子包至全局路由表。工作区内部子包与外部工程即可实现平级互通与全局共享。

---

## 命名绑定与远端依赖的交付边界

- 规划器识别已配置的远端引用：`uses` 中的完全限定依赖在本地不存在时，规划器校验调用方包自身。若该包的 `.actiondock/bindings.json` 包含该引用的远端命名绑定，规划器保留该外部依赖。规划器不要求下载或打包远端实现。没有相应绑定的缺失依赖仍会抛出错误。
- 区分构建收集与运行时路由：本地存在同名实现时，构建保留本地源码闭包，以支持本地备用绑定。这不代表运行时本地优先。实际目标始终由所选绑定决定。
- 保留能力契约：产物保留原始 `uses`。纯远端依赖无需加入本地 `dependencies`。本地备用实现按正常本地依赖安装与构建。远端绑定不能掩盖本地入口文件缺失或清单损坏。
- 调用方作用域隔离：外部包依赖使用自身的绑定文件。根项目对同名引用配置远端时，系统不会替所有子包放行缺失依赖。
- 不分发本机执行配置：`.actiondock/bindings.json` 与 `profiles.json` 凭据不进入构建、打包或导出资产。开发者不要在 `files` 或 `assets` 中显式加入这些文件。显式收集执行配置会导致错误。
- 部署端重新装配：在目标宿主生成 Profile，提供令牌环境变量，并在调用方项目配置绑定。原始绑定文件可作为不含秘密值的运维示例另行管理。框架不会随包自动复制绑定文件。
- 规划通过不等于远端可用：离线构建不验证网络、远端授权或动作契约。开发者不可将成功构建视为远端执行成功的保证。

配置与调用示例见 [action-bindings.md](action-bindings.md)。

---

## 自定义复合技能说明书规范 (`SKILL.custom.md`)

说明书默认由模板根据各子包清单自动生成。开发者可在工作区根目录放置 `SKILL.custom.md`。该文件用于注入定制内容，例如环境初始化、宿主凭据约定或团队知识库。导出时解析器会根据插槽标记将内容拼入模板：

### 声明文件格式示例

```markdown
---
description: 覆盖复合套件的描述元数据（可选）
---

<!-- actiondock:slot after-init -->
### 数据目录持久化软链（特定宿主专用）

（宿主相关的初始化与配置说明）

<!-- actiondock:slot append -->
## 参考文档

- 团队知识库地址
```

### 插槽位置定义表

| 插槽名称 | 对应说明书插入位置 |
| :--- | :--- |
| `intro` | 标题与简介之后、参数契约调阅之前 |
| `after-describe` | 参数契约调阅之后 |
| `after-actions` | Action 工具清单之后 |
| `after-playbooks` | 推荐操作规程之后 |
| `after-invoke` | 标准调用命令之后 |
| `after-init` | 排错与环境安装指引之后 |
| `append` | 说明书末尾 |

### 说明书解析与合并规则

- 标记行之前的内容自动归入 `append` 槽位。解析器遇到未知槽位名称时直接拦截并抛出错误，防止拼写错误丢失。
- 前置元数据中的 `description` 仅在命令行未显式传入描述参数时生效。
- 复合导出命令（`ad export skill --bundle ...`）会自动发现工作区根目录或当前目录下的 `SKILL.custom.md`。用户亦可通过 `--custom-md <path>` 显式指定路径。

---

## 说明书原位就地重生成 (`--skill-md-only`)

日常维护中，Action 契约、入参定义与规程索引会随清单变更。开发者无需重新执行全量子包产物拷贝，可使用 `--skill-md-only` 选项就地刷新工作区说明书：

```bash
ad export skill --bundle vip-agent-tools --skill-md-only
```

- 原位生成特性：
  - 工具依据子包清单与自定义模板生成最新 `SKILL.md`，忽略旧说明书。
  - 规程链接相对路径自动适配为 `./<子包目录>/playbooks/...`。用户可在工作区内部直接查阅。
  - 工具不生成临时暂存目录，不拷贝子包物理产物，执行耗时短。
