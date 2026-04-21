# scriptflow-app-cli

这个模块是独立的 CLI 启动入口：

- 命令模式：picocli
- 从同一个工作目录启动时，可与 Web 共享默认 H2 文件库 `./data/dsl-runtime`
- `script list` 输出会包含脚本类型，便于区分 `GROOVY` / `PYTHON`

示例：

```bash
mvn -pl scriptflow-app-cli -am package
java -jar target/scriptflow-app-cli.jar script list
java -jar target/scriptflow-app-cli.jar script show --id hello-groovy
java -jar target/scriptflow-app-cli.jar run --id hello-groovy --input '{"name":"Alice"}'
```

执行 `PYTHON` 类型脚本前，请确认当前机器可直接运行 `python3`；如需改用其他解释器，可通过 `app.execution.python.executable` 配置。

如果 CLI 与 Web 需要读写同一批脚本和执行记录，请从同一个工作目录启动两个 jar，以继续共用默认 H2 文件库。
