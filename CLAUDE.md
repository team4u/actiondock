@AGENTS.md

<!-- GSD:project-start source:PROJECT.md -->
## Project

**ActionDock Workspace Plugin**

ActionDock 的内置工作区系统插件，为 Agent 脚本提供文件系统操作和 Shell 命令执行能力。插件实现 `ActionDockPlugin` 接口，以系统插件形式通过 Spring Bean 注册，确保始终可用。

**Core Value:** Agent 脚本能够在受控的安全沙箱内完成文件读写、目录浏览和 Shell 命令执行 — 这是构建自动化工作流的基础工具集。

### Constraints

- 必须使用 `actiondock-plugin-api` 的 `ActionDockPlugin` 接口
- 系统插件不需要 `@Extension` 注解
- 插件 manifest 放在 `META-INF/actiondock/plugins/` 下
- Java 21，Spring Boot 3.3.5
- 文件路径安全校验必须防止 `..` 路径穿越
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- Java 21 - Backend runtime, application services, domain model, JPA storage, web controllers, plugin system
- TypeScript 5.x - Admin UI (React SPA), CLI tool (Oclif)
- Groovy 4.0.24 - Runtime script execution engine (user-defined scripts executed at runtime)
- Python 3 - Runtime script execution engine (subprocess-based, user-defined scripts)
- SQL - Flyway database migrations (H2 SQL dialect)
## Runtime
- Java 21 (required by `java.version` property in `pom.xml`)
- Spring Boot 3.3.5
- Node.js >= 18 (required by `engines` in `actiondock-cli/package.json`; admin UI uses same Node toolchain)
- Node.js >= 18
- Maven (backend) - Lockfile: present (implicit via Maven local repo)
- npm (frontend/CLI) - Lockfile: `package-lock.json` present in both `actiondock-admin-ui/` and `actiondock-cli/`
## Frameworks
- Spring Boot 3.3.5 - Application framework, auto-configuration, embedded server
- Spring Data JPA - ORM and repository abstraction
- Spring Boot Validation (Jakarta) - Request validation
- Spring Boot Actuator - Health endpoints (`/actuator/health`)
- AgentScope 1.0.11 (`io.agentscope:agentscope`) - Multi-provider AI model client (OpenAI, Anthropic, Gemini, DashScope, Ollama)
- PF4J 3.13.0 (`org.pf4j:pf4j`) - Java plugin framework with extension annotations
- React 18 - UI framework
- Ant Design 5.27 (`antd`) - Component library
- React Router DOM 6.30 - SPA routing
- TanStack React Query 5.100 - Server state management and data fetching
- Monaco Editor (`@monaco-editor/react`) - Code/script editor
- Vite 5.4 - Build tool and dev server
- Oclif 4 (`@oclif/core`) - CLI framework with command framework, autocomplete, update notifications
- Apache Groovy 4.0.24 (all modules) - Groovy script engine
- Apache Ivy 2.5.2 - Groovy dependency resolution at runtime
- Maven - Backend build, dependency management, multi-module orchestration
- Vite 5.4 - Frontend bundling
- TypeScript 5.6/5.9 - Type checking (admin UI uses 5.6, CLI uses 5.9)
- jdeploy 6.1 - Desktop app packaging (wraps Spring Boot JAR as native desktop app)
## Key Dependencies
- `hutool-all` 5.8.36 (`cn.hutool`) - General-purpose Java utility library used throughout core
- `jackson-databind` - JSON serialization/deserialization (Spring Boot managed version + explicit 2.21 for annotations)
- `json-path` 2.9.0 (`com.jayway.jsonpath`) - JSONPath queries for event processing
- `mustache-java` 0.9.14 (`com.github.spullara.mustache.java`) - Template rendering for processors
- H2 Database (runtime scope) - Embedded file-based database
- Flyway Core - Database schema migration
- springdoc-openapi 2.6.0 (`springdoc-openapi-starter-webmvc-ui`) - Swagger/OpenAPI UI at `/swagger-ui.html`
- `spring-boot-starter-web` - Embedded Tomcat servlet container
- `spring-boot-starter-actuator` - Health and info endpoints
- `diff` 7.0 - Text diff computation
- `jszip` 3.10 - ZIP file creation/extraction
- `papaparse` 5.5 - CSV parsing
- `react-markdown` 10.1 + `remark-gfm` 4.0 - Markdown rendering
- `dayjs` 1.11 - Date formatting
- `node-fetch` 2.6.7 - HTTP client (Node.js)
- `shelljs` 0.10 - Shell command execution
- `tar` 7.5 / `yauzl` 2.10 - Archive extraction
## Configuration
- Configuration via `application.yml` with `spring.config.import` for shared runtime config
- Runtime config: `actiondock-app-support/src/main/resources/runtime-common.yml`
- App config: `actiondock-app-spring/src/main/resources/application.yml`
- App properties bound to `AppProperties` class with `@ConfigurationProperties(prefix = "app")`
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
- `pom.xml` (root) - Multi-module Maven parent POM
- `vite.config.ts` - Frontend Vite configuration (base path `/admin/`, proxy `/api` to backend)
- `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` - TypeScript project references
- `tsconfig.json` (CLI) - CLI TypeScript configuration (ES2022, NodeNext modules)
## Platform Requirements
- JDK 21 (mandatory - configured in `pom.xml` and `jdeploy` config)
- Node.js >= 18
- npm
- Python 3 (optional, for Python script engine)
- Git (required for repository sync/clone/push operations)
- JDK 21 runtime
- Local filesystem for H2 database (`${user.home}/.actiondock/data/actiondock`)
- Local filesystem for plugins (`${user.home}/.actiondock/plugins`)
- Local filesystem for Python virtual environments (`${user.home}/.actiondock/python-envs`)
- Desktop deployment via jdeploy (wraps JAR as macOS/Windows/Linux desktop app)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Overview
## Java Backend Conventions
### Naming Patterns
- Domain model: `PascalCase.java` matching the class name -- `ScriptDefinition.java`, `ExecutionRecord.java`
- Application service: `PascalCaseApplicationService.java` -- `ScriptApplicationService.java`
- Controller: `PascalCaseController.java` -- `ScriptController.java`
- JPA entity: `PascalCaseEntity.java` -- `ScriptEntity.java`
- JPA adapter: `Jpa` + entity short name + `RepositoryAdapter.java` -- `JpaScriptRepositoryAdapter.java`
- Spring Data repo: `SpringData` + entity short name + `Repository.java` -- `SpringDataScriptEntityRepository.java`
- Configuration: `PascalCaseConfiguration.java` -- `RuntimeConfiguration.java`
- Request DTO: `PascalCaseRequest.java` -- `ExecuteRequest.java`
- View/response DTO: `PascalCaseView.java` -- `AccessTokenView.java`
- Mapper: `PascalCaseViewMapper.java` or `PascalCaseMapper.java` -- `ScriptViewMapper.java`
- Custom exception: `PascalCaseException.java` -- `UpstreamConflictException.java`
- Utility class: `PascalCaseSupport.java` or `PascalCaseUtils.java` -- `ApplicationServiceSupport.java`, `NormalizeUtils.java`
- Base package: `org.team4u.actiondock`
- Domain models: `domain.model`
- Domain ports (interfaces): `domain.port`
- Domain exceptions: `domain.exception`
- Application services: `application`
- Web controllers: `web.<feature>` (e.g., `web.script`, `web.execution`, `web.ai`)
- JPA entities: `storage.jpa.entity`
- JPA adapters: `storage.jpa.adapter`
- Spring Data repos: `storage.jpa.repo`
- Infrastructure support: organized by feature (e.g., `config`, `script`, `plugin`, `repository`, `skill`)
- camelCase for all methods
- Getter/setter pattern: standard `getX()` / `setX()` for entities, fluent builder `setX()` returning `this` for domain models
- camelCase -- `scriptId`, `submitMode`, `cronExpression`
- PascalCase enum with UPPER_SNAKE_CASE values -- `ExecutionStatus.PENDING`, `ScriptType.GROOVY`
### Code Style
- No explicit checkstyle/checker configuration detected
- Standard Java formatting: 4-space indentation (inferred from source)
- No trailing whitespace, standard braces
- No PMD, SpotBugs, or ErrorProne configuration detected in POM
### Import Organization
### Domain Model Pattern (Fluent Setters)
- Setters return `this` (the domain object type) for chaining
- Collections returned as unmodifiable views: `Collections.unmodifiableMap()`, `List.copyOf()`
- Defensive copies on collection input: `new ArrayList<>(list)`, `new LinkedHashMap<>(map)`
- Null-safe defaults in setters: `this.packaging = packaging == null ? ScriptPackaging.TOOL : packaging`
- Business logic lives on domain models (e.g., `publish()`, `mergeFrom()`, `toPublishedDefinition()`)
### JPA Entity Pattern
- No Lombok -- all getters/setters are hand-written
- Single-line compact style for simple accessors
- JSON columns stored as `String` with `@Lob` annotation
- Enum values stored as `String` (`.name()`) not ordinal
- Table name and indexes declared via `@Table` annotation
### Constructor Injection
### Error Handling
- `InvalidExecutionInputException` -- field-level validation errors
- `InvalidPythonRequirementsException` -- Python dependency issues
- `StructuredExecutionException` -- execution failures with `ErrorDetail`
- `EventAuthenticationException` -- auth failures (401)
- `@RestControllerAdvice` catches all exceptions
- Maps exception types to HTTP status codes (400, 401, 413, 431, 500)
- Returns unified `ApiResponse<T>` envelope with `{ status, msg, data }` structure
- Fallback `Exception.class` handler returns 500 with `ErrorDetail` (type + stack trace)
### API Response Envelope
### Javadoc Conventions
- Class-level: summary sentence, `<p>` paragraph with details, `@author` tag
- Method-level: summary, `<p>` details, `@param`, `@return`, `@throws`
- Package-private or private methods: sometimes documented, sometimes not
- Enums have Javadoc on each constant value
### Port/Adapter Pattern (Hexagonal Architecture)
## TypeScript Frontend Conventions (Admin UI)
### Naming Patterns
- React components: `PascalCase.tsx` -- `ExecutionLogPanel.tsx`, `ScriptEditorPage.tsx`
- API modules: `api.ts` (one per feature) -- `features/scripts/api.ts`
- Service modules: `camelCase.ts` -- `httpClient.ts`, `schema.ts`
- Test files: co-located with source using `.test.ts` or `.test.tsx` suffix -- `utils.test.ts`, `ExecutionLogPanel.test.tsx`
- Type definition files: `types.ts` or `index.ts` in shared directories
- Custom hooks: `use` prefix -- `useScriptExecution.ts`, `usePollingExecution.ts`
- Route files: `routes.tsx`
- Feature-based organization under `src/features/<feature>/`
- `src/components/` -- Shared components organized by domain
- `src/services/` -- Cross-feature service functions
- `src/shared/` -- Shared utilities, API client, auth, contexts, hooks
- `src/app/` -- Application shell, routing, theme
- `src/batch/` -- Batch execution logic
### Code Style
- `"strict": true`
- `"forceConsistentCasingInFileNames": true`
- `"noEmit": true` (build handled by Vite)
- `"jsx": "react-jsx"`
- `"module": "ESNext"`, `"moduleResolution": "Node"`
### Import Organization
### API Client Pattern
### React Patterns
- **Functional components** only (no class components observed)
- **Custom hooks** for stateful logic (`useScriptExecution`, `usePollingExecution`)
- **@tanstack/react-query** for server state management
- **Ant Design (antd)** as the UI component library
- **React Router v6** for routing
- **Monaco Editor** for code editing
## TypeScript CLI Conventions
### Naming Patterns
- Commands: `src/commands/<topic>/<command>.ts` (oclif convention)
- Libraries: `src/lib/<module>.ts`
- Tests: `test/<module>.test.ts` (separate `test/` directory)
### Code Style
- Standard TypeScript with strict mode
- oclif framework conventions for CLI structure
- Uses `vi.stubGlobal("fetch", ...)` pattern for mocking globals in tests
## Cross-Cutting Conventions
### Commit Messages
- Chinese-language commit messages
- `feat:` prefix for new features
- `refactor:` prefix for refactoring
- Format: `<type>: <Chinese description>`
### Internationalization
- Backend error messages, Javadoc, and API response messages are in **Chinese**
- Frontend UI strings are in **Chinese**
- Code identifiers (class names, method names, variables) are in **English**
### Database Migrations
- **Flyway** for schema migrations (referenced in `AGENTS.md`)
- Migrations are append-only: never modify existing migration files
- Version numbers follow `V{n}__description.sql` pattern
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
```
## Component Responsibilities
| Component | Responsibility | File |
|-----------|----------------|------|
| RuntimeApplication | Spring Boot entry point, component scanning, imports configurations | `actiondock-app-spring/src/main/java/.../RuntimeApplication.java` |
| REST Controllers | HTTP request handling, input/output mapping, delegates to application services | `actiondock-app-spring/src/main/java/.../web/**/*Controller.java` |
| Application Services | Business use-case orchestration, transaction boundaries, input validation | `actiondock-core/src/main/java/.../application/*ApplicationService.java` |
| Domain Models | Rich business objects with behavior (ScriptDefinition, ExecutionRecord, etc.) | `actiondock-core/src/main/java/.../domain/model/*.java` |
| Domain Ports | Interfaces defining contracts for persistence and external services | `actiondock-core/src/main/java/.../domain/port/*.java` |
| JPA Adapters | Implement domain ports using Spring Data JPA, entity-model mapping | `actiondock-storage-jpa/src/main/java/.../adapter/Jpa*Adapter.java` |
| JPA Entities | Database-mapped entities (Hibernate/JPA annotations) | `actiondock-storage-jpa/src/main/java/.../entity/*Entity.java` |
| Spring Data Repos | Spring Data JPA repository interfaces | `actiondock-storage-jpa/src/main/java/.../repo/SpringData*Repository.java` |
| RoutingScriptEngine | Routes script execution to Groovy or Python engine based on ScriptType | `actiondock-app-support/src/main/java/.../script/RoutingScriptEngine.java` |
| GroovyScriptEngine | Executes Groovy scripts via GroovyShell | `actiondock-app-support/src/main/java/.../script/GroovyScriptEngine.java` |
| PythonScriptEngine | Executes Python scripts via external process bridge | `actiondock-app-support/src/main/java/.../script/PythonScriptEngine.java` |
| PluginRuntimeService | Loads and invokes plugins via PF4J framework | `actiondock-app-support/src/main/java/.../plugin/PluginRuntimeService.java` |
| AiGateway | AI model interaction gateway (chat, structured, embedding) | `actiondock-ai-core/src/main/java/.../AiGatewayImpl.java` |
| AiAgentRuntimeImpl | AI agent orchestration (multi-step runs with tools) | `actiondock-ai-core/src/main/java/.../AiAgentRuntimeImpl.java` |
| AiToolRegistryImpl | Registry of AI tools (static + dynamic from scripts) | `actiondock-ai-core/src/main/java/.../AiToolRegistryImpl.java` |
| RepositoryService classes | Git-based repository management, publishing, upstream sync | `actiondock-app-support/src/main/java/.../repository/*Service.java` |
| SkillService | Skill installation, archiving, and runtime resolution | `actiondock-app-support/src/main/java/.../skill/SkillService.java` |
| ApiKeyAuthFilter | Bearer token authentication for /api/ endpoints | `actiondock-app-spring/src/main/java/.../auth/ApiKeyAuthFilter.java` |
| GlobalExceptionHandler | Maps exceptions to unified ApiResponse format | `actiondock-app-spring/src/main/java/.../web/common/GlobalExceptionHandler.java` |
| Admin UI (React SPA) | Browser-based admin console served from /admin/app | `actiondock-admin-ui/src/` |
| CLI (Oclif) | Node.js CLI for local runtime management | `actiondock-cli/` |
## Pattern Overview
- **Domain core has zero framework dependencies.** `actiondock-core` depends only on JDK. All Spring, JPA, and external integrations live in adapter modules.
- **Ports are interfaces in `domain/port/`.** Every repository, engine, and external service contract is defined as a Java interface in the core module.
- **Adapters implement ports.** JPA adapters in `actiondock-storage-jpa` implement repository ports. Script engines in `actiondock-app-support` implement `ScriptEngine`. The AI provider client in `actiondock-ai-agentscope` implements `AiProviderClient`.
- **Application services orchestrate.** Each bounded context (scripts, executions, events, config, skills, AI) has an `*ApplicationService` class that coordinates domain logic.
- **Manual dependency injection via constructors.** Application services and domain objects use constructor injection. Spring `@Configuration` classes wire beans explicitly (no `@Component` scanning on domain code).
- **Configuration-per-domain.** Each domain area has its own `@Configuration` class in `actiondock-app-support`: `ScriptConfiguration`, `EventConfiguration`, `AiConfiguration`, `RepositoryConfiguration`, `PluginConfiguration`, `SkillConfiguration`, `ScheduleConfiguration`.
## Layers
- Purpose: Business rules, domain models, port interfaces
- Location: `actiondock-core/src/main/java/org/team4u/actiondock/domain/`
- Contains: `model/` (rich domain objects), `port/` (interfaces), `exception/` (domain exceptions)
- Depends on: JDK only
- Used by: All other modules
- Purpose: Use-case orchestration, input normalization, validation, cross-domain coordination
- Location: `actiondock-core/src/main/java/org/team4u/actiondock/application/`
- Contains: `*ApplicationService` classes, value objects, support utilities
- Depends on: Domain layer (domain/model, domain/port)
- Used by: Web controllers, infrastructure adapters, Spring configuration
- Purpose: Implements domain ports using specific technologies (JPA, PF4J, Python process, HTTP)
- Location: `actiondock-storage-jpa/` (JPA), `actiondock-app-support/` (script engines, plugins, repositories, skills)
- Contains: Repository adapters, entity classes, script engines, plugin runtime
- Depends on: Domain layer (implements domain/port interfaces)
- Used by: Spring configuration (wired as beans)
- Purpose: AI model interaction, agent orchestration, tool registry
- Location: `actiondock-ai-api/` (ports), `actiondock-ai-core/` (services), `actiondock-ai-agentscope/` (provider), `actiondock-ai-plugin-bridge/` (plugin integration)
- Contains: AI interfaces, service implementations, provider clients
- Depends on: Domain layer for some shared concepts; `actiondock-ai-api` is the port module
- Used by: Web controllers (AI endpoints), Spring configuration
- Purpose: HTTP API and browser UI
- Location: `actiondock-app-spring/web/` (controllers), `actiondock-admin-ui/` (React SPA)
- Contains: REST controllers, request/response DTOs, React pages/components/services
- Depends on: Application layer services
- Used by: End users (browser, API clients, CLI)
## Data Flow
### Primary Request Path (Script Execution)
### Event Ingestion Flow (Webhook)
### Script Cross-Invocation Flow
- All persistent state is stored in H2 via JPA. No in-memory state beyond request scope.
- Script execution state is tracked via `ExecutionRecord` entities with status transitions: PENDING -> RUNNING -> SUCCESS/FAILED.
- `SharedStateEntry` provides key-value state with compare-and-set semantics for inter-script communication.
- `ConfigValue` provides a global key-value configuration store with placeholder resolution.
## Key Abstractions
- Purpose: Defines script validation and execution contract
- Interface: `actiondock-core/.../domain/port/ScriptEngine.java`
- Implementations: `RoutingScriptEngine` -> `GroovyScriptEngine`, `PythonScriptEngine`
- Pattern: Strategy pattern with routing dispatcher
- Purpose: Persistence contracts decoupled from JPA
- Interface: `actiondock-core/.../domain/port/*Repository.java`
- Implementations: `actiondock-storage-jpa/.../adapter/Jpa*RepositoryAdapter.java`
- Pattern: Repository pattern, adapter maps between domain model and JPA entity
- Purpose: Event processing pipeline (filter/transform actions on event data)
- Interface: `actiondock-core/.../domain/port/ProcessorEngine.java`
- Implementation: `actiondock-app-support/.../processor/DefaultProcessorEngine.java`
- Pattern: Pipeline/chain of responsibility for event processing
- Purpose: AI tool registration for agent use
- Interface: `actiondock-ai-api/.../AiTool.java`, `AiToolProvider.java`
- Implementations: Static tools in `ActionDockAiTools`, dynamic tools via `ActionDockDynamicAiToolProvider`
- Pattern: Registry pattern; tools are discovered and invoked by the AI agent runtime
- Purpose: Extensible plugin system via PF4J
- Interface: `actiondock-plugin-api/.../ActionDockPlugin.java`
- Template: `actiondock-plugin-template/.../DemoActionDockPlugin.java`
- Pattern: Extension point pattern; plugins implement `invoke(action, context, args)`
- Purpose: Unified AI model interaction (chat, structured, embedding)
- Interface: `actiondock-ai-api/.../AiGateway.java`
- Implementation: `actiondock-ai-core/.../AiGatewayImpl.java`
- Pattern: Facade over AI provider client
## Entry Points
- Location: `actiondock-app-spring/src/main/java/org/team4u/actiondock/RuntimeApplication.java`
- Triggers: `mvn -pl actiondock-app-spring -am spring-boot:run` or `java -jar actiondock-app-spring.jar`
- Responsibilities: Starts Spring context, scans web/bootstrap/schedule packages, imports all configuration classes
- Default port: 5177 (see CLI jdeploy config)
- Location: `actiondock-admin-ui/src/main.tsx`
- Triggers: `npm run dev` (Vite dev server) or `npm run build` (production build to `dist/`)
- Responsibilities: Renders admin UI at `/admin/app`, uses React Router with `basename="/admin/app"`
- API base: Same origin as backend (production: backend serves the built SPA)
- Location: `actiondock-cli/`
- Triggers: `npx actiondock <command>` or global install via `npm install -g actiondock`
- Responsibilities: Local runtime management, packaging (`jdeploy` for desktop app distribution)
- Runtime bridge: CLI can launch the Spring Boot jar as a background service
- Location: `actiondock-app-spring/.../web/event/EventIngestionController.java`
- Triggers: External HTTP POST to `/api/event-sources/{id}/events`
- Auth: Skipped for event ingestion endpoints (configured in `ApiKeyAuthFilter.shouldNotFilter`)
## Architectural Constraints
- **Threading:** Single-threaded request processing per Spring Boot default. Async script executions use a fixed-size thread pool (`executionExecutor` bean, pool size from `AppProperties.execution.asyncPoolSize`).
- **Global state:** No module-level singletons with mutable state. All beans are Spring-managed singletons but stateless or backed by database. The `CompiledGroovyScriptCache` in `GroovyScriptEngine` is the main in-memory cache (compiled Groovy classes).
- **Circular imports:** `actiondock-core` is the base module with no dependencies on other modules. All other modules depend on `actiondock-core`. No circular Maven dependencies.
- **Maven module dependency graph:** `actiondock-core` <- `actiondock-storage-jpa` <- `actiondock-app-support` <- `actiondock-app-spring`. `actiondock-ai-api` is independent port module; `actiondock-ai-core` depends on `actiondock-ai-api`; `actiondock-ai-agentscope` depends on `actiondock-ai-api`. `actiondock-plugin-api` is independent.
- **Database:** H2 embedded database with Flyway migrations. All migrations are additive-only per AGENTS.md rules.
## Anti-Patterns
### Bypassing domain ports in application services
### Putting business logic in controllers
## Error Handling
- `GlobalExceptionHandler` (`actiondock-app-spring/.../web/common/GlobalExceptionHandler.java`) maps domain and application exceptions to HTTP status codes and structured error responses
- Domain exceptions (`UpstreamConflictException`, `RepositoryPluginConflictException`, etc.) are mapped with specific error codes and context data
- `IllegalArgumentException` (used for validation failures) maps to 400
- Unhandled exceptions map to 500 with error detail summary
- All responses use `ApiResponse<T>` wrapper with `{ status, msg, data }` structure
- `ErrorDetailSupport.summarize()` and `ErrorDetailSupport.describe()` provide standardized error detail formatting
- Script execution errors are caught in `ExecutionApplicationService.run()` and recorded as `ExecutionRecord` with FAILED status
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
