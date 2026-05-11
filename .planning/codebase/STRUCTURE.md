# Codebase Structure

**Analysis Date:** 2026-05-11

## Directory Layout

```
actiondock/                           # Multi-module Maven project root
├── pom.xml                           # Parent POM (Spring Boot 3.3.5, Java 21)
├── AGENTS.md                         # Agent development guidelines
├── CLAUDE.md                         # Claude instructions
├── docs/                             # Documentation (markdown)
│
├── actiondock-core/                  # Domain + Application layers (pure Java, no framework)
│   └── src/main/java/.../
│       ├── application/              # Application services (use cases)
│       ├── domain/
│       │   ├── model/                # Domain models
│       │   ├── port/                 # Port interfaces (repositories, engines)
│       │   └── exception/            # Domain exceptions
│       └── update/                   # Application version utilities
│
├── actiondock-storage-jpa/           # JPA adapter layer (domain port implementations)
│   └── src/main/java/.../storage/jpa/
│       ├── adapter/                  # JPA repository adapters (Jpa*Adapter.java)
│       ├── entity/                   # JPA entity classes (*Entity.java)
│       ├── repo/                     # Spring Data JPA repositories (SpringData*Repository.java)
│       ├── json/                     # JSON codec (JacksonJsonCodec)
│       └── StorageConfiguration.java # Bean registration + component scan
│
├── actiondock-app-support/           # Infrastructure services (script engines, plugins, repos, skills)
│   └── src/main/java/.../
│       ├── config/                   # Spring @Configuration classes per domain
│       ├── script/                   # Script engine implementations (Groovy, Python, Routing)
│       ├── plugin/                   # Plugin runtime, file management, view mappers
│       ├── processor/                # Default processor engine implementation
│       ├── repository/               # Git-based repository management services
│       ├── skill/                    # Skill installation, archiving, manifest reading
│       ├── ai/tool/                  # AI tool providers (ActionDockAiTools, dynamic provider)
│       ├── configvalue/              # Config value analysis utilities
│       ├── schedule/                 # Schedule dispatcher
│       └── shared/                   # Shared normalization utilities
│
├── actiondock-app-spring/            # Spring Boot application (web layer + bootstrap)
│   └── src/main/java/.../
│       ├── RuntimeApplication.java   # @SpringBootApplication entry point
│       ├── auth/                     # ApiKeyAuthFilter, AuthConfiguration
│       ├── bootstrap/                # SampleDataInitializer
│       ├── config/                   # WebCorsConfiguration
│       ├── schedule/                 # Background schedulers (auto-sync, cleanup)
│       └── web/                      # REST controllers organized by domain
│           ├── common/               # ApiResponse, GlobalExceptionHandler
│           ├── execution/            # ExecutionController, ExecuteRequest/Response
│           ├── script/               # ScriptController, ScriptPatchService
│           ├── event/                # EventIngestionController, EventSourceController
│           ├── ai/                   # AiAgentController, AiGatewayController, AiModelController
│           ├── plugin/               # PluginController
│           ├── repository/           # RepositoryController, InstalledToolController
│           ├── skill/                # SkillController, SkillTargetController
│           ├── accesstoken/          # AccessTokenController
│           ├── configvalue/          # ConfigValueController
│           ├── schedule/             # ScheduleController
│           ├── sharedstate/          # SharedStateController
│           ├── schema/               # SchemaController
│           ├── processor/            # ProcessorController
│           └── resource/             # ResourceLifecycleController
│
├── actiondock-ai-api/                # AI subsystem port interfaces
│   └── src/main/java/.../ai/api/
│       ├── AiGateway.java            # AI interaction facade
│       ├── AiTool.java               # Tool interface
│       ├── AiToolProvider.java       # Dynamic tool provider
│       ├── AiAgentRuntime.java       # Agent runtime interface
│       ├── AiModelProfile.java       # Model configuration model
│       ├── AiAgentProfile.java       # Agent profile model
│       └── *Repository.java          # AI-specific repository ports
│
├── actiondock-ai-core/               # AI subsystem service implementations
│   └── src/main/java/.../ai/core/
│       ├── AiGatewayImpl.java        # Gateway implementation
│       ├── AiAgentRuntimeImpl.java   # Agent runtime implementation
│       ├── AiToolRegistryImpl.java   # Tool registry
│       ├── AiModelProfileService.java
│       ├── AiAgentProfileService.java
│       └── AiToolsetService.java
│
├── actiondock-ai-agentscope/         # AgentScope AI provider implementation
│   └── src/main/java/.../ai/agentscope/
│       ├── AgentScopeAiProviderClient.java  # AiProviderClient implementation
│       ├── AgentScopeBuiltinAiTools.java
│       └── AgentScopeToolAdapter.java
│
├── actiondock-ai-plugin-bridge/      # Bridge between AI system and plugin system
│   └── src/main/java/.../ai/plugin/
│       └── ActionDockAiSystemPlugin.java
│
├── actiondock-plugin-api/            # Plugin system port interfaces
│   └── src/main/java/.../plugin/api/
│       ├── ActionDockPlugin.java     # Main plugin extension point
│       ├── PluginManifest.java       # Plugin descriptor
│       ├── ScriptPluginContext.java  # Plugin execution context
│       └── PluginRuntime*            # Runtime support classes
│
├── actiondock-plugin-template/       # Template/example plugin project
│   └── src/main/java/.../plugin/template/
│       ├── DemoActionDockPlugin.java
│       └── DemoPluginConfig.java
│
├── actiondock-admin-ui/              # React admin SPA (Vite + TypeScript + Ant Design)
│   └── src/
│       ├── main.tsx                  # React entry point (BrowserRouter, basename=/admin/app)
│       ├── App.tsx                   # App component
│       ├── app/                      # App shell, routing, theme, feature registry
│       │   ├── AppRoot.tsx           # Root with providers (QueryClient, Auth, ColorMode)
│       │   ├── AppShell.tsx          # Layout shell with navigation
│       │   ├── featureRegistry.ts    # Feature registration types
│       │   ├── features.tsx          # Registered feature definitions
│       │   ├── routeRegistry.tsx     # Route generation from features
│       │   ├── navRegistry.ts        # Navigation menu registration
│       │   └── theme.ts              # Ant Design theme
│       ├── features/                 # Feature modules (pages + api per domain)
│       │   ├── scripts/              # Script management pages + api.ts
│       │   ├── capabilities/         # Script editor, capabilities pages + api.ts
│       │   ├── executions/           # Execution history pages + api.ts
│       │   ├── triggers/             # Event trigger pages + api.ts
│       │   ├── plugins/              # Plugin management pages + api.ts
│       │   ├── resources/            # Resource lifecycle pages + api.ts
│       │   ├── skills/               # Skill management pages + api.ts
│       │   ├── ai/                   # AI agent/model/toolset pages + api.ts
│       │   └── settings/             # System settings pages + api.ts
│       ├── components/               # Shared UI components
│       │   ├── common/               # CodeEditor, ErrorBoundary, JsonPreview, etc.
│       │   ├── execution/            # ExecutionLogPanel, BatchRunPanel, CommandPanel
│       │   ├── schema/               # SchemaBuilder, SchemaFieldList, SchemaObjectEditor
│       │   ├── diff/                 # ScriptDiffPanel, DependencyDiffViewer, etc.
│       │   ├── plugin/               # PluginActionsOverview, ProcessorEditor
│       │   ├── skill/                # SkillExamplePanel, SkillFileBrowser
│       │   ├── repository/           # RepositoryPublishBasicsForm
│       │   ├── ai/                   # AiStepTracePanel, AiTags
│       │   └── domain/               # Domain-specific tags and labels
│       ├── services/                 # Client-side business logic (not API calls)
│       │   ├── api.ts                # Re-exports all feature api.ts files
│       │   ├── schema.ts             # JSON Schema utilities
│       │   ├── schemaForm.tsx        # Schema-driven form generation
│       │   ├── commands.ts           # CLI command generation
│       │   └── *.ts                  # Various domain utilities
│       ├── batch/                    # Batch execution support
│       │   ├── parser.ts             # Batch input parser
│       │   ├── session.ts            # Batch execution session
│       │   └── useBatchExecution.ts  # React hook for batch ops
│       └── shared/                   # Cross-cutting frontend utilities
│           ├── api/                  # httpClient.ts, queryClient.ts
│           ├── auth/                 # AuthProvider, tokenStore
│           ├── contexts/             # ColorModeContext
│           ├── hooks/                # Custom React hooks
│           └── types/                # Shared TypeScript types
│
├── actiondock-cli/                   # Node.js CLI (Oclif framework)
│   ├── package.json                  # CLI manifest (oclif config, jdeploy config)
│   ├── bin/                          # Executable entry points
│   ├── src/                          # TypeScript source (commands, runtime management)
│   ├── dist/                         # Compiled JS output
│   ├── runtime/                      # Bundled Spring Boot JAR for desktop distribution
│   ├── scripts/                      # Build scripts
│   └── test/                         # CLI tests
│
├── skills/                           # Skill-related references
│   └── actiondock-cli/               # CLI skill references
│
└── docs/                             # Project documentation (markdown)
    ├── quick-start.md
    ├── api-reference.md
    ├── script-management.md
    ├── event-framework.md
    ├── plugin-management.md
    ├── ai-capabilities.md
    ├── skills-management.md
    ├── repository-distribution.md
    └── ...
```

