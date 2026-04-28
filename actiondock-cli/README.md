# actiondock-cli

ActionDock 的独立 CLI 子项目。它把现有 REST API 包装成更适合终端和 AI 使用的扁平命令参数。

## 安装依赖

```bash
npm install
```

## 本地开发

```bash
npm run dev -- tool list
```

## 构建

```bash
npm run build
node ./bin/run.js tool list
```

## 配置

```bash
actiondock config set server http://localhost:8080
actiondock config set token your-token
actiondock config show
```

也支持：

- `ACTIONDOCK_BASE_URL`
- `ACTIONDOCK_TOKEN`

默认服务地址是 `http://127.0.0.1:8080`。

优先级：命令参数 > 环境变量 > 本地配置 > 默认地址。

## 命令

```bash
actiondock tool list
actiondock tool get hello-world --json
actiondock tool schema hello-world
actiondock tool run hello-world --name Alice --count 3 --json
actiondock tool run hello-world --input-json '{"name":"Alice","payload":{"x":1}}' --json
actiondock execution get exec-1 --json
actiondock execution list --script-id hello-world --json
actiondock plugin invoke my-plugin hello --name World --json
actiondock plugin invoke my-plugin summarize --topic ops --script-input-json '{"locale":"zh-CN"}' --json
actiondock plugin install ./target/my-plugin-1.0.0.jar --json
actiondock plugin list --json
actiondock plugin get my-plugin --json
actiondock plugin references --json
actiondock plugin config get my-plugin --json
actiondock state namespaces --json
actiondock state list oauth.github --json
actiondock state get oauth.github access-token --json
actiondock state put oauth.github access-token --value-json '{"accessToken":"gho_xxx"}' --secret --json
actiondock state cas cursor.sync users --expected-version 3 --value-json '{"cursor":"next-page-token"}' --json
actiondock state delete oauth.github access-token --json
actiondock state purge-expired oauth.github --json
```

默认执行已发布版本。传 `--draft` 可切换到草稿。

`tool run` 和 `plugin invoke` 会优先把顶层字符串 / 数字 / 布尔字段展开成 `--name value` 形式；对象和数组字段则保留为 `--input-json`、`--args-json`、`--script-input-json`。

## 自动补全

依赖 `@oclif/plugin-autocomplete`，安装后可执行：

```bash
actiondock autocomplete
```

按提示为当前 shell 安装静态补全。对你这个场景来说，这部分比较容易落地，因为命令框架本身已经带了补全插件，新增子命令和 flag 会自动进入补全体系。
