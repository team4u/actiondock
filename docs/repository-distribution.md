# 仓库与分发

## 一句话理解

仓库系统是 ActionDock 的资源分发和项目入口解析层。你可以把脚本、插件和 Skills 发布到能力仓库（Git 仓库或本地目录），也可以把业务项目注册为项目仓库。团队成员可以通过仓库发现、一键安装、自动更新，或者通过 `repository resolve --repository-id` 找到某个项目的知识入口。对于需要本地修改的仓库脚本或Webhook，可以从仓库资产创建工作副本，再通过上游绑定拉取更新。

## 仓库数据模型

```java
public class RepositoryDefinition {
    private String id;               // 仓库唯一标识
    private String name;             // 人类可读名称
    private RepositoryType type;     // GIT / LOCAL_DIR
    private String purpose;          // CAPABILITY / PROJECT
    private String url;              // Git URL / 本地路径
    private String branch;           // Git 分支（可选）
    private boolean enabled;         // 是否启用
    private TrustLevel trustLevel;   // TRUSTED / UNTRUSTED
    private String description;
}
```

`type` 表示“怎么访问仓库”，`purpose` 表示“仓库拿来做什么”。

- `type`: `GIT` / `LOCAL_DIR`
- `purpose`: `CAPABILITY` / `PROJECT`

## 仓库类型

| 类型 | URL 示例 | 说明 |
|------|----------|------|
| `GIT` | `https://github.com/org/actiondock-tools.git` | 从 Git 仓库自动同步 |
| `LOCAL_DIR` | `C:\shared-tools` | 从本地目录加载 |

项目仓库当前只支持 `GIT` 和 `LOCAL_DIR`。

## 仓库用途

| 用途 | 说明 |
|------|------|
| `CAPABILITY` | 分发工具、Webhook、插件、Skills、能力包、知识源 |
| `PROJECT` | 指向业务项目目录，并提供项目知识入口文件 |

## 项目仓库与 `ACTIONDOCK.md`

项目仓库只负责告诉调用方：

1. 这个项目仓库在哪里
2. 项目知识入口文件在哪里
3. 返回入口文件原文

固定知识入口文件：

```text
ACTIONDOCK.md
```

`ACTIONDOCK.md` 直接写正文内容即可：

```md
# Billing Service

## 优先阅读

1. `overview.md`
2. `database.md`
3. `workflows.md`
4. `runbooks/`
```

ActionDock 当前不会把正文拆成复杂结构，也不会做向量检索。它只做稳定定位并返回原始 Markdown 内容，后续检索由调用方自行完成。

## 安装模型

| 形态 | 说明 | 编辑状态 |
|------|------|----------|
| 仓库安装 | 直接把仓库中的工具安装到本地，作用域为 `REPOSITORY` | 只读 |
| 工作副本 | 基于仓库脚本或Webhook创建本地可编辑副本，并建立 `upstream_binding` | 可编辑，可拉取上游更新 |

## 仓库发现

路径：管理台 → 资源 → 仓库发现

### 资源分类

仓库发现页面列出所有已配置仓库中的可用资源：

| 分类 | 内容 | 安装后的行为 |
|------|------|--------------|
| 工具 (Tools) | 可安装的脚本 | 出现在脚本库，`REPOSITORY` 作用域 |
| 插件 (Plugins) | 可安装的 PF4J 插件 | 出现在插件管理列表 |
| AI 能力包 | AI 配置包 | 自动导入模型/Agent/Toolset 配置 |
| Skills | 可安装的技能包 | 出现在 Skills 列表 |
| 知识源 (Knowledge) | 指向外部知识仓库的指针 | 安装后注册为 PROJECT 仓库 |

### 资源项信息

每个资源项显示：

- 名称和描述
- 类型（Tool/Plugin/Skill）
- 版本号
- 信任级别（`TRUSTED` / `UNTRUSTED`）
- 依赖关系

### 安装流程

1. 点击「安装」
2. 确认对话框显示资产的依赖信息
3. 可选择是否安装关联的依赖项
4. 确认后安装
5. 安装后的脚本出现在脚本库中，作用域为 `REPOSITORY`（只读）
6. 如果需要本地修改，改为从详情页或 CLI 创建工作副本

## 仓库管理

路径：管理台 → 资源 → 仓库管理

仓库管理页面同时承载两类仓库：

```text
Repositories
├── Capability Repositories
└── Project Repositories
```

### 表格列

| 列 | 说明 |
|----|------|
| ID | 仓库标识（点击进入详情） |
| 名称 | 人类可读名称 |
| 类型 | `GIT` / `LOCAL_DIR` |
| 信任级别 | `TRUSTED` / `UNTRUSTED` |
| 状态 | 上次同步状态 |
| 操作 | 同步、编辑、删除 |

### 创建仓库

| 字段 | 说明 | 示例 |
|------|------|------|
| ID | 仓库唯一标识 | `team-scripts` |
| 名称 | 人类可读名称 | `团队脚本库` |
| 类型 | `GIT` / `LOCAL_DIR` | `GIT` |
| URL | Git URL/本地路径 | `https://github.com/org/tools.git` |
| Branch | Git 分支（可选） | `main` 或 `develop` |
| 启用 | 是否启用 | 是 |
| 信任级别 | `TRUSTED` / `UNTRUSTED` | 建议用 `UNTRUSTED` 先检查 |
| 描述 | 仓库用途说明 | |

