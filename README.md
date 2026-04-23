# ScriptFlow

**ScriptFlow** 是一个面向团队协作和大模型接入的脚本管理平台。

它的目标不是单纯“把脚本跑起来”，而是把原本分散、不可控、难复用的脚本，收敛成一套可管理、可发布、可审计、可稳定调用的运行体系。你可以继续使用熟悉的 Groovy 或 Python 编写脚本，但脚本在平台里会被统一纳管，并通过一致的输入输出协议对外暴露。

对团队来说，ScriptFlow 解决的是脚本资产沉淀和调用规范问题；对大模型来说，ScriptFlow 提供的是一层稳定的工具接入面，让模型不必关心脚本内部用什么语言实现，只需要按统一的 API 或 CLI 协议完成发现、传参和执行。

## 项目优势

- **统一管理脚本资产**：把零散脚本收敛到同一平台中管理，支持创建、编辑、发布、版本化和执行追踪，避免脚本散落在个人目录、服务器和临时仓库中
- **规范输入输出协议**：通过 JSON Schema 约束输入输出结构，统一校验、投影和正式页渲染，减少“脚本能跑但不好接”的问题
- **便于大模型接入**：脚本可以通过 Web API 和官方 CLI 以一致协议暴露给大模型调用，模型不需要理解底层实现语言，只需要理解工具名称、输入参数和输出结果
- **降低集成和复用成本**：同一个脚本可以同时服务于人用页面、系统 API、CLI 调用和自动化流程，避免重复封装多套入口
- **提升可维护性和可观测性**：平台统一记录执行状态、日志、错误信息和历史结果，让脚本从“黑盒命令”变成可追踪、可排查的运行单元

## 功能特性

- **脚本管理**：支持脚本的创建、编辑、发布和版本管理
- **多脚本类型**：当前支持 `GROOVY` 与 `PYTHON`
- **脚本互调**：脚本之间可以通过统一门面相互调用，便于组合复用
- **插件扩展机制**：基于 PF4J 动态加载插件，支持安装、启动、停止、卸载和配置管理
- **Schema 驱动**：通过 JSON Schema 定义输入/输出结构，自动完成校验、投影和接入约束
- **自动生成正式页**：已发布脚本自动生成专属执行页面，Schema 直接渲染为表单和结果展示，无需额外开发
- **多运行方式**：支持正式页面、Web API 与薄封装 REST CLI 三种统一调用方式
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

# 构建 CLI
mvn -pl scriptflow-cli -am package

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

### CLI（薄封装 REST Client）

CLI 不直接嵌入运行时，只负责调用现有 Web API。

```bash
# 查看当前生效配置
java -jar scriptflow-cli/target/scriptflow-cli.jar config current

# 直接通过 flag 调用
java -jar scriptflow-cli/target/scriptflow-cli.jar \
  --base-url http://localhost:8080 \
  --token local-dev-key \
  scripts list

# 通过 profile 保存连接信息
java -jar scriptflow-cli/target/scriptflow-cli.jar config profile set local \
  --base-url http://localhost:8080 \
  --token local-dev-key
java -jar scriptflow-cli/target/scriptflow-cli.jar scripts list
```

CLI 配置优先级：

- 命令行 flag
- 环境变量 `SCRIPTFLOW_BASE_URL` / `SCRIPTFLOW_TOKEN` / `SCRIPTFLOW_PROFILE`
- `~/.scriptflow/config.json`
- 默认 `http://localhost:8080`

## 项目结构

