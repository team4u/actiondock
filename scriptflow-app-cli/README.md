# scriptflow-app-cli

这个模块是独立的 CLI 启动入口：

- 命令模式：picocli
- 从同一个工作目录启动时，可与 Web 共享默认 H2 文件库 `./data/dsl-runtime`

示例：

```bash
mvn -pl scriptflow-app-cli -am package
java -jar target/scriptflow-app-cli.jar script list
java -jar target/scriptflow-app-cli.jar script show --id hello-groovy
java -jar target/scriptflow-app-cli.jar run --id hello-groovy --input '{"name":"Alice"}'
```
