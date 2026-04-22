# ScriptFlow

**ScriptFlow** 是一个轻量级的脚本执行平台，支持通过 Groovy 或 Python 编写脚本，提供 Web API、CLI 和管理界面来定义、执行和管理脚本。

## 功能特性

- **脚本管理**：支持脚本的创建、编辑、发布和版本管理
- **多脚本类型**：当前支持 `GROOVY` 与 `PYTHON`
- **插件扩展机制**：基于 PF4J 动态加载插件，支持安装、启动、停止、卸载和配置管理
- **Schema 驱动**：通过 JSON Schema 定义输入/输出结构，自动校验和投影
- **自动生成正式页**：已发布脚本自动生成专属执行页面，Schema 直接渲染为表单和结果展示，无需额外开发
- **多运行方式**：支持正式页面、Web API 和 CLI 三种执行方式
- **在线编辑器**：集成 Monaco Editor，提供语法高亮和代码补全
- **执行追踪**：完整的执行记录和状态追踪

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Java 21, Spring Boot 3.3 |
| 脚本引擎 | Groovy 4.0, Host Python 3.x |
| 前端 | React 18, Ant Design 5, Monaco Editor |
| 数据库 | H2 (文件数据库) |

## 快速开始

### 前置要求

- JDK 21+
- Maven 3.9+
- Node.js 18+（仅前端开发需要）
- Python 3.x（仅执行 `PYTHON` 类型脚本需要，默认命令为 `python3`）

### 后端

```bash
# 编译
mvn clean package -DskipTests

# 启动 Web 应用
mvn -pl scriptflow-app-spring -am spring-boot:run

# 使用 CLI
java -jar scriptflow-app-cli/target/scriptflow-app-cli.jar script list
```

如果要执行 `PYTHON` 类型脚本，请确认启动机器上存在可用的 `python3`，并且所需第三方包已经预装在该解释器环境中。

### 前端（开发模式）

```bash
cd scriptflow-admin-ui
npm install
npm run dev
```

管理控制台访问地址：`http://localhost:5173/admin/scripts`

### 生产环境

```bash
# 打包（包含前端静态资源）
mvn -pl scriptflow-app-spring -am package
java -jar scriptflow-app-spring/target/scriptflow-app-spring.jar
```

管理控制台访问地址：`http://localhost:8080/admin/scripts`

## 项目结构

```
scriptflow
├── scriptflow-core              # 核心领域模型与应用服务
├── scriptflow-plugin-api        # PF4J 插件扩展点与宿主交互协议
├── scriptflow-plugin-template   # 可编译的示例插件模板
├── scriptflow-storage-jpa       # H2/JPA 持久化适配
├── scriptflow-app-support       # Web 与 CLI 共用的运行配置
├── scriptflow-app-spring        # Spring Boot Web 入口
├── scriptflow-app-cli           # Spring Boot CLI 入口
├── scriptflow-admin-ui          # React 管理界面
```

## 接口说明

脚本定义中的 `type` 字段当前支持：

- `GROOVY`
- `PYTHON`

### 脚本管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/scripts` | 获取所有脚本列表 |
| POST | `/api/scripts` | 创建新脚本 |
| GET | `/api/scripts/{id}` | 获取指定脚本 |
| PUT | `/api/scripts/{id}` | 更新脚本 |
| DELETE | `/api/scripts/{id}` | 删除脚本 |
| POST | `/api/scripts/{id}/validate` | 校验脚本 |
| POST | `/api/scripts/{id}/publish` | 发布脚本 |

### 脚本执行

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/executions` | 执行脚本 |
| GET | `/api/executions/{id}` | 获取执行记录 |
| GET | `/api/executions?scriptId=...` | 按脚本获取执行记录 |

### 插件管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plugins` | 获取插件列表 |
| POST | `/api/plugins/install` | 上传并安装插件包 |
| POST | `/api/plugins/{pluginId}/start` | 启动插件 |
| POST | `/api/plugins/{pluginId}/stop` | 停止插件 |
| GET | `/api/plugins/{pluginId}/config` | 获取插件配置 |
| PUT | `/api/plugins/{pluginId}/config` | 更新插件配置 |
| DELETE | `/api/plugins/{pluginId}` | 卸载插件并删除数据库记录、文件与配置 |

### 响应视图

执行接口支持 `responseView` 参数：
- `RESULT`（默认）：轻量级响应，按 Schema 投影输出字段
- `DEBUG`：完整响应，包含原始输入和输出

## 脚本示例

### Groovy

```groovy
def greet(name) {
    return "Hello, ${name}!"
}

def result = greet(input.name)
return [message: result, timestamp: System.currentTimeMillis()]
```

`GROOVY` 类型脚本支持使用 `@Grab` / `@GrabResolver` 声明依赖。依赖解析发生在脚本编译阶段，首次拉取依赖需要运行环境可访问对应 Maven 仓库，并会使用 Grape 本地缓存。
默认会对相同源码的编译结果做内存缓存，避免重复编译；这只是“编译缓存”，不是执行结果缓存。