```
scriptflow
├── scriptflow-core              # 核心领域模型与应用服务
├── scriptflow-plugin-api        # PF4J 插件扩展点与宿主交互协议
├── scriptflow-plugin-template   # 可编译的示例插件模板
├── scriptflow-storage-jpa       # H2/JPA 持久化适配
├── scriptflow-app-support       # 运行时共用配置
├── scriptflow-cli               # 官方 REST CLI 客户端
├── scriptflow-app-spring        # Spring Boot Web 入口
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
| GET | `/api/plugins/{pluginId}` | 获取单个插件详情 |
| POST | `/api/plugins/install` | 上传并安装插件包；若 `pluginId` 已存在则拒绝 |
| POST | `/api/plugins/{pluginId}/upgrade` | 升级指定插件包，保留配置与启用状态 |
| POST | `/api/plugins/{pluginId}/start` | 启动插件 |
| POST | `/api/plugins/{pluginId}/stop` | 停止插件 |
| GET | `/api/plugins/{pluginId}/config` | 获取插件配置 |
| PUT | `/api/plugins/{pluginId}/config` | 更新插件配置 |
| POST | `/api/plugins/{pluginId}/actions/{action}/invoke` | 同步调用插件动作，可返回 `RESULT` 或 `DEBUG` 视图 |
| DELETE | `/api/plugins/{pluginId}` | 卸载插件并删除数据库记录、文件与配置 |

### 配置值管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config-values` | 获取所有全局配置值 |
| GET | `/api/config-values/{key}` | 获取单个配置值 |
| POST | `/api/config-values` | 创建配置值 |
| PUT | `/api/config-values/{key}` | 更新配置值 |
| DELETE | `/api/config-values/{key}` | 删除配置值 |

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
log.info("Greeting generated for ${input.name}")
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
- 第三个参数必须是 `Map<String, Object>` 风格的 Groovy Map；省略时按空 Map 处理
- 保存/校验 Groovy 脚本时，只做 Groovy 语法与编译校验，不检查引用的插件和动作
- 插件调用异常会直接中断脚本；如果要降级处理，请在脚本里自行 `try/catch`

Groovy / Python 脚本运行时还会注入只读 `config` 变量，内容来自平台维护的“配置值管理”：

```groovy
return [
  apiBase: config["service.base_url"],
  authorization: "Bearer ${config['openai.api_key']}"
]
```

### Python

`PYTHON` 类型脚本在平台中按“函数体”执行。运行时会自动注入 `input` 变量，你可以直接 `return` JSON 可序列化结果。

```python
name = input.get("name") or "World"
log.info(f"Preparing greeting for {name}")
return {
  "message": f"Hello, {name}!",
  "timestamp": 1710000000
}
```

也可以直接读取注入的只读 `config`：

```python
return {
  "apiBase": config.get("service.base_url"),
  "authorization": f"Bearer {config.get('openai.api_key', '')}"
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

执行日志约定：

- 运行时会注入同一个 `log` 对象，支持 `log.debug(message)`、`log.info(message)`、`log.warn(message)`、`log.error(message)`
- 四个级别的方法入参一致，当前都只接收一个 `message` 参数；平台会按 `String.valueOf(...)` / `str(...)` 方式转成文本保存
- 日志会写入执行记录，可在执行历史、正式运行页和调试页查看
- 当前只采集显式 `log.*`，不保证 `print/println` 会进入执行日志

Groovy 示例：

```groovy
log.debug("raw input = ${input}")
log.info("start script")
log.warn("fallback to default name")
log.error("downstream request failed")
```

Python 示例：

```python
log.debug(f"raw input = {input}")
log.info("start script")
log.warn("fallback to default name")
log.error("downstream request failed")
```

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

### 全局配置值管理

平台支持维护一组全局字符串配置值，供脚本、插件配置、调度输入和调试参数复用。

管理方式：

- 管理台新增“配置值管理”菜单
- REST API 使用 `/api/config-values`
- 当前只做明文存储，不做加密

数据结构：

- `key`：唯一标识，例如 `openai.api_key`、`service.base_url`
- `value`：字符串值
- `description`：可选说明

占位符语法：

- 使用 `${config.some.key}` 引用全局配置值
- 支持整串替换，也支持嵌入字符串中，例如 `Bearer ${config.openai.api_key}`
- 配置值本身也可以引用其他配置值
- 如果引用缺失或出现循环引用，保存或运行时会报错

创建示例：

```bash
curl -X POST http://localhost:8080/api/config-values \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "service.base_url",
    "value": "https://api.example.com/v1",
    "description": "主业务接口地址"
  }'
```

再创建一个复用前一个值的配置值：

```bash
curl -X POST http://localhost:8080/api/config-values \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "service.health_url",
    "value": "${config.service.base_url}/health"
  }'
