# 消费与接入总览 (Consumer Overview)

作为 ActionDock 制品的**使用者（Consumer）**，不需要关心底层如何编写 TypeScript 逻辑或构建编译器。无论你是从 Git 仓库克隆了项目源码、收到了导出的 Skill 交付包，还是下载了独立二进制文件，都可以根据使用环境选择最适合的消费姿态。

---

## 消费姿态对比速查

| 消费姿态 | 适用场景 | 目标客户端 / 宿主 | 环境依赖 |
| :--- | :--- | :--- | :--- |
| **Agent Skill** | 大模型自主理解 SOP 并调用 | Claude Code, Antigravity, Codex | 源码型需 Bun；独立型零依赖 |
| **MCP 服务** | 本地 IDE 工具调用 | Cursor, Windsurf, Claude Code, VSCode | 本地安装 `ac` CLI 或指定独立二进制 |
| **独立单文件 CLI** | 终端手动执行 / CI 脚本 / 容器 | Linux, macOS, Windows 终端 / CI 沙箱 | **零依赖**（无需 Bun/Node） |
| **HTTP 远程微服务** | 远程集群 / 多租户 SaaS / REST 调度 | 任意支持 HTTP/cURL 的 Agent 或业务系统 | 服务端需 `ac serve` 运行 |

---

## 克隆项目快速跑通

从 Git 仓库克隆 Action Package 后的标准步骤：

```text
git clone <repo> ──► 安装/链接依赖 ──► 查看能力清单 ──► 注入配置 ──► 接入使用
```

### 安装或链接依赖
```bash
cd my-tools

# SDK 已发布 npm 时：
bun install

# SDK 处于本地开发态时（如遇 404）：
bun link @actiondock/sdk
```

### 检查包能力清单与模糊探索
```bash
# 当前项目内查看详情
ac info

# 跨目录或全局意图模糊搜索（首选能力发现入口）
ac info github
ac info -i "browser|search"
```

### 设置必要的 Token 与配置项
```bash
# 查看该包声明了哪些必填配置
ac config schema

# 设置配置（自动保存在本地 SQLite 中，安全不泄露）
ac config set GITHUB_TOKEN ghp_xxxxxxxxx
```

### 跨目录全局调用（可选）
在系统的任意目录直接调用该包的 Action：
```bash
# 在当前项目目录下执行注册：
ac link

# 在任意其他目录下均可调度：
ac run my-tools/get-pr --input '{"repo": "team4u/actiondock", "prNumber": 1}'
```

---

## 各消费姿态接入指南

- [接入 Claude Code / Antigravity (Agent Skill)](use-as-skill.md)：将 Skill 放入技能目录让 AI 自动发现。
- [接入 Cursor / Windsurf / IDE (MCP 服务)](use-as-mcp.md)：在 IDE 配置文件中添加 STDIO MCP Server。
- [独立二进制单文件运行 (零环境依赖)](standalone-run.md)：在生产服务器或沙箱中免依赖运行。
- [HTTP 远程微服务与 REST 调度](http-service.md)：启动 HTTP 服务并通过 cURL 或 API 远程调用。
- [消费端配置与凭证注入](configuration.md)：配置覆盖、环境变量与安全 Token 管理。
