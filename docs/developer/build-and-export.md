# 构建规划与产物导出

ActionDock 2.x 提供构建与导出工具链。
核心由 `@actiondock/builder` 驱动。
工具链包含依赖闭包规划器 `SelectionPlanner`、Skill 模板生成器。
工具链包含 Node 目录交付产物构建器、npm Action 打包器与 Skill 导出器。

工具链采用标准、透明的 Node 目录型交付产物体系。
产物便于容器化部署。

---

## 声明式构建规划与依赖闭包裁剪

构建规划器采用声明式静态解析机制。
规划阶段不执行 Action 源码，杜绝模块加载副作用。

### 纯声明式解析机制

- **静态元数据驱动**：规划器仅读取静态 `actiondock.json` 清单。规划与依赖分析阶段绝不执行 Action 源码，杜绝环境污染。
- **纯文本规程提取**：对于 `playbooks/` 下的 Markdown 规程，规划器仅解析关联动作列表，杜绝动态探测。

### 基于清单与 `uses` 的静态依赖闭包裁剪

Action 在 `actiondock.json` 中通过 `uses` 声明下游动作列表：

```json
{
  "actions": {
    "workflow.deploy": {
      "entry": "actions/deploy.ts",
      "uses": ["git.checkout", "docker.build", "notify.slack"]
    }
  }
}
```

执行构建或导出时，可以通过参数指定裁剪范围：

- **动作驱动裁剪**：指定 `--actions <ids...>`。规划器以指定动作作为根节点分析闭包。
- **规程驱动裁剪**：指定 `--playbooks <ids...>`。规划器提取规程引用的动作作为根节点。

依赖闭包计算遵循以下原则：

- **广度优先扩展**：规划器从根节点出发，依据清单中的 `uses` 遍历依赖图。规划器自动解析直接与传递依赖，并处理循环引用。
- **孤立文件剔除**：闭包未覆盖的源码与静态资产不会进入构建产物。
- **规程反向约束**：显式指定动作集合时，规划器反向审查规程。若 Playbook 依赖闭包外的动作，规划器将其排除，防止调用失效规程。

---

## Node 目录型交付产物构建 (`ad build`)

`ad build` 命令将项目及依赖闭包构建为 Node.js 交付产物。

### 构建机制

构建引擎在输出目录中生成独立执行环境：
- 保留裁剪后的 Action 源码、Playbook 文档与静态资产。
- 生成规范的入口启动脚本与元数据声明文件。
- 支持通过标准 Node.js 命令启动执行，无需全局安装 ActionDock CLI。

### 核心参数说明

- **指定输出目录**：`-o, --out <path>`，指定产物生成的目标路径（默认为 `dist` 目录）。
- **生成归档压缩包**：`-z, --archive`，将构建输出目录打包为 `.zip` 压缩文件，便于分发。
- **物化锁定生产依赖**：`--vendor-deps`，在暂存目录中物化锁定的依赖。依赖内嵌至交付产物中，离线无网络也可直接执行。
- **安装脚本安全门禁**：`--allow-install-scripts`，默认禁用（`false`）。禁止依赖包生命周期脚本执行恶意系统命令。
- **强制可复现性校验**：`--require-reproducible`，强制要求构建结果可复现。若依赖包含生命周期脚本，工具链立即报告错误并中止。

### 构建示例

```bash
# 全量构建 Node 目录型交付产物
ad build

# 挑选指定 Action 构建，生成 zip 归档并物化锁定依赖
ad build --actions sample.greet,calc.sum --archive --vendor-deps

# 结合严格安全与可复现性门禁构建
ad build --archive --vendor-deps --require-reproducible
```

---

## npm Action 包标准打包 (`ad pack`)

`ad pack` 命令将 Action Package 打包为 npm 规范压缩包（`.tgz`），专供模块发布与跨项目引用。

### 打包机制与核心选项