```

使用范围：

- 脚本运行时：直接读取 `config["some.key"]`
- 插件配置：在 JSON 或表单对应的字符串字段中填写 `${config.some.key}`
- 插件调试参数：`args` / `scriptInput` 中可填写 `${config.some.key}`
- 手工执行脚本输入：请求体 `input` 中可填写 `${config.some.key}`
- 定时任务固定输入：`input` 中可填写 `${config.some.key}`

说明：

- 保存的原始 JSON 会保留占位符，不会写回展开后的死值
- 实际执行、插件调用、调试运行时才会按最新配置值解析
- 修改配置值后，后续运行会自动看到新值，无需重新保存脚本或插件配置

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

## 插件开发与使用

### 1. 运行时约定

插件运行时现在以数据库为准，而不是扫描目录自动装载全部 jar。

- 插件元数据持久化在 `plugin_registration` 表
- `app.plugins.dir` 只负责存放插件包和配置文件
- 平台启动时只会根据 `plugin_registration.enabled=true` 的记录加载对应插件文件
- 目录里额外存在的 jar 不会自动进 JVM
- 停止插件会把数据库记录改为停用，并将插件从 JVM 卸载
- 卸载插件会同时删除数据库记录、插件文件与 `${app.plugins.dir}/.scriptflow-config/{pluginId}.json`

### 2. 开发插件

项目内置了一个可直接编译的模板模块 `scriptflow-plugin-template`：

```bash
mvn -pl scriptflow-plugin-template package
```

产物默认位于：

```bash
scriptflow-plugin-template/target/scriptflow-plugin-template-0.2.0.jar
```

插件需要实现 `ScriptFlowPlugin`，并通过 `id()` 返回唯一插件标识。宿主会按约定从 jar 内加载 manifest：

```text
META-INF/scriptflow/plugins/{pluginId}.json
```

模板插件当前把整份 manifest 放在资源文件中维护，包括：

- `pluginId`
- `name`
- `description`
- `version`
- `configSchema`
- `defaultConfig`
- `actions`

每个动作都可以声明：

- `action`
- `title`
- `description`
- `inputSchema`
- `outputSchema`
- `exampleArgs`

模板示例 manifest 位于：

```text
scriptflow-plugin-template/src/main/resources/META-INF/scriptflow/plugins/scriptflow-demo-plugin.json
```

模板示例当前暴露：

- `pluginId`: `scriptflow-demo-plugin`
- `action`: `echo`

模板插件推荐直接定义强类型配置类，并通过 `ScriptPluginContext#getPluginConfig(Class<T>)` 读取：

```java
DemoPluginConfig config = context.getPluginConfig(DemoPluginConfig.class);
String prefix = config.getPrefix();
```

这里的 `pluginConfig` 已经是主应用合并后的最终生效配置；`getPluginConfig(Class<T>)` 只负责把这份配置转换成目标 Java 类型。

也可以在 `validateConfig(...)` 中复用同一套绑定逻辑：

```java
@Override
public void validateConfig(Map<String, Object> config) {
    PluginConfigBinder.bind(config, DemoPluginConfig.class);
}
```

模板插件当前的推荐写法是：

- `DemoPluginConfig` 只负责承载类型，不在类字段里重复声明模板默认值
- 默认值统一写在 manifest 的 `defaultConfig`
- `validateConfig(...)` 和运行时 `context.getPluginConfig(...)` 都基于最终生效配置工作

示例：

```java
public class DemoPluginConfig {
    private String prefix;

    public String getPrefix() {
        return prefix;
    }

    public void setPrefix(String prefix) {
        this.prefix = prefix;
    }
}
```

如果你要基于模板开发自定义插件，至少需要同时修改两处：

1. Java 实现类中的 `id()`
2. `META-INF/scriptflow/plugins/{pluginId}.json`

### 3. 安装、升级、启停、删除

管理入口：

```text
/admin/plugins
```

插件列表页保持轻量，只展示基础信息和行内操作。点击“详情”进入插件详情页。

- “上传安装”用于新增插件
- “升级”只针对当前行插件执行热替换
- “启动”会把数据库记录设为启用，并把插件加载到 JVM
- “停止”会把数据库记录设为停用，并把插件从 JVM 卸载
- “卸载”会删除数据库记录、插件文件与持久化配置

安装流程：

1. 将插件包保存到 `app.plugins.dir`
2. 通过 PF4J 临时加载并校验
3. 读取 manifest
4. 将插件元数据写入 `plugin_registration`
5. 标记为启用并启动插件

限制：

- 安装接口要求数据库中不存在相同 `pluginId`
- 重复上传同一 `pluginId` 不会自动覆盖，必须使用“升级”

升级流程：

1. 卸载当前 JVM 中的旧插件
2. 写入新插件文件
3. 校验新插件 `pluginId` 必须与升级目标一致
4. 用新 manifest 刷新数据库元数据
5. 保留原有配置文件
6. 保留原有启用状态
7. 删除旧插件文件

