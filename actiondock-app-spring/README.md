# actiondock-app-spring

Spring Boot Web 入口模块，负责把脚本平台和 AI 工作台以 REST API 与管理台页面的形式对外暴露。

## 提供什么

- REST API
- 管理台静态资源挂载
- Spring MVC / Validation / Actuator / OpenAPI
- 与 `actiondock-app-support`、`actiondock-storage-jpa` 的整合启动

## 启动方式

```bash
mvn -pl actiondock-app-spring -am spring-boot:run
```

生产打包：

```bash
mvn -pl actiondock-app-spring -am package
java -jar target/actiondock-app-spring.jar
```

## npm / jDeploy 分发

对外发布名为 `actiondock-server`，推荐安装方式：

```bash
npm i -g actiondock-server
actiondock-server
```

手动升级：

```bash
npm i -g actiondock-server@latest
```

启动后会低频检查 npm 上是否有新版本，并在日志里输出升级提示。可用 `ACTIONDOCK_NO_UPDATE_NOTIFIER=1` 关闭提醒。

## 前后端开发

```bash
# 后端
mvn -pl actiondock-app-spring -am spring-boot:run

# 前端
cd ../actiondock-admin-ui
npm install
npm run dev
```

- 前端开发地址：`http://localhost:5173/admin/scripts`
- 后端管理台地址：`http://localhost:8080/admin/scripts`

## API 分组

| 路径前缀 | 说明 |
|----------|------|
| `/api/scripts` | 脚本管理、发布、Fork、开发同步 |
| `/api/executions` | 脚本执行与执行记录 |
| `/api/plugins` | 插件管理、配置与动作调用 |
| `/api/repositories` | 仓库、仓库工具和仓库插件管理 |
| `/api/schedules` | 全局定时任务管理 |
| `/api/scripts/{scriptId}/schedules` | 脚本级定时任务管理 |
| `/api/config-values` | 全局配置值管理 |
| `/api/access-tokens` | 访问令牌管理 |
| `/api/ai` | 模型、Agent、Toolset、AI Tool、Agent Run 和调用日志 |
| `/api/ai/workbench` | 脚本生成、改进、诊断、评审等工作台能力 |
| `/api/schema` | 脚本输入/输出 Schema 摘要 |
| `/api/installed-tools` | 已安装仓库工具卸载入口 |

## 管理台与静态资源

- `/admin/*`：管理台入口
- 打包时会自动构建 `actiondock-admin-ui` 并复制到 jar 静态资源目录

## 使用提示

- `PYTHON` 脚本要求宿主机存在 `python3`
- Groovy 脚本可以通过系统插件 `actiondock-ai` 使用 AI 能力
- 若系统存在访问令牌，则 `/api/*` 需要 `Authorization: Bearer <token>`

## 相关模块

- UI 见 [../actiondock-admin-ui/README.md](../actiondock-admin-ui/README.md)
- 运行时装配见 [../actiondock-app-support/README.md](../actiondock-app-support/README.md)
