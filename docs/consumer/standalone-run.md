# 独立二进制与免环境运行 (Standalone Run)

ActionDock 支持通过 `ac build` 将整个 Action Package（包含所有 Action 逻辑、嵌入式 SQLite 引擎、配置系统与 CLI 调度器）编译为**单个零外部依赖的独立可执行文件**。

对于使用者而言，这意味着在目标服务器、轻量 Docker 镜像、CI/CD 构建机或沙箱中，**完全不需要安装 Bun、Node.js 或任何 npm 依赖**。

---

## 1. 运行独立可执行文件

假设你从发布页下载了 `my-tools`（Linux/macOS 下需赋予执行权限）：

```bash
chmod +x ./my-tools

# 查看内置的 Actions 列表与元数据
./my-tools info

# 查看帮助
./my-tools --help
```

---

## 2. 直接在命令行调用 Action

通过 `run` 命令传入 JSON 参数或 JSON 文件：

```bash
# 方式 A：行内 JSON 字符串
./my-tools run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 1}'

# 方式 B：指定输入文件
./my-tools run github.get-pr --input ./input.json
```

### 标准 JSON Envelope 输出
命令成功执行后，标准输出 (`stdout`) 会严格输出机器可解析的 JSON Envelope：

```json
{
  "ok": true,
  "runId": "01JMB394...",
  "data": {
    "id": 123456,
    "number": 1,
    "title": "feat: standalone build support",
    "state": "open"
  }
}
```

---

## 3. 在独立可执行文件中管理配置

独立二进制同样内嵌了独立的 SQLite 配置存储系统：

```bash
# 设置凭证（存入当前工作区或默认 SQLite 数据库）
./my-tools config set GITHUB_TOKEN ghp_xxxxxxxxx

# 查看配置需求清单
./my-tools config schema
```

你也可以直接通过操作系统环境变量传入配置：
```bash
GITHUB_TOKEN=ghp_xxxxxxxxx ./my-tools run github.get-pr --input '{"repo": "team4u/actiondock", "prNumber": 1}'
```

---

## 4. 启动内置的 MCP 或 HTTP 服务

独立二进制保留了完整的服务模式：

```bash
# 启动为零依赖的 MCP STDIO Server（供 Cursor/Claude 直连）
./my-tools mcp

# 启动为轻量 HTTP REST API 微服务
./my-tools serve --port 8080 --token "your-secret-token"
```