升级失败会回滚数据库与文件状态；如果旧插件原先处于启用状态，也会尝试重新加载回 JVM。

### 4. 插件详情页

插件详情页与脚本详情页对齐，包含 4 个页签：

- `概览`：查看插件基本信息、动作说明、输入字段、输出字段
- `配置`：按 `configSchema` 以“表单输入 / JSON 输入”两种模式维护配置
- `调试`：同步调用指定动作，可填写动作参数和“脚本输入模拟”
- `调用命令`：基于当前调试参数生成 REST 命令

说明：

- 调试页只暴露动作参数和“脚本输入模拟”
- `scriptId`、`scriptName`、`executionId`、`submitMode` 由运行时注入，不在页面上手工填写
- 返回结果只会按动作 `outputSchema` 投影；如果请求 `DEBUG` 视图，只会额外附带调试上下文

### 5. 插件配置

插件配置页支持两种输入方式：

- `表单输入`：根据 `configSchema` 渲染可视化字段
- `JSON 输入`：直接维护完整配置对象

配置约定：

- 配置顶层必须是 JSON 对象
- 表单模式只渲染当前前端支持的字段类型
- 如果 schema 含有暂不支持的字段，仍可切到 JSON 模式完整编辑
- 字符串字段支持填写 `${config.some.key}` 引用平台全局配置值
- 保存时会先做 JSON 解析，再按 `defaultConfig + 用户配置` 合并为最终生效配置，解析配置值引用后，再调用插件自身 `validateConfig(...)`
- 配置文件默认保存到 `${app.plugins.dir}/.scriptflow-config/{pluginId}.json`
- 运行时 `context.getPluginConfig()` 与保存时 `validateConfig(...)` 看到的是同一份最终生效配置

最终生效配置的优先级：

1. manifest `defaultConfig`
2. 用户当前保存的配置覆盖项

说明：

- 持久化文件中保存的是“用户覆盖项”，不是展开后的完整配置
- 插件在 `validateConfig(...)` 和 `invoke(...)` 中拿到的是已经合并且已解析配置值引用的最终配置
- 模板插件建议把默认值只维护在 manifest，避免 Java 配置类和 manifest 出现双份默认值

如果插件希望把配置对象映射到强类型类，可以直接使用：

```java
DemoPluginConfig config = context.getPluginConfig(DemoPluginConfig.class);
```

`PluginConfigBinder` 的默认行为：

- 只做 `Map<String, Object>` 到目标 Java 类型的 JSON 反序列化，不负责补默认值或做二次合并
- 未声明的额外字段会忽略
- 类型不匹配会抛出 `IllegalArgumentException`
- 如果配置类自己声明了字段初始值，这属于 Java/Jackson 的对象构造细节，不属于平台承诺的默认值机制；插件不要依赖它

模板插件的默认配置示例：

```json
{
  "prefix": "demo"
}
```

### 6. 在 Groovy 中调用插件

Groovy 运行时通过统一门面调用插件动作：

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

调用约定：

- 统一入口是 `plugins.invoke("pluginId", "action")` 或 `plugins.invoke("pluginId", "action", [:])`
- 第三个参数按 `Map<String, Object>` 处理；省略时默认空对象
- Groovy 脚本保存/校验阶段只检查语法和编译是否通过
- 运行时仍然要求目标插件已启用且已加载，且动作存在
- 插件动作返回非对象时，平台会包装成 `{ "result": ... }`

脚本编辑页里的“插件参考”面板只展示已启动插件，支持：

- 名称 / `pluginId` 模糊查询
- 分页查看
- 点击插件名称弹出参考详情
- 按动作查看输入字段、输出字段和复制调用片段

### 7. 脚本之间相互调用

脚本运行时通过统一门面调用其他脚本：

Groovy 示例：

```groovy
def result = scripts.invoke("child-script", [
  name: input.name
])

return [
  childMessage: result.message
]
```

Python 示例：

```python
result = scripts.invoke("child-script", {
    "name": input.get("name")
})

return {
    "childMessage": result.get("message")
}
```

无参调用：

```groovy
def value = scripts.invoke("health-check")
return [result: value]
```

调用约定：

