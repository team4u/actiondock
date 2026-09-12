# Node 交付产物运行指南

当从开发团队或构建流水线获取到 Node 目录型交付产物后，可以直接在目标宿主环境中运行 Action，无需在目标系统上全局安装 ActionDock CLI 工具链。

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
└── node_modules/          # 锁定的生产依赖（构建时若指定 --vendor-deps 则内嵌物化）
```

交付目录保留 Action 业务源码与独立的运行时分发脚本。若交付产物构建时未携带 `--vendor-deps`，首次使用时可在该目录下执行 `npm install --omit=dev` 安装生产依赖。

---

## 探索与能力自省

进入交付产物目录后，可直接通过 `node ./entry.mjs` 调用内置分发器进行能力探索：

```bash
# 列出所有可用 Action 标识与简要描述
node ./entry.mjs list

# 查看特定 Action 的输入输出模式定义与参数规范
node ./entry.mjs describe list-prs

# 查看版本号
node ./entry.mjs --version

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

对于结构复杂或体量较大的输入参数，建议保存在本地 JSON 文件中并通过文件路径传递：

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
- 业务日志与调试信息统一输出至标准错误通道，确保标准输出纯净，便于下游工具通过管道无缝解析。

---

## 配置与持久化数据管理

独立入口内置了基于 SQLite 的配置与状态存储管理：

### 凭据与配置管理

可通过 `config` 子命令管理运行时配置项：

```bash
# 查看所有已生效的配置项字典
node ./entry.mjs config list

# 获取特定配置项的值
node ./entry.mjs config get GITHUB_TOKEN

# 设置持久化配置项
node ./entry.mjs config set GITHUB_TOKEN ghp_xxxxxxxxx

# 删除配置项
node ./entry.mjs config delete GITHUB_TOKEN
```

亦可在执行命令时直接通过操作系统环境变量传入配置：

```bash
GITHUB_TOKEN=ghp_xxxxxxxxx node ./entry.mjs run list-prs --input '{"repo": "team4u/actiondock"}'
```

### 查看持久化状态数据

可通过 `state` 子命令查看 Action 写入的持久化状态：

```bash
# 列出当前包下的状态键列表
node ./entry.mjs state list

# 查看特定状态键的值
node ./entry.mjs state get <key>
```

---

## 数据存储路径与运行限制说明

- 默认数据存储路径：若未显式指定 `--data-dir`，系统默认使用当前操作系统用户主目录路径：
  - 数据存储位于 `~/.actiondock/data/<packageId>/runtime.db`。
  - 全局配置存储位于 `~/.actiondock/global.db`。
- 目录内局部持久化：若需要将数据完全持久化在交付目录自身（如容器隔离或离线移动部署），请在调用命令时显式传入 `--data-dir` 参数：
  ```bash
  node ./entry.mjs --data-dir ./data run list-prs --input '{"repo": "team4u/actiondock"}'
  ```
- 单次进程同步模型：独立入口运行于单次进程生命周期边界中，仅支持同步阻塞执行模式。如果传入 `--async` 参数，系统将直接拒绝执行并返回 `STANDALONE_ASYNC_UNSUPPORTED` 结构化错误。若需要长耗时后台异步任务与任务流管理，请使用 HTTP 微服务模式（`ad serve`）。