- **清单与边界审查**：打包器基于 `actiondock.json` 审查文件列表，防止私有文件泄露。
- **完整性摘要生成**：自动计算包内文件的 SHA-256 校验哈希与包体大小。
- **预检模式**：`--dry-run`，仅校验元数据并预览文件清单，不写入压缩包，适合在发布前校验。
- **JSON 结果输出**：`--json`，将打包结果以 JSON 格式输出，便于对接自动化发布流水线。

### 打包示例

```bash
# 标准打包并生成 .tgz 文件
ad pack

# 指定输出目录
ad pack --out ./artifacts

# 仅执行打包预检
ad pack --dry-run
```

---

## AI Agent Skill 资产导出 (`ad export skill`)

`ad export skill` 命令将 Action Package 导出为 AI 智能体可读取的 Skill 资产。

ActionDock 2.x 提供两种 Skill 导出模式：

### 源码型 Skill 模式 (`--mode source`)

源码型 Skill 为默认模式，适用于具备 Node.js 环境的宿主。

- **导出命令**：
  ```bash
  # 导出默认源码型 Skill
  ad export skill --mode source

  # 结合规程裁剪并打包为 zip 归档
  ad export skill --mode source --playbook review-pr --archive
  ```
- **生成文件结构**：
  ```text
  <package-slug>-skill/
  ├── SKILL.md                  # 智能体说明书，包含工具列表与输入输出调用模式
  ├── actiondock.json           # 经过闭包裁剪后的精简声明式清单
  ├── package.json              # 依赖声明文件
  ├── tsconfig.json             # TypeScript 模块配置
  ├── actions/                  # 闭包裁剪后的 Action 业务执行函数
  ├── playbooks/                # 闭包裁剪后的 Playbook 规程文档
  └── assets/                   # 关联引用的静态资产文件
  ```

### Node 目录型 Skill 模式 (`--mode node`)

Node 目录型 Skill 将启动胶水层 `entry.mjs` 与裁剪后的源码输出至目录。智能体可直接通过 Node.js 执行入口。

- **导出命令**：
  ```bash
  # 配合 --vendor-deps 物化锁定生产依赖，生成完全自包含的离线 Skill
  ad export skill --mode node --vendor-deps

  # 导出并生成 zip 归档
  ad export skill --mode node --vendor-deps --archive

  # 仅导出运行入口与源码（不物化依赖，目标机首次缺依赖时需由 Agent 执行 npm install --omit=dev）
  ad export skill --mode node
  ```
- **核心特点**：目标机仅需 Node.js 运行时，无需全局预装 ActionDock。配合 `--vendor-deps` 内嵌锁定的依赖，实现离线使用。

### 导出参数速查

- `--mode <source|node>`：选择导出模式，默认为 `source`。
- `--archive`（`-z`）：生成 `.zip` 归档文件。
- `--vendor-deps`：在导出目录中物化锁定的依赖库。
- `--playbook <playbooks...>`：仅导出指定规程及其依赖闭包内的动作。
- `--actions <actions...>`：仅导出指定 Action 及其依赖闭包。
- `--skill-md <path>`：显式指定自定义 `SKILL.md`，防止官方模板覆盖文件。
- `--bundle [name]`：在源码模式下将多个包聚合导出为单一复合套件。
- `--skill-md-only`：仅刷新复合 `SKILL.md` 说明书，不重复拷贝代码与资产。

### 本地导出与私有分发

开发团队可在本地将自研能力导出为 Skill，安装至本地智能体目录：

- 从本地已注册的 Action Package 导出：
  ```bash
  ad export skill -P team4u.github-tools --out ~/.claude/skills/github-tools
  ```
- 在 Action Package 根目录就地导出：
  ```bash
  ad export skill --out ~/.claude/skills/github-tools
  ```
- 导出自包含 Node 目录型 Skill 并固化生产依赖：
  ```bash
  ad export skill -P team4u.github-tools --mode node --vendor-deps --out ./dist/github-tools-skill
  ```
- 按指定规程闭包精简导出：
  ```bash
  ad export skill -P team4u.github-tools --playbook review-pr --out ~/.claude/skills/review-pr
  ```

