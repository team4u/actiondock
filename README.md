# ScriptFlow

**ScriptFlow** 是一个轻量级的脚本执行平台，支持通过 Groovy 或 Python 编写脚本，提供 Web API、CLI 和管理界面来定义、执行和管理脚本。

## 功能特性

- **脚本管理**：支持脚本的创建、编辑、发布和版本管理
- **多脚本类型**：当前支持 `GROOVY` 与 `PYTHON`
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

示例：

```yaml
app:
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

### H2 控制台

H2 数据库 Web 控制台地址：`/h2-console`
- JDBC URL：`jdbc:h2:file:./data/dsl-runtime;AUTO_SERVER=TRUE`
- 用户名：`sa`
- 密码：（空）

## 开源协议

MIT License