创建项目仓库时，额外字段为：

| 字段 | 说明 | 示例 |
|------|------|------|
| Purpose | 仓库用途 | `PROJECT` |

### 解析项目仓库

通过 CLI：

```bash
actiondock repository sync billing-service
actiondock repository resolve --repository-id billing-service
```

如果希望先看同步结果，也可以：

```bash
actiondock repository sync billing-service --json
actiondock repository resolve --repository-id billing-service --json
```

通过 REST API：

```bash
curl "http://localhost:5177/api/repositories/resolve?repositoryId=billing-service"
```

返回结果示例：

```json
{
  "repositoryId": "billing-service",
  "type": "LOCAL_DIR",
  "purpose": "PROJECT",
  "root": "/Users/code/projects/billing-service",
  "entryPath": "ACTIONDOCK.md",
  "enabled": true,
  "exists": true,
  "content": "# Billing Service\n\n## 优先阅读\n\n1. `overview.md`\n..."
}
```

这一步会直接返回项目根目录、知识入口文件路径和入口文件原文。

说明：

- `repository sync` 用于手工同步仓库
- `repository resolve` 只做定位和读取，不会触发仓库同步
- `GIT` 类型项目仓库需要先通过手工同步或定时同步准备好本地副本

### 只读安装 vs 工作副本 选择建议

**只读安装：**

适用场景：
- 官方发布的稳定脚本
- 团队成员只需要使用，不需要修改
- 版本化管理

安装后的脚本只读，如果用户需要修改，可以创建工作副本；如果只是想做一次性个性化改造，也可以 Fork 成独立个人脚本。

**工作副本：**

适用场景：
- 你想在 ActionDock 中直接修改仓库里的某个工具或Webhook
- 你仍然希望保留与上游仓库资产的对应关系
- 你需要随时比较本地改动和上游新版本

创建后，本地副本仍然是脚本库里的 `PERSONAL` 脚本，但会额外带有上游绑定和同步状态。

## 安装仓库脚本

### 通过管理台

仓库发现页面 → 点击「安装」

### 通过 REST API

```bash
# 列出仓库中的可用工具
curl http://localhost:5177/api/repositories/{repoId}/scripts

# 安装工具为本地只读资产
curl -X POST http://localhost:5177/api/repositories/{repoId}/scripts/{scriptId}/local-assets \
  -H 'Content-Type: application/json' \
  -d '{"mode":"LOCKED"}'
```

### 依赖处理

安装时系统会检查：
- 脚本依赖的其他脚本是否已安装
- 需要的插件是否已安装
- 目标脚本 ID 是否与已有脚本冲突

如果有依赖缺失，安装对话框会提示，可以选择一起安装。

## 更新已安装工具

### 一键更新

管理台「脚本库」或「插件管理」页面 → 点击「一键更新」：

1. 同步所有已配置的仓库
2. 检查所有仓库来源的脚本和插件是否有新版本
3. 批量更新

### 单脚本更新

在脚本库中，状态为 `UPDATE_AVAILABLE` 的脚本：

1. 点击该脚本的「更新」按钮
2. 确认更新
3. 更新后脚本内容变更为仓库最新版本

### 工作副本上游同步

带上游绑定的工作副本显示同步状态标签：

| 标签 | 含义 | 可做的操作 |
|------|------|-----------|
| `SYNCED` | 本地与远程一致 | 无需操作 |
| `LOCAL_CHANGES` | 本地有未同步修改 | 发布到仓库 |
| `REMOTE_CHANGES` | 上游有新版本 | `upstream/pull` 拉取更新 |
| `DIVERGED` | 本地和上游都有修改 | `upstream/pull?force=true` 覆盖 |

通过 REST API 创建工作副本、查看状态和拉取更新：

```bash
# 从仓库脚本创建脚本工作副本
curl -X POST http://localhost:5177/api/repositories/{repoId}/scripts/{scriptId}/local-assets \
  -H 'Content-Type: application/json' \
  -d '{"mode":"TRACKED"}'

# 查看脚本工作副本的上游状态
curl http://localhost:5177/api/scripts/{id}/upstream

# 返回：
# { "status": "REMOTE_CHANGES" }

# 拉取上游更新
curl -X POST http://localhost:5177/api/scripts/{id}/upstream/pull

# 强制拉取（放弃本地修改）
curl -X POST "http://localhost:5177/api/scripts/{id}/upstream/pull?force=true"
```

## 发布脚本到仓库

### 前提条件

1. 脚本已发布（PUBLISHED 状态）
2. 目标仓库已配置且可访问

### 发布步骤

1. 打开脚本编辑器
2. 点击「发布到仓库」
3. 选择目标仓库
4. 系统将当前已发布快照打包并推送到仓库

### 发布格式

发布到 Git 仓库时，系统在仓库中生成标准化的目录结构：

