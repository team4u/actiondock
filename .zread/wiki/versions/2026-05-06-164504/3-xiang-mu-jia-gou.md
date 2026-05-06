ActionDock 采用**分层模块化架构**，将脚本执行、AI 能力、插件扩展和 Web 界面解耦为独立模块，通过清晰的接口定义实现模块间松耦合协作。项目基于 **Spring Boot 3.3.5** 和 **Java 21** 构建，前端使用 **React + TypeScript + Vite** 技术栈，CLI 采用 **Node.js + oclif** 框架。

Sources: [pom.xml](pom.xml#L1-L52) | [CLAUDE.md](CLAUDE.md#L1-L8)

---

## 系统架构总览

```mermaid
graph TB
    subgraph "用户交互层"
        UI["React 管理台<br/>(actiondock-admin-ui)"]
        CLI["Node.js CLI<br/>(actiondock-cli)"]
        REST["REST API"]
    end
    
    subgraph "Spring Boot 应用层"
        SPRING["actiondock-app-spring<br/>(RuntimeApplication)"]
    end
    
    subgraph "运行时装配层"
        SUPPORT["actiondock-app-support"]
    end
    
    subgraph "核心领域层"
        CORE["actiondock-core"]
        AI_API["actiondock-ai-api"]
        AI_CORE["actiondock-ai-core"]
    end
    
    subgraph "基础设施层"
        STORAGE["actiondock-storage-jpa<br/>(H2 + JPA)"]
        PLUGIN_API["actiondock-plugin-api"]
    end
    
    UI -->|HTTP/WebSocket| REST
    CLI -->|HTTP| REST
    REST --> SPRING
    SPRING --> SUPPORT
    SUPPORT --> CORE
    SUPPORT --> AI_API
    SUPPORT --> AI_CORE
    SUPPORT --> STORAGE
    SUPPORT --> PLUGIN_API
    
    style UI fill:#e1f5fe
    style CLI fill:#fff3e0
    style REST fill:#f3e5f5
    style CORE fill:#e8f5e9
    style AI_CORE fill:#e8f5e9
    style STORAGE fill:#eceff1
```

Sources: [actiondock-app-spring/src/main/java/org/team4u/actiondock/RuntimeApplication.java](actiondock-app-spring/src/main/java/org/team4u/actiondock/RuntimeApplication.java#L1-L59)

---

## 模块依赖关系

```mermaid
graph LR
    subgraph "外部依赖"
        SPRING["Spring Boot 3.3.5"]
        PF4J["PF4J 3.13.0"]
        GROOVY["Groovy 4.0.24"]
        REACT["React + Ant Design"]
        OCLIF["oclif CLI 框架"]
    end
    
    subgraph "核心模块 (Maven 多模块)"
        CORE["actiondock-core<br/>领域模型与应用服务"]
        AI_API["actiondock-ai-api<br/>AI 抽象接口"]
        AI_CORE["actiondock-ai-core<br/>AI 服务实现"]
        AI_AGENT["actiondock-ai-agentscope<br/>Provider 适配器"]
        AI_BRIDGE["actiondock-ai-plugin-bridge<br/>插件桥接"]
        PLUGIN_API["actiondock-plugin-api<br/>插件 SPI"]
        PLUGIN_TPL["actiondock-plugin-template<br/>插件模板"]
        STORAGE["actiondock-storage-jpa<br/>JPA 持久化"]
        SUPPORT["actiondock-app-support<br/>运行时装配"]
        SPRING_APP["actiondock-app-spring<br/>Spring 启动入口"]
    end
    
    CORE --> STORAGE
    AI_API --> CORE
    AI_CORE --> AI_API
    AI_AGENT --> AI_API
    AI_BRIDGE --> AI_CORE
    AI_BRIDGE --> PLUGIN_API
    PLUGIN_TPL --> PLUGIN_API
    SUPPORT --> CORE
    SUPPORT --> AI_CORE
    SUPPORT --> AI_API
    SUPPORT --> PLUGIN_API
    SUPPORT --> STORAGE
    SPRING_APP --> SUPPORT
```

Sources: [pom.xml](pom.xml#L24-L38)

---

## 模块职责矩阵

| 模块 | 编程语言 | 职责范围 | 关键组件 |
|------|---------|---------|---------|
| **actiondock-core** | Java | 核心领域模型与应用服务，不依赖具体实现 | `ScriptApplicationService`、`ExecutionApplicationService`、领域实体、仓储接口 |
| **actiondock-ai-api** | Java | AI 领域抽象接口定义 | `AiGateway`、`AiAgentRuntime`、`AiToolRegistry` |
| **actiondock-ai-core** | Java | AI 服务实现与编排逻辑 | `AiModelProfileService`、`AiAgentRuntimeImpl`、`AiToolRegistryImpl` |
| **actiondock-ai-agentscope** | Java | AgentScope Provider 适配器 | `AgentScopeAiProviderClient`、`AgentScopeBuiltinAiTools` |
| **actiondock-ai-plugin-bridge** | Java | AI 与插件系统的桥接 | `ActionDockAiSystemPlugin` |
| **actiondock-plugin-api** | Java | PF4J 插件 SPI 定义 | `ActionDockPlugin`、`PluginManifest` |
| **actiondock-plugin-template** | Java | 插件开发模板 | 最小可运行插件示例 |
| **actiondock-storage-jpa** | Java | JPA 持久化适配层 | `SpringData*Repository`、Entity 映射 |
| **actiondock-app-support** | Java | 运行时装配与脚本引擎 | `GroovyScriptEngine`、`PythonScriptEngine`、`PluginRuntimeService` |
| **actiondock-app-spring** | Java | Spring Boot 入口与 Web 层 | `RuntimeApplication`、REST Controller |
| **actiondock-admin-ui** | TypeScript/React | 管理控制台前端 | React 页面组件、Monaco Editor |
| **actiondock-cli** | TypeScript/Node.js | CLI 命令行工具 | oclif 命令、服务管理 |

Sources: [actiondock-core/README.md](actiondock-core/README.md#L1-L84) | [actiondock-ai-api/README.md](actiondock-ai-api/README.md#L1-L40) | [actiondock-admin-ui/README.md](actiondock-admin-ui/README.md#L1-L67)

---

## 核心领域模型

```mermaid
classDiagram
    class ScriptDefinition {
        +String id
        +ScriptType type
        +ScriptPackaging packaging
        +String source
        +Map inputSchema
        +Map outputSchema
        +ScriptStatus status
        +PublishedScriptSnapshot publishedSnapshot
        +ScriptScope scope
        +List~ScriptDependency~ scriptDependencies
        +List~PluginDependency~ pluginDependencies
        +List~AiDependency~ aiDependencies
    }
    
    class PublishedScriptSnapshot {
        +String source
        +String inputSchema
        +String outputSchema
        +Integer version
        +LocalDateTime publishedAt
    }
    
    class ExecutionRecord {
        +String id
        +String scriptId
        +ExecutionStatus status
        +Map input
        +Map output
        +List~ExecutionLogEntry~ logs
        +ErrorDetail error
    }
    
    class PluginRegistration {
        +String pluginId
        +String version
        +String path
        +PluginManifest manifest
    }
    
    class AiAgentProfile {
        +String id
        +String name
        +AiModelProfile modelProfile
        +List~AiToolset~ toolsets
        +AiAgentSkill~ skills~
    }
    
    ScriptDefinition --> PublishedScriptSnapshot : 发布快照
    ScriptDefinition --> ExecutionRecord : 执行记录
    ExecutionRecord --> ExecutionLogEntry : 日志
```

Sources: [actiondock-core/src/main/java/org/team4u/actiondock/domain/model/ScriptDefinition.java](actiondock-core/src/main/java/org/team4u/actiondock/domain/model/ScriptDefinition.java#L1-L200)

---

## 脚本执行架构

脚本引擎采用**端口与适配器模式**，通过 `ScriptEngine` 接口抽象不同脚本语言的执行能力：

```mermaid
graph LR
    subgraph "调用入口"
        API["REST API"]
        CLI["CLI"]
        AGENT["AI Agent"]
    end
    
    subgraph "应用服务层"
        SVC["ScriptInvocationService"]
    end
    
    subgraph "引擎抽象层"
        ENG["ScriptEngine 接口"]
    end
    
    subgraph "具体引擎"
        GROOVY["GroovyScriptEngine<br/>(JVM 内编译执行)"]
        PYTHON["PythonScriptEngine<br/>(子进程执行)"]
    end
    
    API --> SVC
    CLI --> SVC
    AGENT --> SVC
    SVC --> ENG
    ENG --> GROOVY
    ENG --> PYTHON
    
    subgraph "脚本上下文注入"
        CTX["plugins、scripts、state、log、config"]
    end
    
    GROOVY --> CTX
    PYTHON --> CTX
```

Sources: [actiondock-core/src/main/java/org/team4u/actiondock/domain/port/ScriptEngine.java](actiondock-core/src/main/java/org/team4u/actiondock/domain/port/ScriptEngine.java#L1-L41) | [actiondock-app-support/README.md](actiondock-app-support/README.md#L1-L294)

---

## 插件系统架构

基于 **PF4J (Plugin Framework for Java)** 实现动态插件加载：

```mermaid
graph TB
    subgraph "主应用 (Host)"
        PLUGIN_RT["PluginRuntimeService"]
        ENG["ScriptEngine"]
    end
    
    subgraph "插件 API 层 (actiondock-plugin-api)"
        PLUGIN_IF["ActionDockPlugin 接口"]
        MANIFEST["PluginManifest"]
    end
    
    subgraph "插件 (Plugins)"
        PLUGIN_A["Plugin A<br/>(JAR)"]
        PLUGIN_B["Plugin B<br/>(JAR)"]
    end
    
    subgraph "脚本调用"
        GR["Groovy 脚本"]
        PY["Python 脚本"]
    end
    
    PLUGIN_RT -->|加载/管理| PLUGIN_A
    PLUGIN_RT -->|加载/管理| PLUGIN_B
    PLUGIN_A -->|实现| PLUGIN_IF
    PLUGIN_B -->|实现| PLUGIN_IF
    PLUGIN_A -->|读取| MANIFEST
    PLUGIN_B -->|读取| MANIFEST
    ENG -->|plugins.invoke()| PLUGIN_RT
    GR -->|plugins.invoke()| ENG
    PY -->|plugins.invoke()| ENG
```

Sources: [actiondock-plugin-api/README.md](actiondock-plugin-api/README.md#L1-L46) | [actiondock-plugin-template/README.md](actiondock-plugin-template/README.md#L1-200)

---

## AI 能力架构

```mermaid
graph TB
    subgraph "AI 能力入口"
        AGENT["Agent"]
        GATEWAY["Gateway"]
    end
    
    subgraph "AI API 层 (actiondock-ai-api)"
        RUNTIME_IF["AiAgentRuntime"]
        TOOL_REG_IF["AiToolRegistry"]
        CALL_LOG["AiCallLog"]
    end
    
    subgraph "AI Core 层 (actiondock-ai-core)"
        RUNTIME_IMPL["AiAgentRuntimeImpl"]
        GATEWAY_IMPL["AiGatewayImpl"]
        TOOL_REG_IMPL["AiToolRegistryImpl"]
        PROFILE_SVC["Ai*ProfileService"]
    end
    
    subgraph "Provider 适配层"
        AGENT_SCOPE["AgentScope Adapter"]
        BRIDGE["Plugin Bridge"]
    end
    
    AGENT -->|Agent Run| RUNTIME_IF
    GATEWAY -->|Chat/Embedding| CALL_LOG
    RUNTIME_IF <--> RUNTIME_IMPL
    TOOL_REG_IF <--> TOOL_REG_IMPL
    RUNTIME_IMPL --> PROFILE_SVC
    RUNTIME_IMPL --> GATEWAY_IMPL
    GATEWAY_IMPL --> AGENT_SCOPE
    RUNTIME_IMPL --> BRIDGE
```

Sources: [actiondock-ai-core/README.md](actiondock-ai-core/README.md#L1-L33) | [actiondock-ai-api/README.md](actiondock-ai-api/README.md#L1-L40)

---

## 前端模块结构

```mermaid
graph TB
    subgraph "页面层 (pages)"
        SCRIPTS["ScriptLibraryPage<br/>ScriptEditorPage<br/>ScriptRunPage"]
        PLUGINS["PluginManagementPage<br/>PluginDetailPage"]
        REPOS["RepositoryManagementPage<br/>RepositoryDiscoveryPage"]
        AI["ai/*"]
    end
    
    subgraph "功能模块 (features)"
        FEATURES["scripts<br/>plugins<br/>resources<br/>capabilities<br/>executions<br/>triggers<br/>settings<br/>skills"]
    end
    
    subgraph "共享组件 (shared)"
        SHARED["schemaForm<br/>schemaObjectEditor<br/>executionLog"]
    end
    
    subgraph "API 层"
        API["api.ts"]
    end
    
    SCRIPTS --> SHARED
    PLUGINS --> SHARED
    REPOS --> SHARED
    FEATURES --> API
    SHARED --> API
```

Sources: [actiondock-admin-ui/src](actiondock-admin-ui/src#L1-200)

---

## 数据持久化

```mermaid
erDiagram
    SCRIPT_ENTITY ||--o| PUBLISHED_SNAPSHOT : 发布快照
    SCRIPT_ENTITY ||--o{ EXECUTION_RECORD : 执行记录
    SCRIPT_ENTITY ||--o{ SCRIPT_DEPENDENCY : 脚本依赖
    SCRIPT_ENTITY ||--o{ PLUGIN_DEPENDENCY : 插件依赖
    SCRIPT_ENTITY ||--o{ AI_DEPENDENCY : AI 依赖
    
    PLUGIN_REGISTRATION ||--o{ PLUGIN_ACTION : 动作
    PLUGIN_REGISTRATION ||--o{ PLUGIN_CONFIG : 配置
    
    AI_MODEL_PROFILE ||--o{ AI_AGENT_PROFILE : Agent 引用
    AI_AGENT_PROFILE ||--o{ AI_TOOLSET : Toolset
    AI_TOOLSET ||--o| AI_TOOL : 工具
```

Sources: [actiondock-storage-jpa/README.md](actiondock-storage-jpa/README.md#L1-L40)

---

## 部署架构

```mermaid
graph TB
    subgraph "用户终端"
        USER["用户浏览器"]
        CLI_USER["CLI 用户"]
    end
    
    subgraph "ActionDock 服务"
        SERVER["Spring Boot 应用<br/>(5177 端口)"]
        JAR["actiondock-app-spring.jar"]
        H2["H2 数据库<br/>(~/.actiondock/data)"]
        PLUGINS["插件目录<br/>(~/.actiondock/plugins)"]
    end
    
    subgraph "打包分发"
        NPM["npm 包<br/>(actiondock)"]
        DOCKER["Docker 容器"]
    end
    
    USER -->|HTTP| SERVER
    CLI_USER -->|HTTP| SERVER
    SERVER --> JAR
    SERVER --> H2
    SERVER --> PLUGINS
    NPM -->|本地运行| SERVER
    DOCKER -->|容器化| SERVER
```

Sources: [docker-compose.yml](docker-compose.yml#L1-L15) | [actiondock-app-spring/README.md](actiondock-app-spring/README.md#L1-L66)

---

## 技术栈汇总

| 层级 | 技术选型 | 版本 |
|------|---------|------|
| **后端框架** | Spring Boot | 3.3.5 |
| **编程语言** | Java | 21 |
| **脚本引擎** | Groovy / Python | 4.0.24 / 3.x |
| **插件系统** | PF4J | 3.13.0 |
| **持久化** | Spring Data JPA + H2 | - |
| **前端框架** | React | 18 |
| **UI 组件库** | Ant Design | 5 |
| **构建工具** | Vite | - |
| **CLI 框架** | oclif | - |
| **脚本语言** | TypeScript | - |

Sources: [pom.xml](pom.xml#L40-L45)

---

## 下一步阅读

- [项目概述](1-xiang-mu-gai-shu)：了解 ActionDock 解决的问题域
- [快速开始](2-kuai-su-kai-shi)：5 分钟上手体验
- [脚本生命周期管理](4-jiao-ben-sheng-ming-zhou-qi-guan-li)：深入了解脚本的草稿、发布流程
- [插件开发指南](7-cha-jian-kai-fa-zhi-nan)：学习如何开发自定义插件