# 1.0 到 2.0 架构升级对比与迁移指南

ActionDock 2.0 是对 ActionDock 1.0 的彻底重构。本文档阐述 2.0 在产品定位、架构理念、运行时选型和开发体验上的核心演进，帮助开发者理解两个版本之间的差异与映射关系。

---

## 1. 核心理念与架构对比

| 维度 | ActionDock 1.0 (旧版) | ActionDock 2.0 (新版) |
| :--- | :--- | :--- |
| **产品定位** | 中心化脚本管理平台（带后端 Server、Admin UI、数据库、权限与定时调度） | 面向 AI Agent 的轻量级 Action / Skill 独立开发与分发工具链 |
| **技术栈** | Java 21 + Spring Boot 3 + JPA + Groovy / Python + React Admin UI | Bun + TypeScript + `bun:sqlite` + 原生单文件编译引擎 |
| **运行形态** | 长期运行的常驻 Server 守护进程 + Web 控制台 | 零常驻守护进程（Zero-Daemon），纯 CLI 工具（`ac`）按需执行 |
| **交付形态** | 必须部署完整的 ActionDock 服务端才能运行脚本 | 编译为单个零外部依赖的自包含独立二进制 + 标准 `SKILL.md` |
| **开发模型** | Web 页面在线编辑脚本，存在数据库中 | 文件系统优先（Filesystem First），`actions/*.ts` 普通文件纳入 Git 管理 |
| **依赖管理** | 复杂的动态 ClassLoader / 插件热插拔系统 | 标准 npm / TypeScript 原生模块导入（`import`） |
| **持久化** | MySQL / PostgreSQL + JPA 重型关系数据库 | 内置 `bun:sqlite` 轻量嵌入式存储（仅存 Config/State/Runs） |

---

## 2. 核心概念映射与对照

| 1.0 旧概念 | 2.0 新概念 | 变化说明 |
| :--- | :--- | :--- |
| **Script (脚本)** | **Action (动作)** | 从松散脚本演变为具备严格输入/输出 JSON Schema 和全类型安全的 Action（`defineAction`）。 |
| **Script Platform (多语言平台)** | **TypeScript 原生** | 统一为业界主流的 TypeScript，消除了跨语言上下文映射与平台维护成本。 |
| **Playbook Session (会话引擎)** | **Markdown SOP (操作规程)** | 废弃复杂的内部状态机与工作流引擎，Playbook 变为纯粹提供给 AI Agent 阅读与协同的标准 SOP Markdown 文档。 |
| **Plugin System (插件机制)** | **npm / Web Standard API** | 废弃私有插件协议，直接使用现代 Web 标准（`fetch`、`Bun.spawn`、`Bun.file`）与海量 npm 生态包。 |
| **Config Store (配置服务)** | **`ctx.config`** | 统一三级优先级：命令行临时覆盖 > 本地 SQLite 存储 > `actiondock.json` 默认声明。 |
| **Shared State (共享状态)** | **`ctx.state`** | 延续跨执行持久化 Key-Value 理念，升级为基于 `bun:sqlite` 的原生轻量实现，支持命名空间隔离。 |

---

## 3. Action 代码迁移示例

### 1.0 旧版 Groovy 脚本
```groovy
// 1.0 动态脚本
def name = input.name ?: "world"
def greeting = config.get("GREETING") ?: "Hello"
log.info("Greeting user ${name}")
return [message: "${greeting}, ${name}!"]
```

### 2.0 新版 TypeScript Action
```ts
import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "sample.greet",
  description: "向用户发送自定义问候",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "用户名" },
    },
    required: ["name"],
  },

  outputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
  },

  async run(input, ctx) {
    const greeting = ctx.config.get("GREETING", "Hello");
    ctx.log.info(`Greeting user ${input.name}`);
    return {
      message: `${greeting}, ${input.name}!`,
    };
  },
});
```
