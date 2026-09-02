# 独立二进制与免环境运行

ActionDock 支持通过 `ac build` 将整个 Action Package（包含所有 Action 逻辑、嵌入式 SQLite 引擎、配置系统与 CLI 调度器）编译为**单个零外部依赖的独立可执行文件**。

在目标服务器、轻量 Docker 镜像、CI/CD 构建机或沙箱中，**无需安装 Bun、Node.js 或任何 npm 依赖**。

---

## 编译与获取独立可执行文件

在官方示例目录执行 `ac build`：

```bash
cd examples/github-tools
ac build
```

编译完成后会在 `./bin/` 目录下生成跨平台自包含二进制（如 `./bin/github-tools`）。

---

## 运行独立可执行文件

在 Linux/macOS 下赋予执行权限后直接运行：

```bash
chmod +x ./bin/github-tools

# 查看内置的 Actions 列表与元数据
./bin/github-tools info

# 查看帮助信息
./bin/github-tools --help
```

---

## 直接在命令行调用 Action

通过 `run` 命令传入 JSON 参数或 JSON 文件（同样支持无 Token 的示例降级模式）：

```bash
# 行内 JSON 字符串
./bin/github-tools run github.list-prs --input '{"repo": "team4u/actiondock"}'

# 指定输入文件
./bin/github-tools run github.get-pr --input ./input.json
```

### 标准 JSON Envelope 输出
命令成功执行后，标准输出 (`stdout`) 会输出机器可解析的 JSON Envelope：

```json
{
  "ok": true,
  "runId": "01JMB394...",
  "data": {
    "items": [
      {
        "number": 101,
        "title": "feat(core): support bun native compilation",
        "author": "octocat",
        "state": "open"
      }
    ],
    "count": 1
  }
}
```

---

## 在独立可执行文件中管理配置

独立二进制同样内嵌了独立的 SQLite 配置存储系统：

```bash
# 设置凭证（存入工作区 SQLite 数据库）
./bin/github-tools config set GITHUB_TOKEN ghp_xxxxxxxxx

# 查看配置需求清单
./bin/github-tools config schema
```

也可以直接通过操作系统环境变量传入配置：
```bash
GITHUB_TOKEN=ghp_xxxxxxxxx ./bin/github-tools run github.list-prs --input '{"repo": "team4u/actiondock"}'
```

---

## 启动内置的 MCP 或 HTTP 服务

独立二进制保留了完整的服务模式，无需安装任何开发环境：

```bash
# 启动为零依赖的 MCP STDIO 服务（供 Cursor/Claude 直连）
./bin/github-tools mcp

# 启动为轻量 HTTP REST API 微服务
./bin/github-tools serve --host 0.0.0.0 --port 8080 --token "your-secret-token"
```
