# 通用 CLI 约定

所有 ActionDock CLI 场景先遵守本文件，再按意图读取专项参考文档。

## 输出与连接

- 默认使用 `--json`，让输出稳定可机读。
- 可能很长的 JSON 默认写入文件再读取：`--json --output-file /tmp/actiondock-result.json --overwrite-output`。常见场景包括 `script run --response-view debug`、`execution get`、`plugin invoke`、`playbook get`、`repository resolve` 和项目知识浏览结果。
- 默认连接本机服务 `http://127.0.0.1:5177`；本地使用不要要求用户先配置连接。
- 只有连接其他 Server、保存 Token 或频繁切换多个 Server 时，才使用 `actiondock config add/use/list` 管理 profile；临时切换用 `--profile <name>`。
- 连接解析优先级：`--server` / `--token` > `--profile` > `ACTIONDOCK_BASE_URL` / `ACTIONDOCK_TOKEN` > `ACTIONDOCK_PROFILE` > 当前 profile > 默认本机服务。

Profile 管理命令：

```bash
actiondock config add <name> --server <url> [--token <token>]
actiondock config use <name>
actiondock config list
actiondock config show [--profile <name>]
actiondock config set server <url> [--profile <name>]
actiondock config set token <token> [--profile <name>]
actiondock config clear token [--profile <name>]
actiondock config remove <name>
```

## 查找与 schema

- 业务资产类 list 命令优先用 `--intent <regex>` 收窄候选，例如 `script list`、`plugin list`、`repository list`、`repository:knowledge-list`、`playbook list`、`schedule list`、`script preset list`、`config-value list` 以及仓库资产的 `repository-list`。
- `--intent` 未命中时 CLI 会自动退回同一过滤条件下的全量列表，输出结构不变。
- 不要把整段自然语言原样传给 `--intent`；提炼领域名词、动作、状态和中英文关键词，用 `|` 连接。
- 第一次执行已发布脚本前，通过 `script schema <id>` 获取入参，避免用 `get` 查看脚本细节。
- 解释脚本或插件 action 的 `inputSchema` 时，直接说明哪些顶层简单字段可扁平为 CLI flag，哪些对象/数组字段必须使用 JSON 或文件方式。

## 参数传递

- 顶层 string / number / integer / boolean / enum 字段优先用动态 flag。
- 对象、数组或较长 JSON 不要拆成多级 flag，使用文件方式优先。
- 脚本输入使用 `--input-json` / `--input-file`；插件 action 参数使用 `--args-json` / `--args-file`；插件脚本上下文使用 `--script-input-json` / `--script-input-file`。
- 混合 schema 只需说明“简单字段可扁平、复杂字段走 JSON”；示例保持 1 条主路径命令。
- `--server`、`--token`、`--profile` 是连接参数保留字，不会作为动态输入字段传入；业务字段同名时改用 JSON 或文件传参。

## 关键边界

- 业务项目、流程、接口、数据库、日志、告警和排障类问题默认先走 Playbook。
- 进入项目知识、项目文档、源码搜索、`ACTIONDOCK.md` 或知识引用前，必须实际读取 `references/project-knowledge.md`。
- 项目仓库解析、同步、`actiondock-workspace` 使用、定向搜索、源码确认和禁搜目录规则，都以 `project-knowledge.md` 为准。
