# 插件管理

## 一句话理解

插件是基于 PF4J（Plugin Framework for Java）的扩展机制。插件可以提供多个 `Action`，脚本通过 `plugins.invoke()` 统一调用。这种设计让平台核心能力可以扩展——你可以编写自己的 Java 插件打包成 JAR，上传安装，然后在 Groovy 或 Python 脚本中像调用本地函数一样调用它。

与脚本的区别：插件是编译型 Java 代码，性能更高、可以访问本地资源；脚本是解释型（Groovy/Python），编写更快、热更新。

## 插件数据模型

```java
public class PluginRegistration {
    private String pluginId;          // 插件唯一标识
    private String name;              // 人类可读名称
    private String description;       // 描述
    private String version;           // 版本号
    private String status;            // STARTED / STOPPED / FAILED
    private String source;            // REPOSITORY / UPLOAD
    private List<PluginActionMetadata> actions;  // 提供的 Action 列表
    private String configSchema;      // 全局配置 Schema（可选）
    private String pluginDependencies; // 插件依赖
}

public class PluginActionMetadata {
    private String actionId;          // Action 标识
    private String name;              // Action 名称
    private String description;       // 用途说明
    private Map<String, Object> inputSchema;   // 输入 Schema
    private Map<String, Object> outputSchema;  // 输出 Schema
}
```

## 插件列表

路径：管理台 → 能力 → 插件管理

### 表格列

| 列 | 说明 |
|----|------|
| Plugin ID | 插件标识（点击进入详情） |
| 名称 | 人类可读名称 |
| 状态 | `STARTED`（绿色）/ `STOPPED`（金色）/ `FAILED`（红色） |
| 版本 | 插件版本号 |
| 来源 | `REPOSITORY`（仓库安装）或 `UPLOAD`（手动上传） |
| Actions 数 | 插件提供的动作数量 |

### 工具栏

| 按钮 | 功能 |
|------|------|
| 刷新 | 重新加载插件列表 |
| 一键更新 | 同步所有仓库并更新所有仓库来源的插件 |
| 上传安装 | 上传 `.jar` 文件安装插件 |

## 安装插件

### 方式一：上传安装

```bash
# 通过管理台上传
# 点击「上传安装」→ 选择 PF4J 规范的 .jar 文件
```

通过 REST API 安装：

```bash
curl -X POST http://localhost:5177/api/plugins/install \
  -H 'Authorization: Bearer <token>' \
  -F 'file=@my-plugin.jar'
```

安装后插件可能处于 `STOPPED` 状态，需要手动启动。

### 方式二：从仓库安装

详见 [仓库与分发](repository-distribution.md) 的「仓库发现」。

## 插件生命周期管理

```text
  上传/安装
     │
     ▼
   STOPPED ──→ STARTED
     │              │
     │              ├──→ FAILED（启动失败）
     │              │
     │              └──→ STOPPED（手动停止）
     │
     ├──→ UPGRADE（上传新版本）
     │
     └──→ UNINSTALL（移除）
```

### REST API 操作

```bash
# 启动插件
curl -X POST http://localhost:5177/api/plugins/{pluginId}/start

# 停止插件
curl -X POST http://localhost:5177/api/plugins/{pluginId}/stop

# 升级插件（上传新版本 .jar）
curl -X POST http://localhost:5177/api/plugins/{pluginId}/upgrade \
  -F 'file=@my-plugin-v2.jar'

# 卸载插件
curl -X DELETE http://localhost:5177/api/plugins/{pluginId}
# 可携带 ?force=true 强制卸载
```

## 插件详情

点击插件 ID 进入详情页，可查看：

### 概览

- Manifest 信息（名称、描述、版本、供应商）
- 状态指示器
- 来源标识

### Actions 列表

每个 Action 显示：

- Action ID
- 名称和描述
- 输入/输出 Schema（JSON Schema 格式）
- 可直接调试：点击「调用」传入参数测试

### 配置管理

如果插件暴露了配置 Schema，可以在「配置」标签页中：

1. 查看配置 Schema（定义可配置字段）
2. 编辑配置值
3. 保存后自动生效，无需重启

配置管理 API：

```bash
# 获取插件配置
curl http://localhost:5177/api/plugins/{pluginId}/config

# 保存插件配置
curl -X PUT http://localhost:5177/api/plugins/{pluginId}/config \
  -H 'Content-Type: application/json' \
  -d '{"key": "value"}'
```

## 在脚本中调用插件

### 调用基础

```groovy
// Groovy 脚本
def result = plugins.invoke("my-plugin", "hello", [name: "world"])
```

```python
# Python 脚本
result = plugins.invoke("my-plugin", "hello", {"name": "world"})
```

参数说明：

| 参数 | 说明 |
|------|------|
| 第一个参数 | 插件 ID（`pluginId`） |
| 第二个参数 | Action 名称（`actionId`） |
| 第三个参数 | 输入参数 Map，匹配 Action 的 `inputSchema` |

### 完整示例

