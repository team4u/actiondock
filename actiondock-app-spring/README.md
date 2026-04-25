# actiondock-app-spring

这个模块是 Web 启动入口：

- Web 模式：Spring MVC + 管理台
- 当前管理台支持创建和编辑 `GROOVY` / `PYTHON` 两类脚本

示例：

```bash
mvn -pl actiondock-app-spring -am spring-boot:run
```

该命令会只启动 `actiondock-app-spring`。

如果会执行 `PYTHON` 类型脚本，请先确认宿主机上存在 `python3`，并且脚本依赖的第三方包已经预装。

开发阶段建议前后端分开启动：

```bash
# 后端
mvn -pl actiondock-app-spring -am spring-boot:run

# 前端
cd ../actiondock-admin-ui
npm install
npm run dev
```

前端开发地址：

- `http://localhost:5173/admin/scripts`

如果需要把前端静态资源一起打进 jar，也可以：

```bash
mvn -pl actiondock-app-spring -am package
java -jar target/actiondock-app-spring.jar
```

如果要配合官方 REST CLI 使用，可以在仓库根目录额外构建：

```bash
mvn -pl actiondock-cli -am package
java -jar ../actiondock-cli/target/actiondock-cli.jar \
  --base-url http://localhost:8080 \
  --token local-dev-key \
  scripts list
```

常用运行配置：

```yaml
app:
  home-dir: ${user.home}/.actiondock
  auth:
    api-keys:
      - local-dev-key
  execution:
    async-pool-size: 4
    groovy:
      enabled: true
      cache-max-size: 128
      cache-expire-after-access-minutes: 30
    python:
      executable: python3
      timeout-seconds: 30
```

默认运行时目录：

- 数据库：`~/.actiondock/data/dsl-runtime*`
- 插件：`~/.actiondock/plugins`
- 仓库缓存：`~/.actiondock/repositories`
