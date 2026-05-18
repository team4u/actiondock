# Skills 管理

## 一句话理解

Skills 是可安装到本地目录的技能包。它们通常是 AI 辅助工具的技能定义文件（如 Claude Skills 的 `.md` 文件），可以打包分发到 ActionDock 仓库，然后安装到指定的目标目录（如 `~/.claude/skills`），从而让 IDE 或 AI 客户端加载使用。

Skills 不通过 ActionDock 运行时执行——它们只是被安装到文件系统目录中，由外部工具加载。

对于项目型任务，可以把 ActionDock 当成“项目知识入口解析器”使用：先通过 `repository resolve --repository-id` 取得 `ACTIONDOCK.md`，再按正文里的文件路径和关键词继续读取项目文档或源码。

## 核心概念

```text
Skill Target (目标目录)
  └── ActionDock 仓库 ──→ 安装 Skill ──→ 目标目录文件系统
       (从仓库发现 Skill)     (复制文件)     (IDE 可以读取)
```

### Skill Target（技能目标）

技能目标是 Skill 安装到的本地目录。每个目标包含：

- **ID**：唯一标识
- **名称**：人类可读名称
- **类型**：`CLAUDE`（自动建议 `~/.claude/skills`）或 `CUSTOM`
- **根路径**：技能安装到的实际目录
- **启用**：是否启用

### ManagedSkill（已管理的 Skill）

```java
public class ManagedSkill {
    private String id;           // Skill 唯一标识
    private String name;         // 名称
    private String description;  // 描述
    private String version;      // 版本号
    private String type;         // 类型
    private boolean enabled;     // 是否启用
    // 各目标的安装状态
}
```

### SkillInstallation（安装记录）

```java
public class SkillInstallation {
    private String skillId;
    private String targetId;
    private String targetPath;   // 安装到的目录路径
    private SkillInstallStatus status; // PENDING / INSTALLED / FAILED
}
```

## 目标管理

路径：管理台 → 能力 → Skills 管理 → 目标管理

### 添加目标

| 字段 | 说明 | 示例 |
|------|------|------|
| ID | 目标唯一标识 | `my-claude-skills` |
| 名称 | 人类可读名称 | `我的 Claude Skills` |
| 类型 | `CLAUDE` 或 `CUSTOM` | 选择 `CLAUDE` 路径自动填为 `~/.claude/skills` |
| 根路径 | 技能安装目录 | `C:\Users\me\.claude\skills` |
| 启用 | 是否启用 | 是 |

### 操作

- **添加**：创建新目标
- **编辑**：修改目标配置
- **删除**：移除目标（不删除已安装的 Skill 文件）
- **扫描目标目录**：检查哪些 Skill 文件实际存在于目录中
- **同步安装到目标**：将挂起的安装操作应用到文件系统

## 安装 Skills

路径：管理台 → 能力 → Skills 安装

### 安装方式

| 方式 | 说明 | 适用场景 |
|------|------|----------|
| **GitHub 集合** | 输入 GitHub 集合 URL，扫描并选择安装 | 从社区仓库安装 |
| **本地目录** | 选择本地目录进行安装 | 开发者本地测试 |
| **归档文件** | 上传 `.zip` 归档文件 | 从其他渠道获取 |

### 安装步骤

1. 选择安装方式（GitHub URL / 本地目录 / 上传 ZIP）
2. 系统扫描可用 Skill 列表
3. 勾选需要安装的 Skill
4. 选择目标（可多选）
5. 确认安装

### 安装状态

- `PENDING`：等待同步到目标目录
- `INSTALLED`：已成功安装到目标目录
- `FAILED`：安装失败

## 发布 Skills

路径：管理台 → 能力 → Skills 发布

将本地技能打包并发布到 ActionDock 仓库进行分发：

1. 选择要发布的 Skill
2. 选择目标仓库
3. 系统打包为仓库可识别的格式
4. 其他成员同步该仓库后即可安装

## Skill 详情

点击 Skill 名称进入详情页：

### 概览标签页

- Skill 元数据：ID、名称、描述、版本
- 文件浏览：查看 Skill 包中的文件结构

### 安装状态标签页

按目标分组显示安装状态：

| 目标 | 状态 | 操作 |
|------|------|------|
| my-claude-skills | `INSTALLED` | 重新安装、卸载 |
| dev-target | `PENDING` | 同步安装 |

## 操作

- **启用/禁用**：切换 Skill 是否启用
- **删除**：从 ActionDock 中移除 Skill 记录（不删除已安装到目录的文件）

## 项目知识用法

如果需要处理某个业务项目，推荐遵循以下规则：

1. 先识别用户要操作的项目 ID
2. 调用 `actiondock repository resolve --repository-id <value>`
3. 先阅读返回的 `ACTIONDOCK.md` 原文
4. 按正文中写明的优先级去读 Markdown 文档
5. 只有在知识文档不足时再读源码
6. 避免优先扫描 `dist`、`build`、`node_modules` 这类目录

一个典型的 `ACTIONDOCK.md` 会描述：

- 项目概览
- 优先阅读的知识库文件
- 某类任务应该优先查看哪些文档
- 常见关键词
- 哪些生成目录不值得优先搜索

这比让平台维护复杂的知识库 schema 更轻，也更适合直接消费。

## 常见问题

### Q: 安装后 IDE 中看不到

1. 检查目标目录路径是否正确
2. 检查目标是否已「同步安装」
3. 检查 Skill 文件是否实际写入到目标目录中
4. IDE 可能需要重启或重新加载配置

### Q: 安装状态显示 PENDING

调用「同步安装到目标」操作，将挂起的安装实际写入文件系统。

### Q: 发布到仓库失败

确认目标仓库已配置且可访问（Git 认证、网络连接）。

---

> [返回目录](user-manual.md) | 下一步：了解 [AI 能力](ai-capabilities.md)
