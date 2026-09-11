# 构建规划与产物导出

ActionDock 2.0 提供了面向生产交付与智能体消费的现代构建与导出工具链。构建与导出核心由 `@actiondock/builder` 驱动，包含基于声明式清单的依赖闭包规划器 `BuildPlanner`（`SelectionPlanner`）、Node 目录型交付产物构建器、npm Action 标准打包器与双模态 Skill 导出器。

在 ActionDock 2.0 中，彻底废除了原有的外部单文件二进制编译器以及 `--target` 与 `--bytecode` 选项。工具链全面转向标准、透明且易于容器化部署的 Node 目录型交付产物体系。

---

## 声明式构建规划与依赖闭包裁剪

构建规划器采用纯声明式静态解析机制，确保在规划阶段绝不执行任何 Action 源码，杜绝模块加载副作用。

### 纯声明式解析机制

- **静态元数据驱动**：规划器仅读取静态的 `actiondock.json` 清单文件，在整个规划与依赖分析阶段绝对不执行任何 Action 源码，杜绝运行时污染。
- **纯文本规程提取**：对于 `playbooks/` 目录下的 Markdown 规程文档，规划器仅解析其关联的 Action 标识列表，杜绝不必要的动态探测。

### 基于清单与 `uses` 的静态依赖闭包裁剪

Action 在 `actiondock.json` 中可以通过 `uses` 数组显式声明其依赖的下游 Action 列表：

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

当执行构建或导出时，可以通过参数指定目标裁剪范围：

- **通过 Action 驱动裁剪**：指定 `--actions <ids...>`，规划器以指定的 Action 作为起始根节点进行闭包分析。
- **通过 Playbook 驱动裁剪**：指定 `--playbooks <ids...>`，规划器提取指定规程引用的所有 Action 作为起始根节点。

依赖闭包计算遵循以下原则：

- **广度优先闭包扩展**：从起始根节点出发，依照各 Action 清单中声明的 `uses` 关系进行图遍历，自动解析所有直接依赖与传递依赖，并安全处理环形引用。
- **孤立文件自动剔除**：未被闭包覆盖的 Action 源码文件与无关静态资产将被完全排除在构建产物之外。
- **规程反向约束裁剪**：当显式挑选了 Action 集合时，规划器会自动反向审查规程；如果某个 Playbook 依赖了闭包之外的 Action，该 Playbook 将被自动从导出产物中排除，防止智能体在消费时调用失效规程。

---

## Node 目录型交付产物构建 (`ad build`)

`ad build` 命令将项目及其依赖闭包构建为标准的可运行 Node.js 目录型交付产物。

### 构建机制

构建引擎在目标输出目录中生成自包含的运行环境：
- 保留经过闭包裁剪的 Action 源码、Playbook 文档与静态资产。
- 生成规范的入口启动脚本与元数据声明文件。
- 支持直接通过标准 Node.js 命令启动执行，无需全局安装 ActionDock CLI。

### 核心参数说明

- **指定输出目录**：`-o, --out <path>`，指定产物生成的目标路径（默认为 `dist` 目录）。
- **生成归档压缩包**：`-z, --archive`，将构建输出目录打包为标准的 `.zip` 格式压缩文件，便于网络传输与分发。
- **物化锁定生产依赖**：`--vendor-deps`，在干净的暂存目录中物化锁定的生产依赖，将所需的 `node_modules` 完整内嵌至交付产物中，使目标服务器在离线无网络环境下亦可直接运行。
- **安装脚本安全门禁**：`--allow-install-scripts`，默认禁用（`false`）。防止依赖包中的生命周期脚本在物化期间隐式执行恶意系统命令。
- **强制可复现性校验**：`--require-reproducible`，强制要求构建结果可复现。如果检测到外部依赖存在必须执行的生命周期安装脚本，构建将立即报错中止。
- **废弃参数拦截**：若传入已废弃的 `--target` 或 `--bytecode` 参数，系统将抛出 `UNSUPPORTED_BUILD_MODE` 错误，提示开发者单文件二进制编译已被废除。

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

`ad pack` 命令用于将当前 Action Package 打包为符合 npm 规范的标准分发压缩包（`.tgz`），专供模块发布与跨项目引用。

### 打包机制与核心选项

- **清单与边界严审**：打包器基于 `actiondock.json` 的声明审查包含的文件列表，确保没有未受控的私有文件泄露。
- **完整性摘要生成**：自动计算包内所有文件的 SHA-256 校验哈希与归档包体大小。
- **预检模式**：`--dry-run`，仅执行元数据验证与打包文件清单预览，不实际写入磁盘压缩包，适合在持续集成部署前进行健康体检。
- **JSON 结果输出**：`--json`，将打包结果（包名、版本、文件列表、SHA-256 哈希、字节大小）以机器可读的 JSON 格式输出，便于自动化发布流水线对接。

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

`ad export skill` 命令将 Action Package 导出为供各类 AI 智能体（如 Claude Code、Cursor、Windsurf、Antigravity）理解与消费的自包含 Skill 资产。

ActionDock 2.0 提供了两种清晰的 Skill 导出模式：

### 源码型 Skill 模式 (`--mode source`)

源码型 Skill 是默认的导出模式，适用于目标运行环境中已具备 Node.js 底座的场景。

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

Node 目录型 Skill 将 ActionDock 运行时启动胶水层与依赖闭包完整内嵌于导出的 Skill 目录中，生成自包含的执行环境。

- **导出命令**：
  ```bash
  # 导出自包含的 Node 目录型 Skill
  ad export skill --mode node --vendor-deps

  # 导出并生成 zip 归档
  ad export skill --mode node --vendor-deps --archive
  ```
- **核心特点**：目标机仅需安装通用 Node.js，无需全局预装 ActionDock 工具链，智能体可直接依据 `SKILL.md` 中的指引执行入口命令。

### 导出参数速查

- `--mode <source|node>`：选择导出模式，默认为 `source`。
- `--archive`（`-z`）：生成 `.zip` 归档文件。
- `--vendor-deps`：在导出目录中物化锁定的依赖库。
- `--playbook <playbooks...>`：仅导出指定规程及其依赖闭包内的动作。
- `--actions <actions...>`：仅导出指定的 Action 及其依赖闭包。
- `--skill-md <path>`：显式指定现有的自定义 `SKILL.md` 说明书，避免被默认模板覆盖。
- `--bundle [name]`：在源码模式下将工作区内多个包聚合导出为单一复合技能套件。

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
