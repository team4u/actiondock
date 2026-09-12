# Node 交付产物运行指南

当从开发团队或构建流水线获取到自包含的 Node 目录型交付产物后，可以直接在目标宿主环境中运行 Action，无需在目标系统上全局安装 ActionDock CLI 工具链。

若需要了解如何从源码构建生成此类交付目录，请参阅 [构建打包与 Skill 导出规范](../developer/build-and-export.md)。

---

## 运行环境要求

- Node.js 运行时环境（版本大于等于 24.12.0）。
- 依托 Node.js 原生驱动能力，宿主环境无需预装全局 ActionDock 工具。

---

## 交付目录结构说明

标准的 Node 目录型交付产物包含以下核心文件与目录：

```text
delivery-package/
├── entry.mjs              # 统一的独立运行入口分发器脚本
├── actiondock.json        # 经过依赖闭包裁剪后的项目契约清单
├── actions/               # Action 业务执行函数源码文件
├── playbooks/             # 关联的操作规程文档
└── node_modules/          # 锁定的生产依赖（构建时物化）
```

交付目录保留 Action 业务源码与独立的运行时分发脚本，利用 Node.js 24 原生能力直接执行。

---

## 探索与能力自省

进入交付产物目录后，可直接通过 `node ./entry.mjs` 调用内置分发器进行能力自省：

```bash
# 查看交付产物元数据与内置 Action 列表
node ./entry.mjs info

# 列出所有可用 Action 标识
node ./entry.mjs list

# 查看特定 Action 的输入输出模式定义与参数规范
node ./entry.mjs describe list-prs

# 查看帮助信息
node ./entry.mjs --help
```

---

## 命令行调用 Action

通过 `run` 子命令指定 Action 标识与调用参数：

### 行内 JSON 字符串传参

```bash
node ./entry.mjs run list-prs --input '{"repo": "team4u/actiondock"}'
```

### 指定参数文件传参

对于结构复杂或体量较大的输入参数，建议保存在本地 JSON 文件中并指定路径：

```bash
node ./entry.mjs run get-pr --input-file ./input.json
```

---

## 标准输出信封

调用完成后，入口分发器在标准输出通道输出标准 JSON 信封结构：

```json
{
  "ok": true,
  "runId": "01JMB394...",
  "data": {
    "items": [
      {
        "number": 101,
        "title": "feat(core): support native node execution",
        "author": "octocat",
        "state": "open"
      }
    ],
    "count": 1
  }
}
```

- 若执行成功，`ok` 为 `true`，业务数据承载于 `data` 字段。
- 若执行失败，`ok` 为 `false`，错误信息承载于 `error` 字段（包含结构化错误码 `code` 与可读提示 `message`）。
- 业务日志与调试信息统一输出至标准错误通道，确保标准输出的纯净性，便于流水线与下游脚本通过 `jq` 等工具无缝解析。

---

## 配置与凭据管理

独立交付目录内置了基于当前目录的 SQLite 配置存储，支持在本地管理业务所需的 API 密钥与环境变量：

### 通过命令行配置凭据

```bash
# 设置凭据
node ./entry.mjs config set GITHUB_TOKEN ghp_xxxxxxxxx

# 查看当前已配置的项
node ./entry.mjs config list

# 查看配置字段需求清单
node ./entry.mjs config schema
```

### 通过系统环境变量注入

亦可在执行命令时直接通过操作系统环境变量传入配置：

```bash
GITHUB_TOKEN=ghp_xxxxxxxxx node ./entry.mjs run list-prs --input '{"repo": "team4u/actiondock"}'
```

---

## 独立入口运行限制说明

- 单次进程同步模型：独立入口运行于单次进程生命周期边界中，仅支持同步阻塞执行模式。如果传入 `--async` 参数，系统将直接拒绝执行并返回 `STANDALONE_ASYNC_UNSUPPORTED` 结构化错误。若需要长耗时后台异步任务与任务流管理，请使用 HTTP 微服务模式（`ad serve`）。
- 目录内相对路径隔离：数据存储与配置默认持久化在交付目录自身的工作区内，确保跨宿主移植时的环境独立性。
