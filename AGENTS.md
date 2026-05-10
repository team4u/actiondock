# Agent Notes

- This repo is a multi-module Maven project. When compiling or testing a submodule, prefer `-am` so dependent modules are built too.
- Recommended patterns:
  - `mvn -pl actiondock-app-spring -am -DskipTests compile`
  - `mvn -pl actiondock-app-spring -am -Dtest=ScriptControllerTest test`
- Avoid validating `actiondock-app-spring` with `-pl` alone unless you explicitly want to ignore dependency-module compilation.
- Flyway migration rules:
  - 已存在的迁移文件只可视为历史记录，禁止修改内容，尤其不能改 `V1__...` 这类已落库版本；否则会触发 checksum mismatch。
  - 新的数据库结构变更只能追加新的迁移版本，禁止复用已有版本号。
  - 迁移版本历史以 `git` 为准；不要为了兼容某个数据库状态，补写一个 `git` 历史里从未存在过的旧版本迁移文件。
  - 如果数据库里已经执行过某个版本（例如 `V9`），源码里也必须保留对应迁移文件；不要通过删除旧迁移文件来“整理历史”。
  - 处理历史库兼容时，优先新增补丁迁移；如果数据库状态已经偏离 `git` 历史，先修正数据库的 `flyway_schema_history`，不要默认在源码里伪造迁移或直接用 `repair` 掩盖问题。
- 前端或后端有修改时，结束任务前必须执行对应的编译检查（前端：`cd actiondock-admin-ui && npx tsc --noEmit && npm run build` / 后端：`mvn test`），有测试则一起运行。
