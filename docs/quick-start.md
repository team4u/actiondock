# 快速开始

## 一句话理解

ActionDock 是一个脚本资产化平台：你把一段代码（Groovy 或 Python）注册进去，定义好输入输出格式，发布为不可变版本，然后就可以通过管理台、API、CLI、定时任务、Webhook 事件等方式反复执行它——每次执行都有完整的审计记录。

## 系统要求

| 组件 | 最低版本 | 说明 |
|------|----------|------|
| JDK | 21+ | 必须。ActionDock 利用 Java 21 的虚拟线程和 Record 特性 |
| Maven | 3.9+ | 本地从源码构建时需要 |
| Node.js | 18+ | 前端开发或使用 CLI 工具时需要 |
| Python | 3.x | 执行 PYTHON 类型脚本时需要，默认命令为 `python3` |
| Docker | 可选 | 容器化部署 |

## 安装与启动

### 方式一：CLI 一键安装（推荐）

```bash
# 全局安装 ActionDock CLI
npm install -g actiondock

# 启动服务（前台运行）
actiondock server
```

### 方式二：从源码构建

```bash
# 克隆项目
git clone <repository-url>
cd action-dock

# 编译所有模块（-am 自动构建依赖模块）
mvn -pl actiondock-app-spring -am -DskipTests compile

# 启动服务
mvn -pl actiondock-app-spring -am -DskipTests spring-boot:run
```

## 启动后验证

启动成功后，访问以下地址：

| 功能 | URL |
|------|-----|
| 管理台 | http://localhost:5177/admin/app/scripts |
| REST API | http://localhost:5177/api |
| Swagger UI | http://localhost:5177/swagger-ui.html |

## 第一个脚本：Hello World

服务初始化时会自带示例脚本 `hello-groovy`。这里演示通过三种入口执行它。

### 从管理台运行（UI）

1. 打开 http://localhost:5177/admin/app/scripts
2. 在脚本列表中找到 `hello-groovy`（来源为 `SAMPLE`，状态为 `PUBLISHED`）
3. 点击该行右侧的「运行」按钮
4. 在弹出的执行面板中，输入参数：`name: alice`
5. 点击「执行」，查看返回结果

### 从 REST API 运行

```bash
curl -X POST http://localhost:5177/api/scripts/hello-groovy/execute \
  -H 'Content-Type: application/json' \
  -d '{
    "input": {"name": "alice"},
    "mode": "SYNC",
    "responseView": "RESULT"
  }'
```

**请求参数说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `input` | object | 是 | 匹配脚本 `inputSchema` 的入参 |
| `mode` | string | 否 | `SYNC`（同步等结果）或 `ASYNC`（异步提交），默认 `SYNC` |
| `responseView` | string | 否 | `RESULT`（仅输出）、`DEBUG`（含完整上下文），默认 `RESULT` |

**响应示例：**

```json
{
  "code": 200,
  "message": "已受理",
  "data": {
    "id": "exec-xxxx",
    "scriptId": "hello-groovy",
    "status": "SUCCESS",
    "submitMode": "SYNC",
    "output": {
      "greeting": "Hello, alice!",
      "timestamp": 1715000000000
    },
    "createdAt": "2026-05-06T16:00:00",
    "startedAt": "2026-05-06T16:00:00",
    "finishedAt": "2026-05-06T16:00:01"
  }
}
```

### 从 CLI 运行

```bash
# 默认连接本机服务 http://127.0.0.1:5177
actiondock script run hello-groovy --name alice --json
```

`--json` 参数让输出格式化为 JSON，便于管道处理。

### 从定时任务自动运行

1. 进入「触发中心 → 定时触发」
2. 点击「新建」
3. 选择脚本 `hello-groovy`，设置 Cron 表达式 `0 */5 * * *`（每 5 分钟）
4. 输入参数：`{"name": "timer"}`
5. 保存并启用
6. 每次触发自动创建执行记录，可在脚本执行历史中查看

## UI 导览：管理台布局

打开管理台后，左侧导航栏分为四个区域：

```
能力区
├── 脚本库      ← 创建、编辑、管理所有脚本
├── 插件管理    ← 安装和管理 PF4J 插件
├── Skills 管理 ← 管理技能目标与安装
└── AI          ← 模型配置、Agent、Toolset、运行记录

资源区
├── 仓库发现    ← 浏览可安装的脚本/插件/Skills
└── 仓库管理    ← 配置 Git/本地仓库

触发区
└── 触发中心    ← 定时任务、Webhook、Webhook、执行记录

设置区
├── 配置值      ← API Key 等全局配置
├── 共享状态    ← 跨脚本的键值存储
├── 访问令牌    ← API Bearer Token 管理
├── 控制台凭证  ← 当前会话的 Token
└── 数据备份    ← 数据导入导出
```

## 下一步该做什么

1. 了解如何 [创建和管理脚本](script-management.md)
2. 学习 [脚本编写指南](script-writing-guide.md) 掌握运行时 API
3. 配置 [AI 模型](ai-capabilities.md) 让 Agent 调用你的脚本
4. 通过 [仓库与分发](repository-distribution.md) 把脚本分发给团队
5. 设置 [Webhook](trigger-center.md) 接入外部系统 Webhook

---

> [返回目录](user-manual.md)
