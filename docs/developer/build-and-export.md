# 构建规划与产物导出

ActionDock 2.0 提供了完整的构建规划与双模态产物导出工具链。构建与导出核心由 `@actiondock/builder` 驱动，包含基于声明式清单的依赖规划器 `BuildPlanner` 与外部独立二进制编译器 `BunCompiler`，支持按需依赖闭包裁剪、全平台跨平台交叉编译与智能体资产分发。

---

## 构建规划与静态依赖裁剪

在传统工具链中，打包前往往需要动态导入全部源码以提取元数据，这会带来副作用执行、环境污染和跨平台解析失败的风险。ActionDock 2.0 的 `BuildPlanner` 规划器采用纯声明式解析机制。

### 纯声明式解析机制

- **静态元数据驱动**：`BuildPlanner` 仅读取静态的 `actiondock.manifest.json` 与 `actiondock.json`，在整个规划阶段绝对不执行任何 Action 源码，杜绝一切模块导入副作用。
- **纯文本规程提取**：对于 `playbooks/` 目录下的 Markdown 规程，规划器仅使用纯文本流解析其顶部的 YAML 元数据段，提取其声明关联的 Action 标识列表。

### 基于清单与 `uses` 的静态依赖闭包裁剪

Action 在清单中可以通过 `uses` 数组显式声明其静态依赖的下游 Action 列表：

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

当执行构建或导出时，可以通过参数指定目标范围：

- **通过 Action 驱动裁剪**：指定 `--actions <ids...>`，规划器以指定的 Action 作为起始根节点。
- **通过 Playbook 驱动裁剪**：指定 `--playbook <ids...>`，规划器提取指定规程引用的所有 Action 作为起始根节点。

依赖闭包计算过程如下：

- **广度优先闭包扩展**：从起始根节点出发，依照各 Action 清单中声明的 `uses` 关系进行图遍历，自动解析所有直接依赖与间接传递依赖，并安全处理环形引用。
- **孤立文件自动剔除**：未被闭包覆盖的 Action 源码文件、无关的静态资产将完全被排除在构建产物之外。
- **规程反向约束裁剪**：当显式挑选了 Action 集合时，规划器会自动反向审查规程；如果某个 Playbook 依赖了闭包之外的 Action，该 Playbook 将被自动从导出产物中排除，防止智能体在消费时调用失效规程。

---

## 外部编译器机制与构建参数

ActionDock 2.0 的日常开发、调试与自动化测试全面运行在标准 Node.js 24 LTS 生产底座上。当需要交付单个零外部依赖的独立可执行文件时，工具链通过 `BunCompiler` 调用外部编译引擎完成单文件打包。

### 编译器工作机制

`BunCompiler` 负责调度外部编译命令。编译器将运行时轻量调度器、内嵌 SQLite 引擎、依赖闭包内的业务代码以及入口分发逻辑完全内联，编译为单个原生系统可执行二进制文件。目标服务器或容器运行该二进制文件时，无需预先安装 Node.js、Bun、npm 依赖或任何系统动态库。

### 核心构建参数

- **编译目标平台**：`-t, --target <target>`
  指定生成二进制的目标操作系统与 CPU 架构。默认使用宿主环境架构 `host`。支持全平台交叉编译，开发者可以在 Linux 开发机或 CI 上直接为不同操作系统编译产物：
  - `linux-x64`：适用于主流 x86_64 架构 Linux 服务器与容器。
  - `linux-arm64`：适用于 ARM64 架构 Linux 服务器或嵌入式设备。
  - `darwin-x64`：适用于 Intel 架构 macOS 系统。
  - `darwin-arm64`：适用于 Apple Silicon 架构 macOS 系统。
  - `windows-x64`：适用于 Windows x86_64 平台，自动输出 `.exe` 可执行文件。
- **代码混淆压缩**：`-m, --minify` 与 `--no-minify`
  默认开启（`true`）。启用时将压缩并混淆 JavaScript 源码、缩短局部变量名、剔除冗余空格与注释，大幅缩减最终独立二进制文件的体积。若需排查底层堆栈，可传入 `--no-minify` 关闭压缩。