如果已经加载并启动插件，Groovy 脚本还可以通过统一门面调用插件动作：

```groovy
def result = plugins.invoke("scriptflow-demo-plugin", "echo", [
  message: "hello"
])

return [
  pluginMessage: result.message
]
```

插件调用约定：

- 统一入口为 `plugins.invoke("pluginId", "action")` 或 `plugins.invoke("pluginId", "action", [key: value])`
- `pluginId` 与 `action` 必须写成字符串字面量，不能从变量动态拼接
- 第三个参数必须是 `Map<String, Object>` 风格的 Groovy Map；省略时按空 Map 处理
- 保存/校验 Groovy 脚本时，会检查引用的插件和动作是否存在且已启动
- 插件调用异常会直接中断脚本；如果要降级处理，请在脚本里自行 `try/catch`

### Python

`PYTHON` 类型脚本在平台中按“函数体”执行。运行时会自动注入 `input` 变量，你可以直接 `return` JSON 可序列化结果。

```python
name = input.get("name") or "World"
return {
  "message": f"Hello, {name}!",
  "timestamp": 1710000000
}
```

**输入 Schema：**
```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "label": "姓名" }
  },
  "required": ["name"]
}
```

## 脚本类型约定

| 类型 | 编辑内容 | 输入访问方式 | 返回要求 |
|------|----------|--------------|----------|
| `GROOVY` | 完整 Groovy 脚本 | `input.name` / `input["name"]` | 任意返回值，平台会将非对象结果包装为 `result` |
| `PYTHON` | Python 函数体，不需要手写 `def main` | `input.get("name")` / `input["name"]` | 必须返回 JSON 可序列化结果；非对象结果同样会被包装为 `result` |

关于 `PYTHON` 的额外说明：

- 校验阶段只检查 Python 语法是否合法，不检查第三方包是否已安装
- 执行阶段通过宿主机 `python3` 子进程运行
- 当前不支持每个脚本单独声明 `requirements.txt` 或虚拟环境
- 当前默认信任脚本执行环境，请按受控内部工具使用

**输出 Schema：**
```json
{
  "type": "object",
  "properties": {
    "message": { "type": "string", "label": "消息" },
    "timestamp": { "type": "number", "label": "时间戳" }
  }
}
```

## 配置说明

### 默认配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `server.port` | 8080 | Web 服务端口 |
| `spring.datasource.url` | `jdbc:h2:file:./data/dsl-runtime;AUTO_SERVER=TRUE` | 默认 H2 文件库 |
| `app.auth.api-keys` | `[]` | 可选 API Key 列表，非空时可由鉴权组件使用 |
| `app.execution.async-pool-size` | `4` | 异步执行线程池大小 |
| `app.execution.groovy.enabled` | `true` | 是否启用 `GROOVY` 脚本编译缓存 |
| `app.execution.groovy.cache-max-size` | `128` | `GROOVY` 编译缓存最大条目数 |
| `app.execution.groovy.cache-expire-after-access-minutes` | `30` | `GROOVY` 编译缓存空闲过期时间 |
| `app.execution.python.executable` | `python3` | `PYTHON` 脚本使用的解释器命令 |
| `app.execution.python.timeout-seconds` | `30` | `PYTHON` 脚本单次执行超时时间 |
| `app.plugins.dir` | `./plugins` | PF4J 插件目录 |

示例：

```yaml
app:
  plugins:
    dir: ./plugins
  auth:
    api-keys:
      - local-dev-key
  execution:
    async-pool-size: 8
    groovy:
      enabled: true
      cache-max-size: 256
      cache-expire-after-access-minutes: 60
    python:
      executable: python3
      timeout-seconds: 60
```

## 插件使用说明

### 1. 打包插件模板

项目内置了一个示例插件子模块 `scriptflow-plugin-template`，可以直接打包：

```bash
mvn -pl scriptflow-plugin-template package
```

产物默认位于：

```bash
scriptflow-plugin-template/target/scriptflow-plugin-template-0.2.0.jar
```

这个示例插件会暴露：

- `pluginId`: `scriptflow-demo-plugin`
- `action`: `echo`

模板插件的元数据位于：

```text
scriptflow-plugin-template/src/main/resources/META-INF/scriptflow/plugins/scriptflow-demo-plugin.json
```

插件实现类返回插件 `id()`，宿主按约定路径加载 manifest：

```text
META-INF/scriptflow/plugins/{pluginId}.json
```

模板插件当前的最小实现思路是：

- 实现 `ScriptFlowPlugin`
- `id()` 返回插件唯一标识
- `validateConfig(...)` 负责校验插件级配置
- `invoke(...)` 负责执行动作
- `configSchema`、`defaultConfig`、`actions` 等元数据统一维护在 JSON 中
- 每个动作可以同时声明 `inputSchema` 和 `outputSchema`

默认配置示例：

```json
{
  "prefix": "demo"
}
```

### 2. 安装插件

当前推荐通过管理界面安装：

