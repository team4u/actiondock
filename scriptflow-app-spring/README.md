# scriptflow-app-spring

这个模块是 Web 启动入口：

- Web 模式：Spring MVC + 管理台
- 当前管理台支持创建和编辑 `GROOVY` / `PYTHON` 两类脚本

示例：

```bash
mvn -pl scriptflow-app-spring -am spring-boot:run
```

该命令会只启动 `scriptflow-app-spring`；CLI 模块默认不会参与 reactor 下的 `spring-boot:run`。

如果会执行 `PYTHON` 类型脚本，请先确认宿主机上存在 `python3`，并且脚本依赖的第三方包已经预装。

开发阶段建议前后端分开启动：

```bash
# 后端
mvn -pl scriptflow-app-spring -am spring-boot:run

# 前端
cd ../scriptflow-admin-ui
npm install
npm run dev
```

前端开发地址：

- `http://localhost:5173/admin/scripts`

如果需要把前端静态资源一起打进 jar，也可以：

```bash
mvn -pl scriptflow-app-spring -am package
java -jar target/scriptflow-app-spring.jar
```

常用运行配置：

```yaml
app:
  auth:
    api-keys:
      - local-dev-key
  execution:
    async-pool-size: 4
    python:
      executable: python3
      timeout-seconds: 30
```

如果本地曾运行过包含 page 能力的旧版本，开发阶段请删除 `../data/dsl-runtime*` 后再重新启动，避免旧 H2 文件残留未使用的 page 表。

CLI 已拆分为独立模块，请改用：

```bash
mvn -pl scriptflow-app-cli -am package
java -jar ../scriptflow-app-cli/target/scriptflow-app-cli.jar script list
```

如果希望 CLI 与 Web 继续共用默认 H2 文件库，请从同一个工作目录启动两个 jar。
