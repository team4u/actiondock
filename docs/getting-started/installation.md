# 运行环境准备与安装

ActionDock 基础运行环境为 Node.js >=24.12.0。它依赖原生类型擦除、内置 SQLite 与原生 HTTP。系统支持 npm、pnpm、yarn 等包管理工具。

> [!NOTE]
> 如果仅需使用 Agent Skill，客户端会读取 `SKILL.md` 自动准备环境。此时无需准备 ActionDock 开发环境。详情参阅 [Agent Skill 使用指南](../consumer/use-as-skill.md)。

---

## 基础运行环境准备

ActionDock 工具链需要 Node.js >=24.12.0。运行时利用原生类型擦除、内置 SQLite 驱动与标准流式处理能力。

### 验证 Node.js 环境

在终端运行以下命令确认运行环境版本：

```bash
node --version
# 输出需满足 v24.12.0 或更高版本
```

---

## 全局安装 ActionDock 命令行工具

通过包管理工具全局安装 `@actiondock/cli` 工具包。该包向操作系统注册全局命令 `ad` 与别名 `actiondock`。

### 全局安装方式

使用 npm 全局安装：

```bash
npm install -g @actiondock/cli
```

若使用其他包管理工具，可运行对应安装命令：

```bash
# 使用 pnpm 全局安装
pnpm add -g @actiondock/cli

# 使用 yarn 全局安装
yarn global add @actiondock/cli
```

### 验证安装结果

安装完成后，在终端检查命令可用性与帮助信息：

```bash
ad --version
ad --help
```

---

## 依赖管理与锁定机制

ActionDock 2.x 采用标准的依赖管理与锁定机制。框架无需安装外部编译器：

- 依赖严格锁定：`actiondock.lock.json`（版本 `lockfileVersion: 1`）锁定依赖版本与散列值。
- 原子事务保护：运行 `ad add` 与 `ad remove` 时，框架自动创建快照。安装失败时自动回滚，避免损坏配置。
- 多模态交付：运行 `ad build` 构建 Node.js 目录产物。运行 `ad pack` 打包 npm 压缩包。运行 `ad export skill` 导出智能体技能。

---

## 框架贡献与本地源码调试

若需要参与 ActionDock 开发，或联合调试本地修改的源码，请参阅贡献指南：

- [本地联动调试与框架贡献指南](../developer/contributing.md)
