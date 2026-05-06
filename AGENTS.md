# Agent Notes

- This repo is a multi-module Maven project. When compiling or testing a submodule, prefer `-am` so dependent modules are built too.
- Recommended patterns:
  - `mvn -pl actiondock-app-spring -am -DskipTests compile`
  - `mvn -pl actiondock-app-spring -am -Dtest=ScriptControllerTest test`
- Avoid validating `actiondock-app-spring` with `-pl` alone unless you explicitly want to ignore dependency-module compilation.
- 前端或后端有修改时，结束任务前必须执行对应的编译检查（前端：`cd actiondock-admin-ui && npx tsc --noEmit && npm run build` / 后端：`mvn test`），有测试则一起运行。
