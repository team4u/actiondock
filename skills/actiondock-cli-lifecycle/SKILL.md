---
name: actiondock-cli-lifecycle
description: 使用 ActionDock CLI 完成脚本的完整作者态闭环：创建草稿、Patch 源码或 Schema、校验、草稿调试、查看执行结果、循环修复并最终发布。适用于 Codex 需要通过 CLI 而不是直接调 REST API 来稳定创建和调试 ActionDock 脚本的场景。
---

# ActionDock CLI Lifecycle

当用户希望你“用 CLI”创建、调试、修复并发布 ActionDock 脚本时，使用这个 skill。

这个 skill 关注的是 **如何用 CLI 跑完整链路**，不是如何凭空设计业务逻辑本身。

在这个 skill 里，默认公共术语只有 `script`。

- 不要再使用 `actiondock tool ...`
- 创建、查看、执行、调试、发布都统一走 `actiondock script ...`
- 如果用户把 “tool” 和 “script” 混着说，按“它们在这里是同一个脚本资产”来处理

如果用户只给了业务需求、还没有脚本内容，先产出以下内容，再进入 CLI 闭环：

1. 脚本 ID
2. 脚本名称
3. Groovy/Python 源码
4. `inputSchema`
5. `outputSchema`

必要时可结合仓库里的 `generate-script` skill 先生成这些内容。

## 关键原则

- 默认使用 `--json`，让输出稳定可机读。
- 调试草稿时，默认使用 `actiondock script run <id> --draft --response-view debug --json`。
- 调试更新时，默认使用 `actiondock script patch`，不要用整对象覆盖思路。
- 当前 patch 只允许更新：
  - `source`
  - `inputSchema`
  - `outputSchema`
- 执行失败后，先读失败结果，再改草稿；不要盲改。
- 发布是显式动作；只有确认草稿可用后才执行 `script publish`。

## 标准闭环

### 1. 创建草稿

优先使用文件输入，避免 shell 转义问题。

```bash
actiondock script create \
  --script-id hello-world \
  --name "Hello World" \
  --type groovy \
  --source-file ./hello-world.groovy \
  --input-schema-file ./input.schema.json \
  --output-schema-file ./output.schema.json \
  --json
```

如果源码或 schema 很短，也可以内联，但文件方式更稳定。

### 2. 校验草稿

```bash
actiondock script validate hello-world --json
```

如果这里失败，先修源码或 schema，再继续执行。

### 3. 执行草稿

```bash
actiondock script run hello-world \
  --draft \
  --input-json '{"name":"alice"}' \
  --response-view debug \
  --json
```

关注这些字段：

- `status`
- `errorMessage`
- `errorDetail`
- `logs`
- `debug.input`
- `debug.rawOutput`

如果返回里已经有足够信息，直接修；如果只拿到了执行 ID，继续查详情。

### 4. 读取执行详情

```bash
actiondock execution get <execution-id> --json
```

优先从这些信息判断问题：

- 输入是否符合 `inputSchema`
- `logs` 是否暴露了关键分支
- `errorMessage` / `errorDetail.stackTrace`
- 输出结构是否和 `outputSchema` 匹配

### 5. Patch 草稿

只改源码：

```bash
actiondock script patch hello-world \
  --source-file ./hello-world.v2.groovy \
  --json
```

只改 schema：

```bash
actiondock script patch hello-world \
  --input-schema-file ./input.schema.json \
  --json
```

直接传 merge patch：

```bash
actiondock script patch hello-world \
  --patch-json '{"inputSchema":{"properties":{"enabled":{"type":"boolean"}}}}' \
  --json
```

如果同时改源码和 schema，可以在一个命令里组合：

```bash
actiondock script patch hello-world \
  --source-file ./hello-world.v3.groovy \
  --output-schema-file ./output.schema.json \
  --json
```

### 6. 循环直到成功

重复以下步骤：

1. `script patch`
2. `script validate`
3. `script run --draft --response-view debug --json`
4. 必要时 `execution get`

直到：

- 执行 `status` 为成功
- 输出字段与 `outputSchema` 一致
- 日志和 debug 信息显示逻辑正确

### 7. 发布

```bash
actiondock script publish hello-world --json
```

发布后如果需要确认已发布版本，可读取：

```bash
actiondock script get hello-world --json
```

## 失败处理策略

### 输入校验失败

症状：

- 命令直接返回 `400`
- 错误体里有字段级校验信息

动作：

- 先修运行输入
- 或修 `inputSchema`
- 不要先改业务逻辑源码

### 运行时异常

症状：

- `status=FAILED`
- 有 `errorMessage`
- `errorDetail.stackTrace` 非空

动作：

- 优先修源码
- 如果是返回结构不匹配，再同步修 `outputSchema`

### 输出结构不符合预期

症状：

- 业务逻辑看似成功，但输出字段缺失、类型错误或命名不一致

动作：

- 比对 `debug.rawOutput` 与 `outputSchema`
- 明确是“代码返回错了”还是“schema 定义错了”
- 只 patch 必需字段，避免同时引入无关改动

## 推荐工作方式

- 对较长源码，先在工作区生成 `.groovy` / `.py` 文件，再用 `--source-file`。
- 对 schema，先写成 `.json` 文件，再用 `--input-schema-file` / `--output-schema-file`。
- 每轮 patch 尽量只改一个问题，减少调试噪音。
- 如果执行结果不清楚，优先加日志再跑一轮，而不是猜。

## 不要这样做

- 不要默认走非 `--json` 输出。
- 不要把 `script patch` 当成任意字段 patch；只允许源码和 schema。
- 不要在未验证草稿前直接发布。
- 不要在一次 patch 里混入大量无关重构，除非当前问题必须一起改。

## 最小模板

如果用户明确要“用 CLI 从零做一个脚本”，默认按这个顺序执行：

```bash
actiondock script create --script-id <id> --name "<name>" --type groovy --source-file ./source.groovy --input-schema-file ./input.schema.json --output-schema-file ./output.schema.json --json
actiondock script validate <id> --json
actiondock script run <id> --draft --input-json '<input-json>' --response-view debug --json
actiondock execution get <execution-id> --json
actiondock script patch <id> --source-file ./source.v2.groovy --json
actiondock script validate <id> --json
actiondock script run <id> --draft --input-json '<input-json>' --response-view debug --json
actiondock script publish <id> --json
```

在真正执行前，先根据用户需求把 `<id>`、源码文件、schema 文件和测试输入准备好。