- 统一入口是 `scripts.invoke("scriptId")` 或 `scripts.invoke("scriptId", {...})`
- 当前支持 `GROOVY` 和 `PYTHON` 作为调用方
- 被调用脚本固定执行“已发布版本”，不会读取未发布草稿
- 被调用脚本仍按自己的 `inputSchema` 校验参数
- 脚本互调属于同一次执行链路，不会额外生成新的执行记录
- 运行时会检测循环调用，例如 `a -> b -> a`，命中后直接报错
- 被调用脚本返回非对象时，平台会包装成 `{ "result": ... }`

脚本编辑页里的“脚本参考”面板只展示已发布脚本，支持：

- 名称 / `scriptId` 模糊查询
- 分页查看
- 点击脚本名称弹出参考详情
- 查看已发布输入字段、输出字段和复制调用片段

### 8. 直接调试插件动作

REST 调试接口：

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"args":{"message":"hello"},"scriptInput":{"name":"Alice"},"responseView":"DEBUG"}' \
  'http://localhost:8080/api/plugins/scriptflow-demo-plugin/actions/echo/invoke'
```

请求体字段：

- `args`：动作参数
- `scriptInput`：模拟脚本上下文中的脚本输入；在界面上显示为“脚本输入模拟”
- `responseView`：`RESULT` 或 `DEBUG`

`args` 和 `scriptInput` 中的字符串同样支持 `${config.some.key}`。

`DEBUG` 视图会额外返回：

- `debug.args`
- `debug.scriptInput`

### 9. 手工执行与定时任务中使用配置值

脚本执行接口和定时任务固定输入都支持使用配置值占位符。

手工执行示例：

```bash
curl -X POST http://localhost:8080/api/executions \
  -H 'Content-Type: application/json' \
  -d '{
    "scriptId": "demo-script",
    "mode": "SYNC",
    "input": {
      "baseUrl": "${config.service.base_url}",
      "authorization": "Bearer ${config.openai.api_key}"
    }
  }'
```

定时任务固定输入示例：

```json
{
  "scriptId": "demo-script",
  "name": "nightly-sync",
  "cronExpression": "0 0 2 * * *",
  "enabled": true,
  "input": {
    "baseUrl": "${config.service.base_url}",
    "healthUrl": "${config.service.health_url}"
  }
}
```

行为说明：

- 定时任务保存时会先解析占位符，再按脚本 `inputSchema` 校验
- 定时任务真正触发执行时，会再次按最新配置值解析
- 正式使用页和管理台里的“执行 / 调试”入口也遵循相同规则

### 10. 常见问题

**1. 为什么脚本保存能通过，但运行时报“插件未启动”或“插件动作不存在”？**

因为 Groovy 校验阶段不再检查 `plugins.invoke(...)` 中引用的插件和动作。相关问题会在脚本实际执行到该调用时才报错。

**2. 为什么不支持 `plugins.invoke(pluginIdVar, actionVar, args)`？**

支持。`pluginId` 和 `action` 可以来自变量、函数返回值或其他表达式，只要运行时最终能解析成字符串即可。

**3. Python 脚本能否调用插件？**

当前版本不支持。插件门面只注入到 `GROOVY` 脚本运行时。

**4. Python 脚本能否调用其他脚本？**

支持。`scripts.invoke(...)` 同时注入到 `GROOVY` 和 `PYTHON` 运行时。

**5. 为什么脚本参考里有的脚本看不到？**

因为“脚本参考”只展示已发布脚本。未发布脚本不能被 `scripts.invoke(...)` 调用。

**6. 插件类能否直接在 Groovy 中 `import`？**

不建议，也没有作为平台约定支持。当前稳定方式是通过宿主注入的 `plugins.invoke(...)` 门面进行跨类加载器调用。

**7. 反复上传同一个插件 jar 会自动覆盖吗？**

不会。顶部“上传安装”只处理新增插件；如果数据库里已经有相同 `pluginId`，安装会失败。需要在对应插件行点击“升级”。

**8. 升级插件后会丢失配置吗？**

不会。升级会保留 `${app.plugins.dir}/.scriptflow-config/{pluginId}.json` 中的现有配置，并保留原先启用/停用状态。

### H2 控制台

H2 数据库 Web 控制台地址：`/h2-console`
- JDBC URL：`jdbc:h2:file:./data/dsl-runtime;AUTO_SERVER=TRUE`
- 用户名：`sa`
- 密码：（空）

## 开源协议

MIT License