1. 启动 `scriptflow-app-spring`
2. 打开 `http://localhost:8080/admin/plugins`
3. 点击“上传安装”
4. 选择插件 `jar`

安装完成后，服务端会执行：

1. 将插件包保存到 `app.plugins.dir`
2. 通过 PF4J `load`
3. 自动 `start`
4. 将插件元数据写入 `plugin_registration` 表，并标记为启用

如果其中任一步失败，安装会回滚并返回错误。

如果你要基于模板开发自定义插件，通常需要同时修改两处：

1. Java 实现类中的 `id()`
2. `META-INF/scriptflow/plugins/{pluginId}.json` 中的插件元数据

### 3. 启动、停止、卸载

插件管理页支持以下操作：

- **启动**：将数据库中的插件记录标记为启用，并把对应插件加载到 JVM
- **停止**：停止插件，并将数据库记录标记为 disabled
- **卸载**：停止并卸载插件，同时删除数据库记录、插件文件与保存的配置文件

说明：

- 平台启动时不会扫描整个插件目录自动加载所有文件
- 只有 `plugin_registration` 表中 `enabled=true` 的插件，才会从 `app.plugins.dir` 加载到 JVM
- 已停止的插件不会通过脚本校验，也不能在 Groovy 中调用
- 卸载后，数据库记录、插件文件与对应配置文件会一并删除

### 4. 插件配置

管理界面支持两种方式编辑插件配置：

- **表单输入**：根据 `configSchema` 自动渲染配置表单
- **JSON 输入**：直接编辑完整配置对象

配置行为：

- 配置内容必须是 JSON 对象
- 表单模式会按 `configSchema` 渲染支持的字段
- 如果 `configSchema` 中含有当前表单模式不支持的字段，仍然可以切到 JSON 模式完整维护
- 保存时会先做基础 JSON 校验，再调用插件自身的 `validateConfig(...)`
- 配置文件默认保存到：

```bash
${app.plugins.dir}/.scriptflow-config/{pluginId}.json
```

模板插件的配置示例：

```json
{
  "prefix": "hello"
}
```

此时执行：

```groovy
plugins.invoke("scriptflow-demo-plugin", "echo", [message: "world"])
```

返回结果类似：

```json
{
  "message": "hello:world",
  "scriptId": "script-1",
  "executionId": "..."
}
```

### 5. Groovy 中调用插件

最常见的调用方式：

```groovy
def result = plugins.invoke("scriptflow-demo-plugin", "echo", [
  message: input.name ?: "World"
])

return [
  echoed: result.message
]
```

无参调用：

```groovy
def value = plugins.invoke("some-plugin", "ping")
return [result: value]
```

建议：

- 把插件调用结果先赋值给局部变量，再组合最终返回值
- 插件动作的 `exampleArgs` 可以在脚本编辑页的“插件参考”面板里直接复制
- 如果某个插件可能不可用，请在脚本里显式做 `try/catch`

例如：

```groovy
try {
  return plugins.invoke("scriptflow-demo-plugin", "echo", [message: "safe"])
} catch (Exception ex) {
  return [message: "fallback", reason: ex.message]
}
```

### 6. 管理界面说明

插件管理入口：

```text
/admin/plugins
```

脚本编辑页中，当脚本类型为 `GROOVY` 时，会显示“插件参考”面板，内容包括：

- 已启动插件列表
- 每个动作的说明
- `inputSchema`
- `outputSchema`
- `exampleArgs`
- 可直接复制的 `plugins.invoke(...)` 代码片段

### 7. CLI 说明

当前 CLI 不提供插件管理命令，但 CLI 运行脚本时会共享同一套插件运行时。

也就是说：

- 只要 CLI 进程使用的 `app.plugins.dir` 与 Web 服务一致
- 且数据库中已经存在该插件记录并标记为启用
- 且对应插件文件存在于该目录中

那么通过 CLI 执行 Groovy 脚本时，同样可以调用：

```groovy
plugins.invoke("pluginId", "action", [:])
```

### 8. 常见问题

**1. 为什么脚本校验时报“插件未启动”？**

因为 Groovy 校验会检查 `plugins.invoke("pluginId", "action", ...)` 中引用的插件和动作是否可用。已停止插件会导致校验失败。

**2. 为什么不支持 `plugins.invoke(pluginIdVar, actionVar, args)`？**

当前实现要求前两个参数必须是字符串字面量，这样平台才能在校验阶段静态检查插件和动作是否存在。

**3. Python 脚本能否调用插件？**

当前版本不支持。插件门面只注入到 `GROOVY` 脚本运行时。

**4. 插件类能否直接在 Groovy 中 `import`？**

不建议，也没有作为平台约定支持。当前稳定方式是通过宿主注入的 `plugins.invoke(...)` 门面进行跨类加载器调用。

### H2 控制台

H2 数据库 Web 控制台地址：`/h2-console`
- JDBC URL：`jdbc:h2:file:./data/dsl-runtime;AUTO_SERVER=TRUE`
- 用户名：`sa`
- 密码：（空）

## 开源协议

MIT License
