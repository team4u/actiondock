# Agent Notes

- This repo is a multi-module Maven project. When compiling or testing a submodule, prefer `-am` so dependent modules are built too.
- Recommended patterns:
  - `mvn -pl actiondock-app-spring -am -DskipTests compile`
  - `mvn -pl actiondock-app-spring -am -Dtest=ScriptControllerTest test`
- Avoid validating `actiondock-app-spring` with `-pl` alone unless you explicitly want to ignore dependency-module compilation.