## Directory Purposes

**`actiondock-core/`:**
- Purpose: Domain model and application service layer. Contains all business logic with zero framework dependencies.
- Contains: Domain models, port interfaces, application services, domain exceptions
- Key files: `domain/model/ScriptDefinition.java`, `domain/port/ScriptEngine.java`, `application/ExecutionApplicationService.java`

**`actiondock-storage-jpa/`:**
- Purpose: JPA implementation of domain repository ports. Bridges domain models to database entities.
- Contains: JPA adapters, entity classes, Spring Data repositories, JSON codec
- Key files: `adapter/JpaScriptRepositoryAdapter.java`, `entity/ScriptEntity.java`, `StorageConfiguration.java`

**`actiondock-app-support/`:**
- Purpose: Infrastructure implementations that require Spring or external libraries. Contains all `@Configuration` classes.
- Contains: Script engines, plugin runtime, repository services, skill services, AI tool providers, schedule dispatcher
- Key files: `config/RuntimeConfiguration.java`, `script/RoutingScriptEngine.java`, `config/AiConfiguration.java`

**`actiondock-app-spring/`:**
- Purpose: Spring Boot application entry point and web layer. Serves REST API and static admin UI.
- Contains: `RuntimeApplication.java`, REST controllers, auth filter, global exception handler, schedulers
- Key files: `RuntimeApplication.java`, `web/common/GlobalExceptionHandler.java`, `auth/ApiKeyAuthFilter.java`

