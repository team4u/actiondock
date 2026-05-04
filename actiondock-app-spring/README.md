# actiondock-app-spring

Internal Spring Boot runtime module for ActionDock.

This module is no longer published as an npm package. The public npm package is
`actiondock`, sourced from `actiondock-cli/`, and it embeds this module's built
jar at:

```text
actiondock-cli/runtime/actiondock-app-spring.jar
```

## Development

Build the runtime jar directly when working on Java code:

```bash
mvn -pl actiondock-app-spring -am package -DskipTests -f ../pom.xml
```

Build the final npm package runtime from `actiondock-cli/`:

```bash
cd ../actiondock-cli
npm run build:runtime
```

The Maven package phase builds `actiondock-admin-ui` and copies the frontend
assets into `static/admin` inside the jar.

## Packaging And Publishing

Do not package or publish this directory directly.

Use the unified npm package directory instead:

```bash
cd ../actiondock-cli
npm ci
npm run prepack
npm run pack:dry-run
npm publish --access public --ignore-scripts
```

The unified package build copies this module's jar into:

```text
actiondock-cli/runtime/actiondock-app-spring.jar
```

For GitHub/jDeploy desktop installers, create a release or push a `v*` tag from
the repository root. The workflow builds from `actiondock-cli/`.

## Public Entry Points

End users should install and run:

```bash
npm install -g actiondock
actiondock desktop
actiondock server
actiondock service status
```

This module has no standalone public npm package or user command.
