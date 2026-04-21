# ScriptFlow

**ScriptFlow** 是一个轻量级的脚本执行平台，支持通过 Groovy 编写脚本，提供 Web API 和管理界面来定义、执行和管理脚本。

## 功能特性

- **脚本管理**：支持脚本的创建、编辑、发布和版本管理
- **Schema 驱动**：通过 JSON Schema 定义输入/输出结构，自动校验和投影
- **多运行方式**：支持 Web API 和 CLI 两种执行方式
- **在线编辑器**：集成 Monaco Editor，提供语法高亮和代码补全
- **执行追踪**：完整的执行记录和状态追踪
- **可视化渲染**：基于 amis 渲染器，支持自定义表单和页面

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Java 21, Spring Boot 3.3 |
| 脚本引擎 | Groovy 4.0 |
| 前端 | React 18, Ant Design 5, Monaco Editor |
| 数据库 | H2 (文件数据库) |
| UI 渲染器 | Amis |

## 快速开始

### 前置要求

- JDK 21+
- Maven 3.9+
- Node.js 18+（仅前端开发需要）

### 后端

```bash
# 编译
mvn clean package -DskipTests

# 启动 Web 应用
mvn -pl scriptflow-app-spring -am spring-boot:run

# 使用 CLI
java -jar scriptflow-app-cli/target/scriptflow-app-cli.jar script list
```

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
├── scriptflow-page-builder      # 页面构建器
└── scriptflow-renderer-amis     # Amis 渲染器适配
```

## 接口说明

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

```groovy
def greet(name) {
    return "Hello, ${name}!"
}

def result = greet(input.name)
return [message: result, timestamp: System.currentTimeMillis()]
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
| `scriptflow.data-dir` | `./data/dsl-runtime` | 数据存储目录 |
| `scriptflow.api-key.enabled` | false | 是否启用 API Key 鉴权 |
| `scriptflow.api-key.value` | - | API Key 值 |

### H2 控制台

H2 数据库 Web 控制台地址：`/h2-console`
- JDBC URL：`jdbc:h2:./data/dsl-runtime`
- 用户名：`sa`
- 密码：（空）

## 开源协议

MIT License
