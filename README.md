# Scriptflow Runtime Spring Multi

这是一个按多模块重构后的一期代码骨架，重点是把：

- 脚本定义
- 执行实例
- 页面定义
- 页面组装
- AMIS 渲染

拆成清晰层次，而不是继续把 AMIS 细节塞进脚本定义里。

## 模块

```text
scriptflow-core
  领域模型、端口、应用服务

scriptflow-page-builder
  PageDefinition + ScriptDefinition -> ViewSchema

scriptflow-renderer-amis
  ViewSchema -> AMIS schema

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
java -jar scriptflow-app-spring/target/scriptflow-app-spring.jar cli page schema --id hello-page
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

### Page 管理态
- `GET /api/pages`
- `POST /api/pages`
- `GET /api/pages/{id}`
- `PUT /api/pages/{id}`
- `DELETE /api/pages/{id}`
- `POST /api/pages/{pageId}/scaffold-from-script/{scriptId}`

### Page 运行态
- `GET /api/page-runtime/{id}/schema`
- `POST /api/page-runtime/{id}/actions/{actionId}`
- `POST /api/pages/{id}/submit`

## 说明

- 数据库：H2 文件库
- 脚本：Groovy
- 鉴权：API Key，可为空
- 当前环境没有 Maven，因此这里没有做实际编译；代码已经按 Spring Boot 3 / Java 21 组织
