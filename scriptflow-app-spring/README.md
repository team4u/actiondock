# scriptflow-app-spring

这个模块是最终启动入口：

- Web 模式：Spring MVC
- CLI 模式：同一个应用上下文，切到 `cli` 参数执行 picocli，只保留脚本相关命令

示例：

```bash
mvn -pl scriptflow-app-spring -am spring-boot:run
java -jar target/scriptflow-app-spring.jar cli script list
```

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

如果本地曾运行过包含 page 能力的旧版本，开发阶段请删除 `../data/dsl-runtime*` 后再重新启动，避免旧 H2 文件残留未使用的 page 表。
