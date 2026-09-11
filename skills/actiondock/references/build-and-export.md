# 参考手册：构建打包与 Skill 导出指南

本参考手册规范 ActionDock 工程构建、npm 打包、Agent Skill 技能导出以及自定义复合说明书的使用规范。

---

## 交付形态对比与选型

ActionDock 支持三种标准化交付形态：

- 源码型技能（`ad export skill -m source`）：
  - 交付目录包含 ActionDock 清单、TypeScript 源码与任务规程。
  - 适合已有 ActionDock 运行环境的宿主直接挂载，体积最轻量。
- Node.js 目录型交付产物（`ad build` 或 `ad export skill -m node`）：
  - 交付目录内包含经过解析的生产依赖（`--vendor-deps`），包含独立启动脚本。
  - 适合无需全局安装 ActionDock 的自包含运行环境。
- npm 分发压缩包（`ad pack`）：
  - 打包为标准 `.tgz` 压缩包，用于团队共享或发布至私有 npm 仓库。

---

## Agent Skill 导出模式

通过 `ad export skill` 可将 Action 包导出为可供主流智能体客户端（Claude Desktop、OpenClaw、Cursor 等）识别的技能目录。

### 单包导出与规程裁剪

```bash
# 默认源码型导出
ad export skill -P team4u.github-tools --out ./dist/github-tools-skill

# 依赖物化型导出
ad export skill -P team4u.github-tools --mode node --vendor-deps --out ./dist/github-tools-node

# 规程驱动裁剪导出（仅保留该规程及其依赖的 Action 闭包）
ad export skill -P team4u.github-tools --playbook review-pr --out ~/.claude/skills/review-pr
```

### 源码导出边界与依赖完整性规范

- **包内公共代码显式纳管**：源码型技能默认仅拷贝在清单中注册的 Action 源码文件与 Playbook 规程。若 Action 引用了包内其他代码目录（如 `src/`、`lib/`）或公共辅助模块，必须在 `actiondock.json` 的 `files` 字段中显式声明该目录（例如 `"files": ["src"]`）。
- **相对导入完整性强校验**：导出时构建规划器会自动扫描 Action 的相对路径导入。若检测到 Action 引用了未被 `actions` 且未被 `files` 收集的本地文件，将直接报错阻断（错误码 `UNMET_LOCAL_DEPENDENCY`），彻底杜绝交付缺失依赖的损坏产物。
- **外部依赖冷启动就绪**：源码型技能仅携带源码与依赖清单，消费端在执行前需在技能根目录下执行 `npm install --omit=dev`；若需要免安装、全内嵌的自包含交付，应使用 `--mode node --vendor-deps`。

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

---

## 自定义复合技能说明书规范 (`SKILL.custom.md`)

复合技能套件的说明书默认由官方模板根据各子包清单自动生成。若需向说明书中注入宿主环境相关的定制内容（如环境初始化、特定宿主凭据约定或团队知识库），可在工作区根目录放置 `SKILL.custom.md`。导出时解析器会根据插槽标记将内容无缝拼入官方模板：

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
| `intro` | 标题与简介之后、运行时初始化之前 |
| `after-init` | 运行时初始化之后 |
| `after-describe` | 参数契约调阅之后 |
| `after-actions` | Action 工具清单之后 |
| `after-playbooks` | 推荐操作规程之后 |
| `after-invoke` | 标准调用命令之后 |
| `append` | 说明书末尾 |

### 说明书解析与合并规则

- 标记行之前的内容自动归入 `append` 槽位；遇到未知槽位名称会直接拦截报错，防止拼写错误被静默吞没。
- 前置元数据中的 `description` 仅在命令行未显式传入描述参数时生效。
- 复合导出命令（`ad export skill --bundle ...`）会自动发现工作区根目录或当前目录下的 `SKILL.custom.md`，亦可通过 `--custom-md <path>` 显式指定路径。

---

## 说明书原位就地重生成 (`--skill-md-only`)

在日常迭代维护中，Action 契约、入参定义与规程索引会随清单频繁变更。此时无需重新执行耗时的全量子包产物拷贝，可以使用 `--skill-md-only` 选项就地刷新工作区说明书：

```bash
ad export skill --bundle vip-agent-tools --skill-md-only
```

- 原位生成特性：
  - 始终依据子包清单与自定义声明模板重新生成最新的 `SKILL.md`，忽略旧说明书。
  - 自动适配工作区目录结构：规程链接相对路径自动切换为 `./<子包目录>/playbooks/...`，支持在工作区内部直接查阅。
  - 不创建临时暂存目录，不拷贝任何子包物理产物，执行极为迅速。
