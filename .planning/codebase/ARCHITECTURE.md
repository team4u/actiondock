<!-- refreshed: 2026-05-11 -->
# Architecture

**Analysis Date:** 2026-05-11

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                    Presentation Layer                                │
├──────────────────────────────┬──────────────────────────────────────┤
│   Admin UI (React SPA)       │   REST API Controllers              │
│   `actiondock-admin-ui/`     │   `actiondock-app-spring/web/`     │
│   Ant Design + React Query   │   Spring @RestController            │
└──────────────┬───────────────┴──────────────┬───────────────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Application Layer                                 │
│   `actiondock-core/application/`                                    │
│   Application Services (use-case orchestration, no framework deps)  │
│   - ScriptApplicationService   - ExecutionApplicationService        │
│   - EventIngestionApplicationService - EventTriggerApplicationService│
│   - ConfigValueApplicationService - SharedStateApplicationService   │
└──────────────────────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Domain Layer (Ports)                              │
│   `actiondock-core/domain/`                                         │
│   Models: `domain/model/`  (rich domain objects, pure Java)         │
│   Ports:  `domain/port/`   (interfaces: Repository, Engine, etc.)   │
│   Exceptions: `domain/exception/`                                   │
└──────────────────────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Infrastructure / Adapters                         │
├──────────────────────┬──────────────────┬───────────────────────────┤
│   JPA Storage        │   Script Engines │   AI Subsystem            │
│   `actiondock-       │   `actiondock-   │   `actiondock-ai-api/`    │
│    storage-jpa/`     │    app-support/  │   `actiondock-ai-core/`   │
│   Entity ↔ Model     │    script/`      │   `actiondock-ai-         │
│   adapters           │   Groovy, Python │    agentscope/`           │
├──────────────────────┼──────────────────┼───────────────────────────┤
│   Plugin System      │   Scheduler      │   Config & Support        │
│   `actiondock-       │   `actiondock-   │   `actiondock-app-        │
│    plugin-api/`      │    app-spring/   │    support/`              │
│   `actiondock-       │    schedule/`    │   config, repository,     │
│    plugin-template/` │                  │   skill services          │
└──────────────────────┴──────────────────┴───────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Data Store                                        │
│   H2 Database (via Spring Data JPA + Flyway migrations)             │
│   `actiondock-app-spring/src/main/resources/db/migration/`          │
└─────────────────────────────────────────────────────────────────────┘
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

**Overall:** Hexagonal Architecture (Ports and Adapters) with Domain-Driven Design

**Key Characteristics:**
- **Domain core has zero framework dependencies.** `actiondock-core` depends only on JDK. All Spring, JPA, and external integrations live in adapter modules.
- **Ports are interfaces in `domain/port/`.** Every repository, engine, and external service contract is defined as a Java interface in the core module.
- **Adapters implement ports.** JPA adapters in `actiondock-storage-jpa` implement repository ports. Script engines in `actiondock-app-support` implement `ScriptEngine`. The AI provider client in `actiondock-ai-agentscope` implements `AiProviderClient`.
- **Application services orchestrate.** Each bounded context (scripts, executions, events, config, skills, AI) has an `*ApplicationService` class that coordinates domain logic.
- **Manual dependency injection via constructors.** Application services and domain objects use constructor injection. Spring `@Configuration` classes wire beans explicitly (no `@Component` scanning on domain code).
- **Configuration-per-domain.** Each domain area has its own `@Configuration` class in `actiondock-app-support`: `ScriptConfiguration`, `EventConfiguration`, `AiConfiguration`, `RepositoryConfiguration`, `PluginConfiguration`, `SkillConfiguration`, `ScheduleConfiguration`.

## Layers

**Domain Layer:**
- Purpose: Business rules, domain models, port interfaces
- Location: `actiondock-core/src/main/java/org/team4u/actiondock/domain/`
- Contains: `model/` (rich domain objects), `port/` (interfaces), `exception/` (domain exceptions)
- Depends on: JDK only
- Used by: All other modules

**Application Layer:**
- Purpose: Use-case orchestration, input normalization, validation, cross-domain coordination
- Location: `actiondock-core/src/main/java/org/team4u/actiondock/application/`
- Contains: `*ApplicationService` classes, value objects, support utilities
- Depends on: Domain layer (domain/model, domain/port)
- Used by: Web controllers, infrastructure adapters, Spring configuration

**Infrastructure Layer (Adapters):**
- Purpose: Implements domain ports using specific technologies (JPA, PF4J, Python process, HTTP)
- Location: `actiondock-storage-jpa/` (JPA), `actiondock-app-support/` (script engines, plugins, repositories, skills)
- Contains: Repository adapters, entity classes, script engines, plugin runtime
- Depends on: Domain layer (implements domain/port interfaces)
- Used by: Spring configuration (wired as beans)

