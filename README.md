# ActionDock

**ActionDock** 是一个面向团队协作的脚本平台，同时也是一个面向大模型接入的 AI 工具工作台。

它把脚本、插件、仓库分发和 AI 调用能力统一纳入同一套运行体系，让同一个工具既能给人使用，也能稳定地给 API、Agent 和 SKILL 使用。

## 核心定位

- **脚本平台**：管理 Groovy / Python 脚本的编辑、校验、发布、执行、调度、审计和仓库同步
- **AI 工具工作台**：管理模型、Agent、Toolset、AI 调用日志，以及脚本生成、诊断、评审等辅助能力
- **统一工具抽象**：用 Schema、稳定执行入口、依赖与日志记录，把“脚本”升级为“可治理的工具资产”

## 通用共享状态存储

ActionDock 内置了一个通用共享状态存储，适合多个脚本或外部流程复用同一份运行时状态，而不需要自行落文件或额外接一套缓存。

- 存储模型：`namespace + key + JSON value`
- 支持 `secret` 标记
- 支持 `expiresAt` 过期时间
- 支持 `version` 与 CAS
- 支持脚本侧直接访问，也支持 REST API 和管理台操作

适合的典型场景：

- OAuth / API Token 缓存与续期
- 游标、断点、增量同步位置
- 多步骤工作流的阶段性结果
- 外部系统轮询的时间戳、水位线、批次号

按职责查看细节：

- REST API 与管理台入口见 [actiondock-app-spring](actiondock-app-spring/README.md)
- 脚本内 `state` 用法见 [actiondock-app-support](actiondock-app-support/README.md)
- 领域模型与持久化范围见 [actiondock-core](actiondock-core/README.md) 与 [actiondock-storage-jpa](actiondock-storage-jpa/README.md)

## 快速开始

### 前置要求

- JDK 21+
- Maven 3.9+
- Node.js 18+（前端开发需要）
- Python 3.x（执行 `PYTHON` 类型脚本需要，默认命令为 `python3`）

### 构建与启动

```bash
# 编译全部模块
mvn clean package -DskipTests

# 启动 Web 应用
mvn -pl actiondock-app-spring -am spring-boot:run
```

## 分发形态

- `actiondock-server`：独立发布的服务端，推荐 `npm i -g actiondock-server` 后执行 `actiondock-server`

服务端会低频检查 npm 最新版本，并输出手动升级提示；可用 `ACTIONDOCK_NO_UPDATE_NOTIFIER=1` 关闭提醒。

### 前端开发

```bash
cd actiondock-admin-ui
npm install
npm run dev
```

- 管理台开发地址：`http://localhost:5173/admin/scripts`
- 管理台生产地址：`http://localhost:8080/admin/scripts`

### Docker

```bash
docker compose up -d --build
docker compose logs -f actiondock
docker compose down
```

## 文档地图

根文档只保留总览。细节按模块拆分到各自 README：

| 模块 | 说明 |
|------|------|
| [actiondock-app-spring](actiondock-app-spring/README.md) | Spring Boot Web 入口、REST API、管理台挂载方式 |
| [actiondock-admin-ui](actiondock-admin-ui/README.md) | React 管理台、页面结构、前端开发方式 |
| [actiondock-core](actiondock-core/README.md) | 脚本平台核心领域模型、执行模型、仓库与发布规则 |
| [actiondock-app-support](actiondock-app-support/README.md) | 运行时装配、脚本引擎、插件运行时、仓库解析与默认配置 |
| [actiondock-plugin-api](actiondock-plugin-api/README.md) | PF4J 插件 SPI、Manifest 协议、脚本侧调用上下文 |
| [actiondock-plugin-template](actiondock-plugin-template/README.md) | 自定义插件模板与开发示例 |
| [actiondock-storage-jpa](actiondock-storage-jpa/README.md) | JPA/H2 持久化适配、实体与仓储实现 |
| [actiondock-ai-api](actiondock-ai-api/README.md) | AI 领域抽象：模型、Agent、Toolset、Tool、调用日志 |
| [actiondock-ai-core](actiondock-ai-core/README.md) | AI 核心服务与运行时编排 |
| [actiondock-ai-agentscope](actiondock-ai-agentscope/README.md) | 基于 AgentScope 的 Provider 实现与内置工具桥接 |
| [actiondock-ai-plugin-bridge](actiondock-ai-plugin-bridge/README.md) | 内置系统插件 `actiondock-ai` 与脚本中的 AI 调用方式 |

## 模块结构

```text
actiondock
├── actiondock-core
├── actiondock-ai-api
├── actiondock-ai-core
├── actiondock-ai-agentscope
├── actiondock-ai-plugin-bridge
├── actiondock-plugin-api
├── actiondock-plugin-template
├── actiondock-storage-jpa
├── actiondock-app-support
├── actiondock-app-spring
└── actiondock-admin-ui
```

## 建议阅读顺序

1. 先看 [actiondock-core](actiondock-core/README.md)，理解脚本平台的领域模型和发布/执行规则
2. 再看 [actiondock-app-support](actiondock-app-support/README.md)，理解运行时如何装配脚本、插件、仓库和配置
3. 然后看 [actiondock-app-spring](actiondock-app-spring/README.md) 和 [actiondock-admin-ui](actiondock-admin-ui/README.md)，理解对外入口
4. 如果关注 AI 能力，再依次看 [actiondock-ai-api](actiondock-ai-api/README.md)、[actiondock-ai-core](actiondock-ai-core/README.md)、[actiondock-ai-agentscope](actiondock-ai-agentscope/README.md)、[actiondock-ai-plugin-bridge](actiondock-ai-plugin-bridge/README.md)
5. 如果要扩展插件，再看 [actiondock-plugin-api](actiondock-plugin-api/README.md) 和 [actiondock-plugin-template](actiondock-plugin-template/README.md)
