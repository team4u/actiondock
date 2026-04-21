# Scriptflow Runtime Spring Multi

这是一个按多模块重构后的一期代码骨架，重点是把：

- 脚本定义
- 执行实例

拆成清晰层次，当前聚焦脚本定义与执行主链路。

## 模块

```text
scriptflow-core
  领域模型、端口、应用服务

scriptflow-storage-jpa
  H2/JPA 持久化适配

scriptflow-app-support
  Web / CLI 共用运行时装配与脚本引擎配置

scriptflow-app-spring
  Spring Boot Web 入口，提供 Web API 和管理台

scriptflow-app-cli
  Spring Boot CLI 入口，提供脚本查询与执行命令
```

## 运行

### Web
```bash
mvn -pl scriptflow-app-spring -am spring-boot:run
```

开发阶段可以前后端分开启动：

```bash
# 后端
mvn -pl scriptflow-app-spring -am spring-boot:run

# 前端
cd scriptflow-admin-ui
npm install
npm run dev
```

前端开发地址：

- `http://localhost:5173/admin/scripts`

如果需要把前端静态资源一起打进后端 jar，再执行：

```bash
mvn -pl scriptflow-app-spring -am package
java -jar scriptflow-app-spring/target/scriptflow-app-spring.jar
```

管理控制台入口：

- `http://localhost:8080/admin/scripts`

前端本地开发：

```bash
cd scriptflow-admin-ui
npm install
npm run dev
```

### CLI
```bash
mvn -pl scriptflow-app-cli -am package
java -jar scriptflow-app-cli/target/scriptflow-app-cli.jar script list
java -jar scriptflow-app-cli/target/scriptflow-app-cli.jar run --id hello-groovy --input '{"name":"Alice"}'
```

说明：

- `scriptflow-app-cli` 默认不参与 reactor 下的 `spring-boot:run`，避免 `mvn -pl scriptflow-app-spring -am spring-boot:run` 时误先启动 CLI。

如果都从项目根目录启动，CLI 与 Web 默认共享同一个 H2 文件库 `./data/dsl-runtime`，但运行时上下文、依赖和打包产物已经分离。

## 一期接口

### Script
- `GET /api/scripts`
- `POST /api/scripts`
- `GET /api/scripts/{id}`
- `PUT /api/scripts/{id}`
- `DELETE /api/scripts/{id}`
- `POST /api/scripts/{id}/validate`
- `POST /api/scripts/{id}/publish`

### Execution
- `POST /api/executions`
- `GET /api/executions/{id}`
- `GET /api/executions?scriptId=...`

执行接口说明：

- `POST /api/executions` 默认返回轻量执行结果，不回显完整 `input`，`output` 会按脚本的 `outputSchema` 做顶层字段投影
- `POST /api/executions` 支持可选 `responseView: "RESULT" | "DEBUG"`，其中 `DEBUG` 会额外返回原始 `input` 和 `rawOutput`
- `GET /api/executions/{id}` 与 `GET /api/executions?scriptId=...` 继续返回完整执行记录，包含原始 `input` 和 `output`

## 说明

- 数据库：H2 文件库
- 脚本：Groovy
- 鉴权：API Key，可为空
- 当前仓库按 Spring Boot 3 / Java 21 组织
- 开发阶段如果从旧版切换过来，删除本地 `data/dsl-runtime*` 以清理已下线的 page 数据