**AI Subsystem:**
- Purpose: AI model interaction, agent orchestration, tool registry
- Location: `actiondock-ai-api/` (ports), `actiondock-ai-core/` (services), `actiondock-ai-agentscope/` (provider), `actiondock-ai-plugin-bridge/` (plugin integration)
- Contains: AI interfaces, service implementations, provider clients
- Depends on: Domain layer for some shared concepts; `actiondock-ai-api` is the port module
- Used by: Web controllers (AI endpoints), Spring configuration

**Presentation Layer:**
- Purpose: HTTP API and browser UI
- Location: `actiondock-app-spring/web/` (controllers), `actiondock-admin-ui/` (React SPA)
- Contains: REST controllers, request/response DTOs, React pages/components/services
- Depends on: Application layer services
- Used by: End users (browser, API clients, CLI)

## Data Flow

### Primary Request Path (Script Execution)

1. **HTTP request** -- Client POSTs to `/api/executions` with `ExecuteRequest` (`actiondock-app-spring/.../web/execution/ExecutionController.java:41`)
2. **Controller delegates** to `ExecutionApplicationService.execute()` (`actiondock-core/.../application/ExecutionApplicationService.java:67`)
3. **Application service** normalizes input, validates schema, creates `ExecutionRecord`, calls `ScriptEngine.execute()` (`ExecutionApplicationService.java:133-166`)
4. **RoutingScriptEngine** routes to `GroovyScriptEngine` or `PythonScriptEngine` based on `ScriptType` (`actiondock-app-support/.../script/RoutingScriptEngine.java:53-55`)
5. **Script engine** executes the script, returns result
6. **ExecutionLogCollector** records logs and final status to `ExecutionRepository` (`ExecutionApplicationService.java:181-200`)
7. **Controller** maps result to `ExecutionResponse` and returns `ApiResponse<ExecutionResponse>` (`ExecutionController.java:48-52`)

### Event Ingestion Flow (Webhook)

1. **HTTP request** -- External system POSTs to `/api/event-sources/{id}/events` (`actiondock-app-spring/.../web/event/EventIngestionController.java:30`)
2. **Controller** extracts headers, query params, raw body, delegates to `EventIngestionApplicationService.ingest()` (`EventIngestionController.java:34`)
3. **Application service** authenticates webhook, normalizes event, matches triggers (`actiondock-core/.../application/EventIngestionApplicationService.java:34`)
4. **ProcessorEngine** processes event through registered triggers, dispatching to script executions (`domain/port/ProcessorEngine.java`)
5. **EventTriggerApplicationService** triggers associated script executions (`actiondock-core/.../application/EventTriggerApplicationService`)
6. **Response** -- Returns webhook response (custom headers/body) or standard API response

### Script Cross-Invocation Flow

1. **Script A** calls `scriptEngine.invokePublished("B", context, input)` via `ScriptInvocationService` (`actiondock-core/.../application/ScriptInvocationService.java:60`)
2. **Service** resolves script ID (including repository-installed dependencies), validates input schema
3. **Cycle detection** checks `ScriptExecutionContext.scriptStack` for loops (`ScriptInvocationService.java:164-178`)
4. **Nested execution** creates child context with extended script stack, delegates to `ScriptEngine`
5. **Result** returned as normalized Map to calling script

**State Management:**
- All persistent state is stored in H2 via JPA. No in-memory state beyond request scope.
- Script execution state is tracked via `ExecutionRecord` entities with status transitions: PENDING -> RUNNING -> SUCCESS/FAILED.
- `SharedStateEntry` provides key-value state with compare-and-set semantics for inter-script communication.
- `ConfigValue` provides a global key-value configuration store with placeholder resolution.

## Key Abstractions

**ScriptEngine (port):**
- Purpose: Defines script validation and execution contract
- Interface: `actiondock-core/.../domain/port/ScriptEngine.java`
- Implementations: `RoutingScriptEngine` -> `GroovyScriptEngine`, `PythonScriptEngine`
- Pattern: Strategy pattern with routing dispatcher

**Repository Ports (domain):**
- Purpose: Persistence contracts decoupled from JPA
- Interface: `actiondock-core/.../domain/port/*Repository.java`
- Implementations: `actiondock-storage-jpa/.../adapter/Jpa*RepositoryAdapter.java`
- Pattern: Repository pattern, adapter maps between domain model and JPA entity

**ProcessorEngine (port):**
- Purpose: Event processing pipeline (filter/transform actions on event data)
- Interface: `actiondock-core/.../domain/port/ProcessorEngine.java`
- Implementation: `actiondock-app-support/.../processor/DefaultProcessorEngine.java`
- Pattern: Pipeline/chain of responsibility for event processing

**AiTool / AiToolProvider (port):**
- Purpose: AI tool registration for agent use
- Interface: `actiondock-ai-api/.../AiTool.java`, `AiToolProvider.java`
- Implementations: Static tools in `ActionDockAiTools`, dynamic tools via `ActionDockDynamicAiToolProvider`
- Pattern: Registry pattern; tools are discovered and invoked by the AI agent runtime

