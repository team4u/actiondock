# scriptflow-cli

这是 ScriptFlow 的官方薄封装 CLI：

- 只调用现有 Web API
- 不嵌入脚本运行时
- 默认输出 JSON envelope
- 支持 flag、环境变量和本地 profile 组合管理连接配置

构建：

```bash
mvn -pl scriptflow-cli -am package
```

示例：

```bash
java -jar target/scriptflow-cli-0.2.0.jar config current

java -jar target/scriptflow-cli-0.2.0.jar \
  --base-url http://localhost:8080 \
  --token local-dev-key \
  scripts list

java -jar target/scriptflow-cli-0.2.0.jar executions submit \
  --script-id hello-groovy \
  --input '{"name":"Alice"}' \
  --wait
```