```text
repo-root/
├── index.json           # 仓库索引
├── tools/
│   ├── my-script/
│   │   ├── v1/
│   │   │   ├── definition.json  # 脚本定义
│   │   │   └── source.groovy    # 源码
│   │   └── v2/
│   │       ├── definition.json
│   │       └── source.groovy
│   └── ...
└── plugins/
    └── ...
```

### 通过 REST API 发布

```bash
# 获取可发布到的仓库列表
curl http://localhost:5177/api/scripts/{id}/publishable-repositories

# 发布到仓库
curl -X POST http://localhost:5177/api/scripts/{id}/publish \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{
    "repositoryId": "my-repo"
  }'
```

## REST API 完整参考

```bash
# 仓库 CRUD
GET    /api/repositories                        # 列表（支持 ?purpose=CAPABILITY|PROJECT）
POST   /api/repositories                        # 创建
GET    /api/repositories/{id}                   # 详情
PUT    /api/repositories/{id}                   # 更新
DELETE /api/repositories/{id}                   # 删除

# 仓库操作
GET    /api/repositories/resolve?repositoryId=...    # 解析项目仓库并返回 ACTIONDOCK.md 原文
POST   /api/repositories/{id}/sync              # 同步仓库
GET    /api/repositories/{id}/scripts             # 列出可用工具
POST   /api/repositories/{id}/scripts/{scriptId}/local-assets         # 添加仓库脚本到本地
POST   /api/repositories/{id}/scripts/{scriptId}/local-assets/update  # 更新本地仓库脚本
```

## 知识源

知识源是 CAPABILITY 仓库中的一种轻量资产，它不存储知识内容本身，而是指向一个外部知识仓库（git 仓库或本地目录）的指针。团队成员安装后，系统自动将其注册为 PROJECT 仓库，AI agent 通过 `repository resolve` 消费。

### 清单格式

在 CAPABILITY 仓库的 `knowledge/` 目录下，每个子目录放一个 `knowledge.json`：

```text
repository/
  knowledge/
    product-api/
      knowledge.json
```

`knowledge.json`：

```json
{
  "schemaVersion": 1,
  "knowledgeId": "product-api",
  "displayName": "产品 API 文档",
  "description": "外部接口规范与使用指南",
  "source": {
    "type": "GIT",
    "url": "https://github.com/team/api-docs.git",
    "branch": "main",
    "entryPath": "ACTIONDOCK.md"
  },
  "tags": ["api", "docs"]
}
```

`source.type` 支持 `GIT` 和 `LOCAL_DIR`，`entryPath` 默认为 `ACTIONDOCK.md`。

### 安装与卸载

安装后自动创建 `purpose=PROJECT` 的仓库定义，ID 为 `knowledge:{repositoryId}:{knowledgeId}`：

```bash
# 列出知识源
actiondock repository:knowledge-list --repository-id team-repo --intent "api|database" --json

# 安装
actiondock repository:knowledge-install --repository-id team-repo --knowledge-id product-api

# 卸载
actiondock repository:knowledge-uninstall --repository-id team-repo --knowledge-id product-api
```

REST API：

```bash
GET    /api/repositories/knowledge?intent=api                          # 列出所有知识源，可按 intent 正则过滤
GET    /api/repositories/{id}/knowledge?intent=api                     # 列出单仓库知识源，可按 intent 正则过滤
GET    /api/repositories/{id}/knowledge/{knowledgeId}                  # 知识源详情
POST   /api/repositories/{id}/knowledge/{knowledgeId}/install          # 安装
DELETE /api/repositories/{id}/knowledge/{knowledgeId}                  # 卸载
```

## 常见问题

### Q: 同步失败

检查：
1. 网络连接是否正常
2. Git 认证是否正确（HTTPS 需要 Token，SSH 需要 Key）
3. 分支名是否正确
4. URL 是否可访问

### Q: 工作副本冲突（DIVERGED）

本地和远程都有修改时：
- 如果本地修改不重要：使用 `?force=true` 强制拉取远程版本覆盖本地
- 如果本地修改要保留：先手动备份，然后重新编辑合并

### Q: 安装的脚本怎么修改

`REPOSITORY` 作用域的脚本是只读的。如果需要修改：
1. Fork 该脚本
2. 修改 Fork 后的副本
3. 如果需要贡献回仓库，通过仓库的 PR 流程

### Q: 仓库里的脚本版本管理

仓库中的脚本按版本号组织。安装时安装最新版本，更新时升级到最新的可用版本。

## 最佳实践

- **默认先安装**：仓库安装适合消费稳定版本，只有需要本地改时再创建工作副本
- **信任级别**：对外部仓库先用 `UNTRUSTED`，审查后再提升
- **定期同步**：养成定期一键更新的习惯，获取最新的工具和修复
- **版本管理**：发布到仓库前确保脚本已发布（创建快照），避免半成品分发
- **工作副本同步**：本地有改动时先确认是否要保留，再决定直接拉取上游还是强制覆盖

---

> [返回目录](user-manual.md) | 下一步：了解 [触发中心](trigger-center.md)
