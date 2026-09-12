# 运行环境准备与安装

ActionDock 基础运行环境为 Node.js >=24.12.0，基于原生类型擦除、内置 SQLite 与原生 HTTP，支持 npm、pnpm、yarn 等标准包管理工具。

> [!NOTE]
> 如果仅需要安装或使用 Agent Skill，通常由智能体客户端读取 `SKILL.md` 自动准备环境，无需按本页准备 ActionDock 开发者环境。完整消费指引请参阅 [Agent Skill 使用指南](../consumer/use-as-skill.md)。

---

## 基础运行环境准备

ActionDock 核心工具链与运行时需要 Node.js >=24.12.0 环境，以利用其原生类型擦除、内置 SQLite 驱动与标准流式处理能力。

### 验证 Node.js 环境

在终端执行以下命令确认运行环境版本：

```bash
node --version
# 输出需满足 v24.12.0 或更高版本
```

---

## 全局安装 ActionDock 命令行工具

通过标准包管理工具全局安装 `@actiondock/cli` 门面工具包。该包向操作系统注册全局命令 `ad` 与别名 `actiondock`。

### 全局安装方式

使用 npm 进行全局安装：

```bash
npm install -g @actiondock/cli
```

若使用其他包管理工具，可执行对应安装命令：

```bash
# 使用 pnpm 全局安装
pnpm add -g @actiondock/cli

# 使用 yarn 全局安装
yarn global add @actiondock/cli
```

### 验证安装结果

安装完成后，在终端中校验命令可用性与帮助信息：

```bash
ad --version
ad --help
```

---

## 依赖管理与锁定机制

ActionDock 2.0 采用标准的包依赖管理与锁定机制，无需安装任何外部专用编译器：

- 依赖严格锁定：通过 `actiondock.lock.json`（规范版本 `lockfileVersion: 1`）严格锁定依赖树版本与完整性散列。
- 原子事务保护：使用 `ad add` 与 `ad remove` 命令安装或卸载依赖时，框架自动创建磁盘快照，在安装失败时自动回滚，杜绝配置损坏。
- 多模态构建与交付：使用 `ad build` 将项目构建为自包含的 Node.js 目录交付产物，使用 `ad pack` 打包为标准 npm 压缩包，或使用 `ad export skill` 导出为智能体技能。

---

## 框架贡献与本地源码调试

若需要参与 ActionDock 核心框架的开发，或在外部项目中联合调试本地修改的 ActionDock 源码，请参阅专门的贡献者指南：

- [本地联动调试与框架贡献指南](../developer/contributing.md)