**`actiondock-ai-api/`:**
- Purpose: AI subsystem port interfaces. Defines contracts for AI gateway, tools, agent runtime, and models.
- Contains: Pure interfaces and model classes for AI features
- Key files: `AiGateway.java`, `AiTool.java`, `AiAgentRuntime.java`, `AiModelProfile.java`

**`actiondock-ai-core/`:**
- Purpose: AI subsystem service implementations. Business logic for AI agent orchestration, tool registry, model management.
- Contains: Service implementations that implement `actiondock-ai-api` interfaces
- Key files: `AiGatewayImpl.java`, `AiAgentRuntimeImpl.java`, `AiToolRegistryImpl.java`

**`actiondock-ai-agentscope/`:**
- Purpose: AgentScope provider implementation. Bridges to the AgentScope AI framework.
- Contains: `AiProviderClient` implementation, built-in AI tools
- Key files: `AgentScopeAiProviderClient.java`

**`actiondock-ai-plugin-bridge/`:**
- Purpose: Integrates the AI subsystem with the plugin system, exposing AI capabilities as an ActionDockPlugin.
- Contains: `ActionDockAiSystemPlugin` (implements `ActionDockPlugin`)
- Key files: `ActionDockAiSystemPlugin.java`

**`actiondock-plugin-api/`:**
- Purpose: Plugin system SPI. Defines the plugin extension point contract.
- Contains: `ActionDockPlugin` interface, manifest classes, plugin context
- Key files: `ActionDockPlugin.java`, `PluginManifest.java`

**`actiondock-plugin-template/`:**
- Purpose: Example plugin project demonstrating how to implement ActionDockPlugin.
- Contains: Demo plugin implementation
- Key files: `DemoActionDockPlugin.java`