```groovy
// 调用 actiondock-ai 插件进行 AI 对话
def chatResult = plugins.invoke("actiondock-ai", "chat", [
    modelProfileId: "my-model",
    messages: [
        [role: "system", content: "你是一个助手"],
        [role: "user", content: "你好"]
    ]
])

// 调用结构化输出
def structuredResult = plugins.invoke("actiondock-ai", "structured", [
    modelProfileId: "my-model",
    messages: [[role: "user", content: "提取信息"]],
    responseSchema: [
        type: "object",
        properties: [
            name: [type: "string"],
            age: [type: "integer"]
        ]
    ]
])

// 调用向量嵌入
def embedResult = plugins.invoke("actiondock-ai", "embed", [
    modelProfileId: "my-embedding-model",
    input: ["要编码的文本"]
])

// 运行一个 AI Agent
def agentResult = plugins.invoke("actiondock-ai", "agentRun", [
    agentProfileId: "my-agent",
    input: "帮我查询订单状态"
])
```

### 插件 vs 脚本调用对比

| 维度 | `plugins.invoke()` | `scripts.invoke()` |
|------|--------------------|--------------------|
| 执行环境 | JVM 内原生执行 | 隔离脚本引擎 |
| 性能 | 高（Java 编译） | 中等（解释执行） |
| 开发语言 | Java（需编译打包） | Groovy/Python（无需编译） |
| 部署方式 | 上传 JAR | 管理台编辑/API 创建 |
| 适用场景 | 本地资源访问、高性能需求 | 快速开发、灵活变更 |

### 前端引用插件（编辑器用）

API：`GET /api/plugins/references`

返回格式：

```json
[
  {
    "pluginId": "actiondock-ai",
    "name": "AI Plugin",
    "actions": [
      {
        "actionId": "chat",
        "name": "聊天对话",
        "inputSchema": {}
      }
    ]
  }
]
```

此 API 用于编辑器插件依赖选择 UI。

## 为 ActionDock 开发插件

### 插件项目结构

```text
my-plugin/
├── pom.xml
└── src/
    └── main/
        └── java/
            └── com/example/
                ├── MyPlugin.java          ← 实现 Plugin 接口
                └── actions/
                    └── HelloAction.java   ← 实现 Action 接口
```

### 使用插件模板

参考项目中的 `actiondock-plugin-template` 模块快速开始：

```bash
# 复制模板模块
cp -r actiondock-plugin-template my-plugin
# 修改 pom.xml 中的 artifactId 和依赖
```

### Plugin 入口类

```java
package com.example;

import org.pf4j.Plugin;
import org.pf4j.PluginWrapper;

public class MyPlugin extends Plugin {
    public MyPlugin(PluginWrapper wrapper) {
        super(wrapper);
    }

    @Override
    public void start() {
        log.info("MyPlugin.start()");
    }

    @Override
    public void stop() {
        log.info("MyPlugin.stop()");
    }
}
```

### Action 实现

```java
package com.example.actions;

import org.team4u.actiondock.plugin.api.Action;
import org.team4u.actiondock.plugin.api.ActionContext;
import java.util.Map;

public class HelloAction implements Action {
    @Override
    public String getId() {
        return "hello";
    }

    @Override
    public String getName() {
        return "问候";
    }

    @Override
    public Map<String, Object> execute(ActionContext context) {
        String name = (String) context.getInput().get("name");
        return Map.of("greeting", "Hello, " + name + "!");
    }
}
```

### PF4J 规范要求

- JAR 中必须包含 `META-INF/extensions.idx` 文件
- JAR 中必须包含 `META-INF/MANIFEST.MF` 文件，声明 `Plugin-Class` 属性
- 建议使用 `pf4j-spring` 集成以便利用 Spring 依赖注入

## 常见问题

### Q: 插件启动失败

检查：
1. JAR 是否符合 PF4J 规范——`META-INF/MANIFEST.MF` 中是否有 `Plugin-Class`
2. Java 版本是否兼容（插件应当使用与宿主相同的 Java 版本编译）
3. 依赖的第三方库是否缺失

### Q: 插件上传后没有出现在列表

可能原因：
- 上传过程中网络中断，重新上传
- JAR 损坏，检查文件完整性
- 插件 ID 与已存在的插件冲突

### Q: 升级插件失败

- 如果提示版本冲突，先卸载旧版本再安装新版本
- 升级时上传的是完整 JAR，不是差量补丁

### Q: 脚本中调用插件时报 Action 不存在

1. 确认插件已启动（状态为 `STARTED`）
2. 确认 Action ID 拼写正确
3. 在插件详情页的 Actions 列表中确认 Action 已注册

### Q: 插件中的配置不生效

修改配置后不需要重启插件。如果仍然不生效，尝试停止后重新启动插件。

## 最佳实践

- **Action 设计原则**：一个 Action 做好一件事，通过 `inputSchema` 清晰定义输入契约
- **错误处理**：Action 中抛出异常时，异常信息会传递到脚本执行的 `errorMessage` 中
- **插件生命周期**：`start()` 中做初始化（如创建连接池），`stop()` 中做清理
- **配置管理**：如果插件需要配置，一定要在 Manifest 中提供 `configSchema`

---

> [返回目录](user-manual.md) | 下一步：了解 [Skills 管理](skills-management.md)