### 自定义技能说明书（SKILL.custom.md）

单包导出与复合套件导出默认依据清单与规程生成 `SKILL.md`。
若需注入环境初始化步骤或配置声明，可使用 `SKILL.custom.md`。
在根目录放置 `SKILL.custom.md`，导出时按插槽拼入官方模板：

```markdown
---
description: 覆盖技能的 description 元数据（可选）
---

<!-- actiondock:slot after-init -->
### 宿主环境特殊声明
此操作包需配置特殊环境变量。

<!-- actiondock:slot append -->
## 参考文档

- 团队内部知识库
```

可用插槽决定自定义段落的插入位置：

| 插槽名称 | 单包导出插入位置 | 复合套件导出插入位置 |
| :--- | :--- | :--- |
| `intro` | 标题与简介之后 | 标题与简介之后 |
| `after-init` | 运行时与注册指引之后 | 环境问题排查与安装指引之后 |
| `after-describe` | 动作参数契约调阅之后 | 动作参数契约调阅之后 |
| `after-invoke` | 标准调用命令与响应解析之后 | 标准调用命令与响应解析之后 |
| `after-playbooks` | 业务操作规程之后 | 推荐操作规程之后 |
| `after-actions` | Action 目录与配置状态之后 | 可用 Action 工具清单之后 |
| `append` | 文档末尾 | 文档末尾 |

- 标记行之前的内容自动归入 `append` 插槽。未知插槽名称会直接报告错误。
- 头部元数据 `description` 支持覆盖默认生成的技能描述。
- 单包导出命令自动发现项目根目录下的 `SKILL.custom.md`。
- 复合导出命令自动发现工作区根目录下的 `SKILL.custom.md`。
- 两者均可通过 `--custom-md <path>` 显式指定文件路径。

单包导出示例：

```bash
ad export skill -o ./dist/my-skill --custom-md ./SKILL.custom.md
```

复合套件导出示例：

```bash
ad export skill --bundle vip-agent-tools --out ./dist/vip-agent-tools-skill
```

日常维护复合套件时，可就地刷新说明书：

```bash
ad export skill --bundle vip-agent-tools --skill-md-only
```

---

## 本地相对依赖与 `files` 声明规范

为了防止导出的 Skill 或交付目录丢失辅助模块，ActionDock 采用本地依赖完整性校验机制：

- 单文件推荐：原子 Action 推荐保持单一职责，尽量以独立单文件形式编写。
- 包内共享模块声明：若 Action 依赖包内公共源码或工具目录（如 `src/utils`、`lib/`），必须在 `actiondock.json` 清单的 `files` 数组中声明该目录（例如 `"files": ["src", "lib"]`）。
- 完整性自动拦截：规划器与导出器在导出及 `ad validate` 时，静态解析相对路径导入。若检测到 Action 引用未在 `actions` 与 `files` 声明的文件，工具链直接报告错误并阻断，防止交付损坏产物。

---

## 常用操作命令速查

- **Node 目录型标准构建**：
  ```bash
  ad build
  ```
- **带依赖物化与归档构建**：
  ```bash
  ad build --archive --vendor-deps
  ```
- **可复现性门禁构建**：
  ```bash
  ad build --archive --vendor-deps --require-reproducible
  ```
- **npm Action 标准打包**：
  ```bash
  ad pack
  ```
- **npm Action 打包预检**：
  ```bash
  ad pack --dry-run
  ```
- **导出默认源码型 Skill**：
  ```bash
  ad export skill --mode source
  ```
- **导出自包含 Node 目录型 Skill**：
  ```bash
  ad export skill --mode node --vendor-deps
  ```
- **按 Playbook 闭包导出 Skill 并生成压缩包**：
  ```bash
  ad export skill --playbook review-pr --archive
  ```
- **工作区多包复合导出**：
  ```bash
  ad export skill --workspace --bundle devops-suite --out ./dist/devops-suite
  ```
- **就地仅刷新复合说明书**：
  ```bash
  ad export skill --bundle devops-suite --skill-md-only
  ```
