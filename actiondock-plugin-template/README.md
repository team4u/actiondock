# ActionDock Plugin Template

ActionDock 插件开发模板项目。基于此模板可快速创建自定义插件，扩展 ActionDock 的 Groovy 和 Python 脚本能力。

## 架构概览

ActionDock 插件系统基于 [PF4J](https://pf4j.org/) (Plugin Framework for Java) 构建，采用扩展点（Extension Point）模式：

```
actiondock-plugin-api          插件 API（接口定义 + 工具类）
  └── actiondock-plugin-template  插件模板（本模块，可直接复制开发）
```

插件作为独立 JAR 包，通过 PF4J 动态加载到 ActionDock 主应用中。Groovy 和 Python 脚本都可通过内置的 `plugins` 变量调用已安装插件的功能。

## 快速开始

### 1. 创建插件项目

复制本模板模块，修改 Maven 坐标：

```xml
<groupId>com.yourcompany</groupId>
<artifactId>your-plugin</artifactId>
<version>1.0.0</version>
```

确保依赖 `actiondock-plugin-api`：

```xml
<dependency>
    <groupId>org.team4u</groupId>
    <artifactId>actiondock-plugin-api</artifactId>
    <version>${project.version}</version>
    <scope>provided</scope>
</dependency>
<dependency>
    <groupId>org.pf4j</groupId>
    <artifactId>pf4j</artifactId>
    <version>${pf4j.version}</version>
    <scope>provided</scope>
</dependency>
```

### 2. 实现 PF4J Plugin 类

创建插件的入口类，继承 `org.pf4j.Plugin`：

```java
package com.yourcompany.plugin;

import org.pf4j.Plugin;
import org.pf4j.PluginWrapper;

public class MyPlugin extends Plugin {
    public MyPlugin(PluginWrapper wrapper) {
        super(wrapper);
    }
}
```

### 3. 实现 ActionDockPlugin 扩展点

使用 `@Extension` 注解标记实现类，实现 `ActionDockPlugin` 接口：

```java
package com.yourcompany.plugin;

import org.pf4j.Extension;
import org.team4u.actiondock.plugin.api.ActionDockPlugin;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.Map;

@Extension
public class MyActionDockPlugin implements ActionDockPlugin {

    @Override
    public String id() {
        return "my-plugin";  // 必须与 manifest 文件中的 pluginId 一致
    }

    @Override
    public void validateConfig(Map<String, Object> config) {
        // 可选：校验用户配置，校验失败抛出异常即可
    }

    @Override
    public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
        return switch (action) {
            case "hello" -> Map.of("greeting", "Hello, " + args.get("name"));
            default -> throw new IllegalArgumentException("Unsupported action: " + action);
        };
    }
}
```

### 4. 编写 Manifest 文件

在 `src/main/resources/META-INF/actiondock/plugins/` 下创建 `{pluginId}.json`：

```json
{
  "pluginId": "my-plugin",
  "name": "My Plugin",
  "description": "## My Plugin\n\nA custom **ActionDock** plugin.",
  "version": "1.0.0",
  "configSchema": {
    "type": "object",
    "properties": {
      "greeting": {
        "type": "string",
        "title": "问候语"
      }
    }
  },
  "defaultConfig": {
    "greeting": "Hello"
  },
  "actions": [
    {
      "action": "hello",
      "title": "打招呼",
      "description": "返回一句问候语。\n\n- 读取输入 `name`\n- 返回 `greeting`",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "title": "姓名"
          }
        }
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "greeting": {
            "type": "string",
            "title": "问候语"
          }
        }
      },
      "exampleArgs": {
        "name": "World"
      }
    }
  ]
}
```

### 5. 配置 Maven 构建

在 `pom.xml` 的 `<build>` 中配置注解处理器和 JAR manifest：

```xml
<build>
    <plugins>
        <!-- PF4J 注解处理器，自动生成 extensions.idx -->
        <plugin>
            <artifactId>maven-compiler-plugin</artifactId>
            <configuration>
                <annotationProcessors>
                    <annotationProcessor>org.pf4j.processor.ExtensionAnnotationProcessor</annotationProcessor>
                </annotationProcessors>
            </configuration>
            <dependencies>
                <dependency>
                    <groupId>org.pf4j</groupId>
                    <artifactId>pf4j</artifactId>
                    <version>${pf4j.version}</version>
                </dependency>
            </dependencies>
        </plugin>

        <!-- JAR manifest 声明插件元数据 -->
        <plugin>
            <artifactId>maven-jar-plugin</artifactId>
            <configuration>
                <archive>
                    <manifestEntries>
                        <Plugin-Id>my-plugin</Plugin-Id>
                        <Plugin-Class>com.yourcompany.plugin.MyPlugin</Plugin-Class>
                        <Plugin-Version>${project.version}</Plugin-Version>
                        <Plugin-Provider>yourcompany</Plugin-Provider>
                    </manifestEntries>
                </archive>
            </configuration>
        </plugin>
    </plugins>
</build>
```

**关键配置项说明：**

| 配置项 | 说明 |
|--------|------|
| `Plugin-Id` | 插件唯一标识，必须与 manifest JSON 中的 `pluginId` 一致 |
| `Plugin-Class` | PF4J Plugin 入口类的全限定名 |
| `Plugin-Version` | 插件版本号 |
| `Plugin-Provider` | 插件提供者 |
| `ExtensionAnnotationProcessor` | 自动扫描 `@Extension` 注解，生成 `META-INF/extensions.idx` |

### 6. 构建与安装

```bash
# 构建插件 JAR
mvn clean package

# 通过 REST API 安装到 ActionDock
curl -X POST http://localhost:5177/api/plugins/install \
  -F "file=@target/my-plugin-1.0.0.jar"

# 通过 actiondock CLI 安装
actiondock plugin install ./target/my-plugin-1.0.0.jar \
  --json
```

---

## 核心接口详解

### ActionDockPlugin

插件扩展点接口，所有插件必须实现：

```java
public interface ActionDockPlugin extends ExtensionPoint {
    /** 插件唯一标识 */
    String id();

    /** 校验用户配置，校验失败抛出异常（可选覆写） */
    default void validateConfig(Map<String, Object> config) {}

    /** 执行插件动作 */
    Object invoke(String action, ScriptPluginContext context, Map<String, Object> args);
}
```

| 方法 | 是否必须 | 说明 |
|------|---------|------|
| `id()` | 必须 | 返回插件 ID，需与 manifest 中的 `pluginId` 一致 |
| `validateConfig()` | 可选 | 用户保存配置时调用，用于校验配置合法性 |
| `invoke()` | 必须 | 核心方法，根据 action 名称执行对应逻辑并返回结果 |

### ScriptPluginContext

调用 `invoke()` 时传入的上下文对象，包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `scriptId` | String | 当前执行的脚本 ID |
| `scriptName` | String | 脚本名称 |
| `executionId` | String | 本次执行的唯一 ID |
| `submitMode` | String | 提交模式 |
| `scriptInput` | Map | 脚本输入参数 |
| `pluginConfig` | Map | 当前插件的合并后配置 |

使用类型化配置：

```java
// 直接从 context 获取类型化的配置对象
MyConfig config = context.getPluginConfig(MyConfig.class);
```

### PluginConfigBinder

将 `Map<String, Object>` 配置绑定到 Java 配置类的工具方法：

```java
MyConfig config = PluginConfigBinder.bind(configMap, MyConfig.class);
```

`PluginConfigBinder` 只做 JSON 反序列化，不负责补默认值。默认值应统一维护在 manifest 的 `defaultConfig`，绑定前的配置如果需要合并，应由主应用先完成。

如果配置类自己写了字段初始值，那只是 Java/Jackson 反序列化过程中的对象状态，不是 ActionDock 平台承诺的默认值语义，插件不要依赖这种写法。

配置类只需包含标准的 getter/setter：

```java
public class MyConfig {
    private String prefix;
    private int maxRetries;

    // getter / setter
}
```

### PluginManifest

插件元数据描述，对应 classpath 下的 JSON 文件。用于向 ActionDock 主应用声明插件的能力：

| 字段 | 说明 |
|------|------|
| `pluginId` | 插件唯一标识 |
| `name` | 显示名称 |
| `description` | 插件描述，支持 Markdown/GFM；原始 HTML 按文本展示 |
| `version` | 版本号 |
| `configSchema` | JSON Schema 格式的配置定义，用于 UI 渲染配置表单 |
| `defaultConfig` | 默认配置值 |
| `actions` | 插件支持的动作列表 |

### PluginActionManifest

描述插件的一个动作（action）：

| 字段 | 说明 |
|------|------|
| `action` | 动作标识（在 invoke 中用于路由） |
| `title` | 动作显示名称 |
| `description` | 动作描述，支持 Markdown/GFM；原始 HTML 按文本展示 |
| `inputSchema` | 输入参数的 JSON Schema |
| `outputSchema` | 输出结果的 JSON Schema |
| `exampleArgs` | 示例调用参数，用于文档和测试 |

插件发布到仓库时，`description` 会直接来自 manifest，不在发布界面二次编辑。发布界面填写的是 `releaseNotes`，用于记录当前版本的发布日志。同一仓库内 `pluginId + version` 必须唯一；相同版本已经存在时会拒绝发布。

---

## 插件配置

### 配置生命周期

1. **默认配置**：manifest 文件中的 `defaultConfig`
2. **用户配置**：通过 REST API 或 UI 保存的配置，覆盖默认值
3. **生效配置**：运行时合并 `defaultConfig` + 用户配置

### configSchema 格式

`configSchema` 使用 JSON Schema 格式描述配置项，ActionDock 前端据此自动渲染配置表单：

```json
{
  "type": "object",
  "properties": {
    "apiUrl": {
      "type": "string",
      "title": "API 地址",
      "description": "远程服务的 URL"
    },
    "timeout": {
      "type": "integer",
      "title": "超时时间(ms)",
      "default": 5000
    },
    "enabled": {
      "type": "boolean",
      "title": "是否启用"
    }
  }
}
```

### 类型化配置绑定

定义 Java 配置类并通过 `PluginConfigBinder` 绑定：

```java
public class HttpPluginConfig {
    private String apiUrl;
    private int timeout;
    private boolean enabled;

    // getter / setter
}

// 在 invoke 中使用
HttpPluginConfig config = context.getPluginConfig(HttpPluginConfig.class);
String url = config.getApiUrl();
```

`context.getPluginConfig(...)` 读取到的是主应用已经合并完成的最终生效配置；这里的绑定步骤只负责把它转换成 `HttpPluginConfig`。

`validateConfig` 中进行配置校验：

```java
@Override
public void validateConfig(Map<String, Object> config) {
    HttpPluginConfig cfg = PluginConfigBinder.bind(config, HttpPluginConfig.class);
    if (cfg.getApiUrl() == null || cfg.getApiUrl().isBlank()) {
        throw new IllegalArgumentException("apiUrl 不能为空");
    }
}
```

同样，`validateConfig(...)` 收到的也是最终生效配置，不需要在插件里再次与 `defaultConfig` 合并。

---

## 在脚本中调用插件

ActionDock 在 Groovy 和 Python 脚本中都会注入 `plugins` 变量，可直接调用已安装且已启动的插件。

```groovy
// 基本调用（无参数）
def result = plugins.invoke("my-plugin", "hello")

// 带参数调用
def result = plugins.invoke("my-plugin", "hello", [
    name: "ActionDock"
])

// 使用插件返回结果
return [
    greeting: result.greeting,
    scriptId: result.scriptId
]
```

```python
# 基本调用（无参数）
result = plugins.invoke("my-plugin", "hello")

# 带参数调用
result = plugins.invoke("my-plugin", "hello", {
    "name": "ActionDock"
})

# 使用插件返回结果
return {
    "greeting": result["greeting"],
    "scriptId": result["scriptId"]
}
```

### 方法签名

```groovy
// 无额外参数
plugins.invoke(String pluginId, String action)

// 带额外参数
plugins.invoke(String pluginId, String action, Map<String, Object> args)
```

| 参数 | 说明 |
|------|------|
| `pluginId` | 插件 ID |
| `action` | 动作名称 |
| `args` | 传递给插件 invoke 的参数 |

---

## 插件生命周期管理

通过 REST API 管理插件的完整生命周期：

| 操作 | 方法 | 端点 | 说明 |
|------|------|------|------|
| 列出所有插件 | GET | `/api/plugins` | 返回所有已安装插件列表 |
| 查看插件详情 | GET | `/api/plugins/{pluginId}` | 返回单个插件的详细信息 |
| 安装插件 | POST | `/api/plugins/install` | 上传 JAR 并安装 |
| 升级插件 | POST | `/api/plugins/{pluginId}/upgrade` | 上传新版 JAR 替换旧版 |
| 启动插件 | POST | `/api/plugins/{pluginId}/start` | 启动已安装的插件 |
| 停止插件 | POST | `/api/plugins/{pluginId}/stop` | 停止运行中的插件 |
| 卸载插件 | DELETE | `/api/plugins/{pluginId}` | 停止并删除插件 |
| 获取配置 | GET | `/api/plugins/{pluginId}/config` | 获取插件当前配置 |
| 保存配置 | PUT | `/api/plugins/{pluginId}/config` | 保存插件配置 |
| 调试调用 | POST | `/api/plugins/{pluginId}/actions/{action}/invoke` | 通过 API 直接调用插件动作 |

### 生命周期流程

```
安装(install) → 已停止(STOPPED)
    ↓
启动(start) → 运行中(STARTED)  ←→ 停止(stop)
    ↓                              ↓
升级(upgrade) → 保留配置 → 已停止   卸载(uninstall) → 彻底删除
```

---

## 完整示例

以下模板项目包含一个完整的 Demo 插件，实现了 `echo` 动作：

### 文件结构

```
actiondock-plugin-template/
├── pom.xml
└── src/main/
    ├── java/org/team4u/actiondock/plugin/template/
    │   ├── TemplatePlugin.java          # PF4J Plugin 入口
    │   ├── DemoActionDockPlugin.java    # 扩展点实现
    │   └── DemoPluginConfig.java        # 配置类
    └── resources/META-INF/actiondock/plugins/
        └── actiondock-demo-plugin.json  # 插件 Manifest
```

### TemplatePlugin.java — PF4J 入口

```java
public class TemplatePlugin extends Plugin {
    public TemplatePlugin(PluginWrapper wrapper) {
        super(wrapper);
    }
}
```

### DemoActionDockPlugin.java — 扩展点实现

```java
@Extension
public class DemoActionDockPlugin implements ActionDockPlugin {

    @Override
    public String id() {
        return "actiondock-demo-plugin";
    }

    @Override
    public void validateConfig(Map<String, Object> config) {
        PluginConfigBinder.bind(config, DemoPluginConfig.class);
    }

    @Override
    public Object invoke(String action, ScriptPluginContext context, Map<String, Object> args) {
        if ("echo".equals(action)) {
            DemoPluginConfig config = context.getPluginConfig(DemoPluginConfig.class);
            String prefix = String.valueOf(config.getPrefix());
            String message = String.valueOf(args.getOrDefault("message", ""));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("message", prefix + ":" + message);
            result.put("scriptId", context.getScriptId());
            result.put("executionId", context.getExecutionId());
            return result;
        }
        throw new IllegalArgumentException("Unsupported action: " + action);
    }
}
```

### DemoPluginConfig.java — 配置类

```java
public class DemoPluginConfig {
    private String prefix;

    public String getPrefix() { return prefix; }
    public void setPrefix(String prefix) { this.prefix = prefix; }
}
```

### 在脚本中使用

```groovy
def result = plugins.invoke("actiondock-demo-plugin", "echo", [
    message: "hello"
])
return [pluginMessage: result.message]
```

```python
result = plugins.invoke("actiondock-demo-plugin", "echo", {
    "message": "hello"
})
return {"pluginMessage": result["message"]}
```

---

## 常见问题

### 插件 JAR 安装后无法启动？

检查以下配置是否正确：
- `pom.xml` 中 `Plugin-Id` 与 manifest JSON 中的 `pluginId` 是否一致
- `Plugin-Class` 是否指向正确的 PF4J Plugin 子类
- `maven-compiler-plugin` 是否配置了 `ExtensionAnnotationProcessor`
- 构建产物中 `META-INF/extensions.idx` 文件是否存在且包含扩展类全名

### 插件 invoke 抛出 "Unsupported action" 异常？

确保 `invoke()` 方法中覆盖了所有 manifest 里声明的 action，且 action 名称完全匹配。

### 配置绑定失败？

- 确保配置类有无参构造函数
- 确保字段有标准的 getter/setter
- JSON 字段名与 Java 字段名需匹配（支持驼峰/下划线自动转换）

### 如何在插件中使用第三方依赖？

在插件的 `pom.xml` 中正常添加依赖即可。PF4J 使用独立的 PluginClassLoader，插件的依赖不会与主应用冲突。注意不要将 `pf4j` 的 scope 设为 `compile`，应使用 `provided`。

---

## API 参考

### actiondock-plugin-api 模块

| 类/接口 | 说明 |
|---------|------|
| `ActionDockPlugin` | 插件扩展点接口，所有插件的核心契约 |
| `ScriptPluginContext` | 插件调用上下文，包含脚本信息和插件配置 |
| `PluginManifest` | 插件元数据描述，从 classpath JSON 加载 |
| `PluginActionManifest` | 动作元数据描述 |
| `PluginManifestLoader` | 从 classpath 加载 PluginManifest |
| `PluginConfigBinder` | Map → Java 配置对象的绑定工具 |
| `PluginRuntimeException` | 插件运行时异常 |
