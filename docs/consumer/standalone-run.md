# Node.js 目录独立运行指南

ActionDock 支持通过 `ad build` 将整个 Action Package（包含所有 Action 逻辑、嵌入式 SQLite 引擎、配置系统与调度器）构建为**自包含的 Node.js 交付目录**。

在目标服务器、轻量容器镜像或流水线沙箱中，仅需安装满足版本约束的 Node.js（版本大于等于 24.12.0），无需安装全局 ActionDock CLI 工具链。

---

## 构建独立交付目录

在 Action Package 根目录下执行 `ad build`：

```bash
# 构建到默认 dist 目录
ad build

# 指定输出目录并固化生产依赖
ad build --out ./dist/app --vendor-deps

# 生成标准 zip 归档压缩包
ad build --out ./dist/app.zip --archive
```

构建完成后，输出目录下将包含：
- `entry.mjs`：统一的独立运行入口分发器脚本。
- `actions/`：编译转换后的 JavaScript 动作代码。
- `actiondock.json`：项目元数据与契约规范清单。
- `node_modules/`：固化的生产依赖（指定 `--vendor-deps` 时）。

---

## 运行独立入口

在目标环境直接通过 Node.js 执行入口脚本：

```bash
# 查看内置 Actions 列表与元数据
node ./dist/app/entry.mjs info

# 列出可用动作
node ./dist/app/entry.mjs list

# 查看帮助信息
node ./dist/app/entry.mjs --help
```

---

## 命令行调用 Action

通过 `run` 子命令传入 JSON 参数或参数文件：

```bash
# 行内 JSON 字符串传参
node ./dist/app/entry.mjs run list-prs --input '{"repo": "team4u/actiondock"}'

# 指定输入文件传参
node ./dist/app/entry.mjs run get-pr --input-file ./input.json
```

### 标准 JSON 信封输出
命令执行完毕后，标准输出输出机器可解析的标准 JSON 信封：

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

---

## 独立入口运行限制说明

- 单次进程同步模型：独立入口运行于单次进程边界中，不提供跨进程后台异步任务语义。如果在独立入口执行命令时传入 `--async` 参数，系统将直接拒绝并返回 `STANDALONE_ASYNC_UNSUPPORTED` 结构化错误。
- 依赖版本要求：目标宿主环境需具备 Node.js 24.12.0 或更高版本。

---

## 独立入口中的配置管理

独立入口同样内嵌了独立的 SQLite 配置存储系统：

```bash
# 设置凭据
node ./dist/app/entry.mjs config set GITHUB_TOKEN ghp_xxxxxxxxx

# 查看配置需求清单
node ./dist/app/entry.mjs config schema
```

亦可直接通过操作系统环境变量传入配置：
```bash
GITHUB_TOKEN=ghp_xxxxxxxxx node ./dist/app/entry.mjs run list-prs --input '{"repo": "team4u/actiondock"}'
```