**`actiondock-admin-ui/`:**
- Purpose: Browser-based admin console (React SPA). Built with Vite, Ant Design, React Query.
- Contains: Feature modules (pages + API), shared components, app shell, services
- Key files: `src/main.tsx`, `src/app/AppRoot.tsx`, `src/services/api.ts`

**`actiondock-cli/`:**
- Purpose: Node.js CLI for managing local ActionDock runtime. Built with Oclif.
- Contains: CLI commands, runtime build scripts, jdeploy desktop packaging config
- Key files: `package.json`, `bin/run.js`

## Key File Locations

**Entry Points:**
- `actiondock-app-spring/src/main/java/org/team4u/actiondock/RuntimeApplication.java`: Spring Boot main class
- `actiondock-admin-ui/src/main.tsx`: React SPA entry point
- `actiondock-cli/bin/run.js`: CLI executable
- `actiondock-cli/package.json`: CLI + jdeploy configuration

**Configuration:**
- `pom.xml`: Root Maven POM (module list, Java 21, Spring Boot 3.3.5)
- `actiondock-app-support/src/main/java/org/team4u/actiondock/config/RuntimeConfiguration.java`: Core bean wiring
- `actiondock-app-support/src/main/java/org/team4u/actiondock/config/ScriptConfiguration.java`: Script engine beans
- `actiondock-app-support/src/main/java/org/team4u/actiondock/config/AiConfiguration.java`: AI subsystem beans
- `actiondock-app-support/src/main/java/org/team4u/actiondock/config/EventConfiguration.java`: Event system beans
- `actiondock-app-support/src/main/java/org/team4u/actiondock/config/AppProperties.java`: Application properties
- `actiondock-app-spring/src/main/resources/application.yml`: Spring Boot configuration
- `actiondock-app-spring/src/main/resources/db/migration/`: Flyway database migrations (V1-V10)

**Core Domain:**
- `actiondock-core/src/main/java/org/team4u/actiondock/domain/model/ScriptDefinition.java`: Central script entity
- `actiondock-core/src/main/java/org/team4u/actiondock/domain/model/ExecutionRecord.java`: Execution tracking
- `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/ScriptEngine.java`: Script execution contract
- `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/ScriptRepository.java`: Script persistence contract

**Core Application Services:**
- `actiondock-core/src/main/java/org/team4u/actiondock/application/ExecutionApplicationService.java`: Script execution orchestration
- `actiondock-core/src/main/java/org/team4u/actiondock/application/ScriptApplicationService.java`: Script CRUD + publishing
- `actiondock-core/src/main/java/org/team4u/actiondock/application/EventIngestionApplicationService.java`: Webhook event ingestion
- `actiondock-core/src/main/java/org/team4u/actiondock/application/ScriptInvocationService.java`: Script cross-invocation

**Testing:**
- `actiondock-core/src/test/java/org/team4u/actiondock/application/`: Core application service tests
- `actiondock-app-spring/src/test/java/org/team4u/actiondock/web/`: Controller tests
- `actiondock-admin-ui/src/services/*.test.ts`: Frontend service tests
- `actiondock-admin-ui/src/app/navRegistry.test.tsx`: Navigation registry test

## Naming Conventions

**Files (Java backend):**
- Domain models: PascalCase, no suffix -- `ScriptDefinition.java`, `ExecutionRecord.java`
- Domain ports: Descriptive interface name -- `ScriptRepository.java`, `ScriptEngine.java`
- JPA adapters: `Jpa` prefix + port name + `Adapter` -- `JpaScriptRepositoryAdapter.java`
- JPA entities: Domain name + `Entity` -- `ScriptEntity.java`
- Spring Data repos: `SpringData` prefix + entity name + `Repository` -- `SpringDataScriptEntityRepository.java`
- Application services: Domain name + `ApplicationService` -- `ScriptApplicationService.java`
- Controllers: Domain name + `Controller` -- `ScriptController.java`
- Request/Response DTOs: Domain name + `Request`/`Response`/`View` -- `ExecuteRequest.java`, `ExecutionResponse.java`
- Configuration classes: Domain name + `Configuration` -- `ScriptConfiguration.java`
- Exceptions: Descriptive name + `Exception` -- `InvalidExecutionInputException.java`

