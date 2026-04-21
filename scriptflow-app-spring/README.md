# scriptflow-app-spring

这个模块是最终启动入口：

- Web 模式：Spring MVC
- CLI 模式：同一个应用上下文，切到 `cli` 参数执行 picocli

示例：

```bash
mvn -pl scriptflow-app-spring -am spring-boot:run
java -jar target/scriptflow-app-spring.jar cli script list
```
