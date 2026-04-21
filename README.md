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

scriptflow-app-spring
  Spring Boot 入口，提供 Web API 和 CLI
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
mvn -pl scriptflow-app-spring -am package
java -jar scriptflow-app-spring/target/scriptflow-app-spring.jar cli script list
java -jar scriptflow-app-spring/target/scriptflow-app-spring.jar cli run --id hello-groovy --input '{"name":"Alice"}'
```

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

## 说明

- 数据库：H2 文件库
- 脚本：Groovy
- 鉴权：API Key，可为空
- 当前仓库按 Spring Boot 3 / Java 21 组织
- 开发阶段如果从旧版切换过来，删除本地 `data/dsl-runtime*` 以清理已下线的 page 数据