**Files (Frontend):**
- Feature API files: `api.ts` inside each feature directory -- `features/scripts/api.ts`
- Feature pages: PascalCase -- `ScriptListPage.tsx`, `ScriptEditorPage.tsx`
- Shared components: PascalCase -- `CodeEditor.tsx`, `ErrorBoundary.tsx`
- Service utilities: camelCase -- `schemaForm.tsx`, `scriptDiff.ts`
- Custom hooks: `use` prefix -- `useBatchExecution.ts`, `usePollingExecution.ts`
- Test files: Co-located with source, `.test.ts` or `.test.tsx` suffix

**Directories (Java backend):**
- Package structure mirrors architecture layers: `domain/model/`, `domain/port/`, `application/`
- Web controllers grouped by domain: `web/script/`, `web/execution/`, `web/event/`, `web/ai/`

**Directories (Frontend):**
- Feature-based organization: `features/{domain}/pages/`, `features/{domain}/api.ts`
- Shared components grouped by concern: `components/common/`, `components/execution/`, `components/schema/`

## Where to Add New Code

**New domain model:**
- Model class: `actiondock-core/src/main/java/org/team4u/actiondock/domain/model/{Name}.java`
- Repository port: `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/{Name}Repository.java`
- JPA entity: `actiondock-storage-jpa/src/main/java/org/team4u/actiondock/storage/jpa/entity/{Name}Entity.java`
- Spring Data repo: `actiondock-storage-jpa/src/main/java/org/team4u/actiondock/storage/jpa/repo/SpringData{Name}Repository.java`
- JPA adapter: `actiondock-storage-jpa/src/main/java/org/team4u/actiondock/storage/jpa/adapter/Jpa{Name}RepositoryAdapter.java`

**New application service:**
- Service: `actiondock-core/src/main/java/org/team4u/actiondock/application/{Name}ApplicationService.java`
- Configuration bean: `actiondock-app-support/src/main/java/org/team4u/actiondock/config/{Name}Configuration.java`
- Import in `RuntimeConfiguration.java`: Add to `@Import({...})` list

**New REST endpoint:**
- Controller: `actiondock-app-spring/src/main/java/org/team4u/actiondock/web/{domain}/{Name}Controller.java`
- Request DTO: Same package as controller
- Response mapper: Same package as controller

**New frontend feature:**
- Feature directory: `actiondock-admin-ui/src/features/{domain}/`
- Pages: `features/{domain}/pages/{PageName}Page.tsx`
- API layer: `features/{domain}/api.ts`
- Register route: `actiondock-admin-ui/src/app/features.tsx`
- Re-export API: `actiondock-admin-ui/src/services/api.ts`

**New frontend component:**
- Shared: `actiondock-admin-ui/src/components/common/{ComponentName}.tsx`
- Domain-specific: `actiondock-admin-ui/src/components/{domain}/{ComponentName}.tsx`

**New script engine language:**
- Engine implementation: `actiondock-app-support/src/main/java/org/team4u/actiondock/script/{Language}ScriptEngine.java`
- Implement `ScriptEngine` interface from `actiondock-core`
- Register in `RoutingScriptEngine` and `ScriptConfiguration`

**New plugin:**
- Implement `ActionDockPlugin` from `actiondock-plugin-api`
- See `actiondock-plugin-template/` for example structure

**Database migration:**
- New file: `actiondock-app-spring/src/main/resources/db/migration/V{N+1}__{description}.sql`
- Never modify existing migration files

## Special Directories

**`actiondock-app-spring/src/main/resources/db/migration/`:**
- Purpose: Flyway database schema migrations
- Generated: No (manually written)
- Committed: Yes
- Naming: `V{version}__{description}.sql` (double underscore separator)

**`actiondock-cli/runtime/`:**
- Purpose: Bundled Spring Boot JAR for desktop distribution via jdeploy
- Generated: Yes (by `npm run build:runtime`)
- Committed: No (in .gitignore typically)

**`actiondock-cli/dist/`:**
- Purpose: Compiled TypeScript output for CLI
- Generated: Yes (by `npm run build`)
- Committed: No

**`actiondock-admin-ui/dist/`:**
- Purpose: Production build of React SPA
- Generated: Yes (by `npm run build`)
- Committed: No

**`actiondock-storage-jpa/src/main/resources/`:**
- Purpose: Not used (no resources directory in this module)
- Note: JPA entities are scanned via `@EntityScan` in `RuntimeApplication`

---

*Structure analysis: 2026-05-11*