**ActionDockPlugin (port):**
- Purpose: Extensible plugin system via PF4J
- Interface: `actiondock-plugin-api/.../ActionDockPlugin.java`
- Template: `actiondock-plugin-template/.../DemoActionDockPlugin.java`
- Pattern: Extension point pattern; plugins implement `invoke(action, context, args)`

**AiGateway (port):**
- Purpose: Unified AI model interaction (chat, structured, embedding)
- Interface: `actiondock-ai-api/.../AiGateway.java`
- Implementation: `actiondock-ai-core/.../AiGatewayImpl.java`
- Pattern: Facade over AI provider client

## Entry Points

**Backend (Spring Boot):**
- Location: `actiondock-app-spring/src/main/java/org/team4u/actiondock/RuntimeApplication.java`
- Triggers: `mvn -pl actiondock-app-spring -am spring-boot:run` or `java -jar actiondock-app-spring.jar`
- Responsibilities: Starts Spring context, scans web/bootstrap/schedule packages, imports all configuration classes
- Default port: 5177 (see CLI jdeploy config)

**Frontend (React SPA):**
- Location: `actiondock-admin-ui/src/main.tsx`
- Triggers: `npm run dev` (Vite dev server) or `npm run build` (production build to `dist/`)
- Responsibilities: Renders admin UI at `/admin/app`, uses React Router with `basename="/admin/app"`
- API base: Same origin as backend (production: backend serves the built SPA)

**CLI (Oclif):**
- Location: `actiondock-cli/`
- Triggers: `npx actiondock <command>` or global install via `npm install -g actiondock`
- Responsibilities: Local runtime management, packaging (`jdeploy` for desktop app distribution)
- Runtime bridge: CLI can launch the Spring Boot jar as a background service

**Webhook Endpoint:**
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

**What happens:** Some application services in `actiondock-core` directly reference concrete types from adapter modules through their constructors (e.g., `ScriptInvocationService` accepts `Supplier<ScriptEngine>` which is fine, but some configuration classes wire everything together tightly).
**Why it's wrong:** This is actually acceptable here -- the `domain/port/` interfaces are defined in core, and adapters implement them. The wiring happens in Spring configuration classes, not in domain code.
**Do this instead:** Keep all port interfaces in `actiondock-core/domain/port/` and implementations in adapter modules. Wire via `@Configuration` classes in `actiondock-app-support`.

### Putting business logic in controllers

**What happens:** Controllers in `actiondock-app-spring/web/` are thin wrappers that delegate to application services. This is the correct pattern.
**Do this instead:** Always follow this pattern. Controllers should only handle HTTP concerns (request/response mapping, status codes). All business logic belongs in `*ApplicationService` classes.

## Error Handling

**Strategy:** Centralized exception-to-response mapping via `@RestControllerAdvice`

**Patterns:**
- `GlobalExceptionHandler` (`actiondock-app-spring/.../web/common/GlobalExceptionHandler.java`) maps domain and application exceptions to HTTP status codes and structured error responses
- Domain exceptions (`UpstreamConflictException`, `RepositoryPluginConflictException`, etc.) are mapped with specific error codes and context data
- `IllegalArgumentException` (used for validation failures) maps to 400
- Unhandled exceptions map to 500 with error detail summary
- All responses use `ApiResponse<T>` wrapper with `{ status, msg, data }` structure
- `ErrorDetailSupport.summarize()` and `ErrorDetailSupport.describe()` provide standardized error detail formatting
- Script execution errors are caught in `ExecutionApplicationService.run()` and recorded as `ExecutionRecord` with FAILED status

## Cross-Cutting Concerns

**Logging:** Standard SLF4J/Logback via Spring Boot defaults. Script execution logs are captured via `ExecutionLogCollector` which writes to `ExecutionRecord.logEntries`.

**Validation:** Input validation happens in application services before persistence. `ScriptSchemaSupport.validateInput()` validates script input against JSON Schema. `ExecutionInputNormalizer.normalizeMap()` normalizes input maps. `PythonRequirementsSupport.validateScriptDefinition()` validates Python requirements.

**Authentication:** `ApiKeyAuthFilter` (`actiondock-app-spring/.../auth/ApiKeyAuthFilter.java`) intercepts `/api/` requests. Uses Bearer token from `Authorization` header. If no enabled tokens exist, all requests are allowed (open mode). Event webhook ingestion endpoints (`POST /api/event-sources/{id}/events`) skip authentication.

**CORS:** Configured in `WebCorsConfiguration` (`actiondock-app-spring/.../config/WebCorsConfiguration.java`).

**Scheduling:** Script schedules are managed by `ScheduleApplicationService`. `ScriptScheduleDispatcher` (`actiondock-app-support/.../schedule/ScriptScheduleDispatcher.java`) triggers scheduled script executions. `RepositoryAutoSyncScheduler` handles periodic upstream repository synchronization.

---

*Architecture analysis: 2026-05-11*
