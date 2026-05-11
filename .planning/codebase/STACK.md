# Technology Stack

**Analysis Date:** 2026-05-11

## Languages

**Primary:**
- Java 21 - Backend runtime, application services, domain model, JPA storage, web controllers, plugin system
- TypeScript 5.x - Admin UI (React SPA), CLI tool (Oclif)

**Secondary:**
- Groovy 4.0.24 - Runtime script execution engine (user-defined scripts executed at runtime)
- Python 3 - Runtime script execution engine (subprocess-based, user-defined scripts)
- SQL - Flyway database migrations (H2 SQL dialect)

## Runtime

**Backend:**
- Java 21 (required by `java.version` property in `pom.xml`)
- Spring Boot 3.3.5

**Frontend (Admin UI):**
- Node.js >= 18 (required by `engines` in `actiondock-cli/package.json`; admin UI uses same Node toolchain)

**CLI:**
- Node.js >= 18

**Package Manager:**
- Maven (backend) - Lockfile: present (implicit via Maven local repo)
- npm (frontend/CLI) - Lockfile: `package-lock.json` present in both `actiondock-admin-ui/` and `actiondock-cli/`

## Frameworks

**Core Backend:**
- Spring Boot 3.3.5 - Application framework, auto-configuration, embedded server
- Spring Data JPA - ORM and repository abstraction
- Spring Boot Validation (Jakarta) - Request validation
- Spring Boot Actuator - Health endpoints (`/actuator/health`)

**AI Integration:**
- AgentScope 1.0.11 (`io.agentscope:agentscope`) - Multi-provider AI model client (OpenAI, Anthropic, Gemini, DashScope, Ollama)

**Plugin System:**
- PF4J 3.13.0 (`org.pf4j:pf4j`) - Java plugin framework with extension annotations

**Frontend (Admin UI):**
- React 18 - UI framework
- Ant Design 5.27 (`antd`) - Component library
- React Router DOM 6.30 - SPA routing
- TanStack React Query 5.100 - Server state management and data fetching
- Monaco Editor (`@monaco-editor/react`) - Code/script editor
- Vite 5.4 - Build tool and dev server

**CLI:**
- Oclif 4 (`@oclif/core`) - CLI framework with command framework, autocomplete, update notifications

**Scripting (Runtime):**
- Apache Groovy 4.0.24 (all modules) - Groovy script engine
- Apache Ivy 2.5.2 - Groovy dependency resolution at runtime

**Build/Dev:**
- Maven - Backend build, dependency management, multi-module orchestration
- Vite 5.4 - Frontend bundling
- TypeScript 5.6/5.9 - Type checking (admin UI uses 5.6, CLI uses 5.9)
- jdeploy 6.1 - Desktop app packaging (wraps Spring Boot JAR as native desktop app)

## Key Dependencies

**Critical:**
- `hutool-all` 5.8.36 (`cn.hutool`) - General-purpose Java utility library used throughout core
- `jackson-databind` - JSON serialization/deserialization (Spring Boot managed version + explicit 2.21 for annotations)
- `json-path` 2.9.0 (`com.jayway.jsonpath`) - JSONPath queries for event processing
- `mustache-java` 0.9.14 (`com.github.spullara.mustache.java`) - Template rendering for processors

**Database:**
- H2 Database (runtime scope) - Embedded file-based database
- Flyway Core - Database schema migration

**API Documentation:**
- springdoc-openapi 2.6.0 (`springdoc-openapi-starter-webmvc-ui`) - Swagger/OpenAPI UI at `/swagger-ui.html`

**Infrastructure:**
- `spring-boot-starter-web` - Embedded Tomcat servlet container
- `spring-boot-starter-actuator` - Health and info endpoints

**Frontend Utilities:**
- `diff` 7.0 - Text diff computation
- `jszip` 3.10 - ZIP file creation/extraction
- `papaparse` 5.5 - CSV parsing
- `react-markdown` 10.1 + `remark-gfm` 4.0 - Markdown rendering
- `dayjs` 1.11 - Date formatting

**CLI Utilities:**
- `node-fetch` 2.6.7 - HTTP client (Node.js)
- `shelljs` 0.10 - Shell command execution
- `tar` 7.5 / `yauzl` 2.10 - Archive extraction

## Configuration

**Environment:**
- Configuration via `application.yml` with `spring.config.import` for shared runtime config
- Runtime config: `actiondock-app-support/src/main/resources/runtime-common.yml`
- App config: `actiondock-app-spring/src/main/resources/application.yml`
- App properties bound to `AppProperties` class with `@ConfigurationProperties(prefix = "app")`

**Key configs (from `runtime-common.yml`):**
- `app.home-dir`: Default `${user.home}/.actiondock` - Base directory for all local data
- `app.plugins.dir`: Default `${app.home-dir}/plugins` - Plugin JAR storage
- `app.repositories.auto-sync-enabled`: Enable/disable periodic git repository sync (default: true)
- `app.repositories.auto-sync-interval-seconds`: Sync interval (default: 1800)
- `app.execution.async-pool-size`: Async execution thread pool size (default: 4)
- `app.execution.groovy.cache-max-size`: Groovy script cache size (default: 128)
- `app.execution.python.executable`: Python interpreter (default: python3)
- `app.execution.python.timeout-seconds`: Python script timeout (default: 30)
- `app.schedules.pool-size`: Scheduled task thread pool size (default: 2)
- `server.port`: 5177 (bound to 127.0.0.1)

**Build config files:**
- `pom.xml` (root) - Multi-module Maven parent POM
- `vite.config.ts` - Frontend Vite configuration (base path `/admin/`, proxy `/api` to backend)
- `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` - TypeScript project references
- `tsconfig.json` (CLI) - CLI TypeScript configuration (ES2022, NodeNext modules)

## Platform Requirements

**Development:**
- JDK 21 (mandatory - configured in `pom.xml` and `jdeploy` config)
- Node.js >= 18
- npm
- Python 3 (optional, for Python script engine)
- Git (required for repository sync/clone/push operations)

**Production:**
- JDK 21 runtime
- Local filesystem for H2 database (`${user.home}/.actiondock/data/actiondock`)
- Local filesystem for plugins (`${user.home}/.actiondock/plugins`)
- Local filesystem for Python virtual environments (`${user.home}/.actiondock/python-envs`)
- Desktop deployment via jdeploy (wraps JAR as macOS/Windows/Linux desktop app)

---

*Stack analysis: 2026-05-11*