- **字节码预编译**：`--bytecode` 与 `--no-bytecode`
  默认开启（`true`）。启用时将在编译期直接将 JavaScript 源码编译为虚拟机字节码，省去运行时的语法解析与编译开销，实现毫秒级瞬间冷启动，同时能够有效保护商业源码逻辑不被逆向分析。可通过 `--no-bytecode` 禁用字节码生成。

---

## 两类 Skill 产物导出规范

使用 `ad export skill` 可以将 Action Package 导出为供 AI 智能体（如 Claude Code、Cursor、Windsurf、Antigravity）理解与消费的自包含 Skill 资产。ActionDock 提供两类导出形态以满足不同运行环境。

### 源码型 Skill

源码型 Skill 属于默认导出模式，适用于目标运行环境中已具备 Node.js、Bun 或 ActionDock 运行底座的场景。

#### 导出命令
```bash
ad export skill
# 结合规程裁剪并打包为压缩文件
ad export skill --playbook deploy-sop --archive
```

#### 文件目录结构
```text
<package-slug>-skill/
├── SKILL.md                  # 智能体指令说明书，包含 YAML 模式说明与源码模式调用规范
├── actiondock.skill.json     # 机器可读的工具模式清单，标记 mode 为 source
├── actiondock.manifest.json  # 经过闭包裁剪后的精简版声明式清单
├── actiondock.json           # 项目配置元数据定义
├── package.json              # 依赖声明文件
├── tsconfig.json             # TypeScript 配置（若原项目存在）
├── actions/                  # 闭包裁剪后的 Action 源码文件（完整保留相对目录层级）
├── playbooks/                # 闭包裁剪后的 Playbook 规程 Markdown 文件
└── assets/                   # 关联引用的静态资产文件
```

### 独立二进制型 Skill

独立二进制型 Skill 是 ActionDock 2.0 的特色交付模式。它将预编译的单文件零依赖可执行程序与 Agent Skill 说明书无缝结合，专门用于目标机未安装任何前端或脚本运行时的极简环境。

#### 导出命令
```bash
# 为当前宿主平台导出独立二进制 Skill
ad export skill --standalone

# 跨平台交叉编译为 Linux ARM64 二进制 Skill 并打包
ad export skill --standalone --target linux-arm64 --archive
```

#### 文件目录结构
```text
<package-slug>-skill-<target>/
├── SKILL.md                  # 智能体指令说明书，包含 ./bin/<binary> run <action> 命令行调用规范
├── actiondock.skill.json     # 机器可读的工具模式清单，标记 mode 为 standalone
├── bin/
│   └── <package-slug>        # 预编译生成的单文件零依赖独立可执行文件
├── playbooks/                # 闭包裁剪后的 Playbook 规程 Markdown 文件
└── assets/                   # 关联引用的静态资产文件
```

### 核心差异对比

- **环境依赖差异**：源码 Skill 要求消费端机器具备执行 TypeScript 或 JavaScript 的宿主底座；独立二进制 Skill 目标机无需安装 Node.js、Bun 或任何包管理器，开箱即用。
- **包含内容差异**：源码 Skill 包含 `actions/` 源码目录、`actiondock.manifest.json`、`package.json` 与 `tsconfig.json`；独立二进制 Skill 将所有源码、引擎与依赖完整封装在 `bin/` 目录下的单个可执行程序中，不再散落源码文件。
- **智能体调用路径**：在生成的 `SKILL.md` 中，源码 Skill 指导智能体通过环境中的运行时调用 Action；独立二进制 Skill 则指导智能体直接以子进程方式运行 `./bin/<binary> run <action> --input '<json>'`。

---

## 常用操作速查

- **全量独立二进制构建**：
  ```bash
  ad build
  ```
- **指定目标平台与输出路径构建**：
  ```bash
  ad build --target linux-x64 --out ./dist/bin/server-tools
  ```
- **指定部分 Action 构建**：
  ```bash
  ad build --actions sample.greet,calc.sum
  ```
- **导出默认源码型 Skill**：
  ```bash
  ad export skill
  ```
- **导出独立二进制型 Skill 并归档为压缩包**：
  ```bash
  ad export skill --standalone --target linux-x64 --archive
  ```
- **按 Playbook 最小依赖闭包导出**：
  ```bash
  ad export skill --playbook greet-user --out ./dist/greet-skill
  ```
