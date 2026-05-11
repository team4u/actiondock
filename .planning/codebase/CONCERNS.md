# Codebase Concerns

**Analysis Date:** 2026-05-11

## Tech Debt

### Unbounded `findAll()` Queries Across All Repositories

- Issue: Every repository interface in `actiondock-core` defines a parameterless `findAll()` method, and all application services call it without pagination. As data grows, these queries will load entire tables into memory.
- Files:
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/ScriptRepository.java`
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/ExecutionRecordRepository.java` (inferred from usage)
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/EventSourceRepository.java`
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/EventTriggerRepository.java`
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/EventRecordRepository.java`
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/ScriptScheduleRepository.java`
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/ConfigValueRepository.java`
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/SharedStateRepository.java`
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/ApiAccessTokenRepository.java`
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/UpstreamBindingRepository.java`
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/SkillTargetRepository.java`
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/SkillInstallationRepository.java`
  - `actiondock-core/src/main/java/org/team4u/actiondock/domain/port/PluginRegistryRepository.java`
- Impact: Memory exhaustion, slow API responses as tables grow. Controllers like `ExecutionController.list()`, `EventSourceController`, and `ScriptController` return unbounded lists.
- Fix approach: Introduce paginated query methods (`findAll(Pageable)`, `findByScriptId(scriptId, Pageable)`) and update controllers to accept page/size parameters.

### God Class: RepositoryCatalogService (1011 lines)

- Issue: `RepositoryCatalogService` handles repository discovery, plugin publishing, skill installation, capability package management, AI package dependency collection, and file I/O. This violates single responsibility and makes the class fragile to modify.
- Files: `actiondock-app-support/src/main/java/org/team4u/actiondock/repository/RepositoryCatalogService.java`
- Impact: High cognitive load for any change; regression risk when modifying any sub-feature.
- Fix approach: Extract into focused services: `RepositoryPluginService` (partially exists), `RepositorySkillService` (partially exists), `RepositoryCapabilityPackageService` (partially exists), `RepositoryAiPackageService` (partially exists). Each should own its own index file reading and validation logic.

### God Class: RepositoryCatalogTypes (995 lines)

- Issue: All repository-related DTOs, manifests, and request/response types are in a single file with 15+ inner records/classes.
- Files: `actiondock-app-support/src/main/java/org/team4u/actiondock/repository/RepositoryCatalogTypes.java`
- Impact: Compilation cost, merge conflicts, poor discoverability.
- Fix approach: Split into separate type files by domain: `RepositoryIndex.java`, `PluginIndexEntry.java`, `SkillManifest.java`, `CapabilityPackageManifest.java`, etc.

### Frontend Monolith Page: RepositoryDiscoveryPage (2075 lines)

- Issue: Single React component at 2075 lines handling repository browsing, discovery, and installation UI.
- Files: `actiondock-admin-ui/src/features/resources/pages/RepositoryDiscoveryPage.tsx`
- Impact: Hard to maintain, test, and render. Any UI change risks regressions in unrelated sections.
- Fix approach: Extract into composable hooks and sub-components: `useRepositoryDiscovery`, `RepositoryBrowser`, `ToolInstallDialog`, `SkillInstallDialog`, `CapabilityPackageInstallDialog`.

### Unbounded Mustache Template Cache

- Issue: `DefaultProcessorEngine` uses a `ConcurrentHashMap<String, Mustache>` as a template cache with no eviction policy. Every unique template string is cached forever.
- Files: `actiondock-app-support/src/main/java/org/team4u/actiondock/processor/DefaultProcessorEngine.java`
- Impact: Memory leak if templates vary dynamically (e.g., user-configured processor templates).
- Fix approach: Add LRU eviction or bounded size limit, similar to `CompiledGroovyScriptCache`.

### ScriptDefinition Model Class (526 lines)

- Issue: The core domain model `ScriptDefinition` is a large mutable entity with 526 lines, mixing domain logic, publishing state, Groovy/Python concerns, and packaging metadata.
- Files: `actiondock-core/src/main/java/org/team4u/actiondock/domain/model/ScriptDefinition.java`
- Impact: High coupling; any change to script handling risks breaking unrelated features.
- Fix approach: Extract value objects for `PythonRequirements`, `PluginDependencies`, `OutputSchema`, `Packaging` metadata.

## Known Bugs

### Swallowed Exception in Fatal Error Handler

- Symptoms: When a fatal error occurs during execution, the error record save silently fails with no logging.
- Files: `actiondock-core/src/main/java/org/team4u/actiondock/application/ExecutionApplicationService.java:218`
- Trigger: Any exception thrown inside `markFailedOnFatalError()` catch block (e.g., DB connection failure).
- Workaround: None. The failure goes completely unreported.

### Event Ingestion Endpoint Bypasses Authentication

- Symptoms: POST to `/api/event-sources/{id}/events` is explicitly excluded from API key authentication in `ApiKeyAuthFilter.shouldNotFilter()`.
- Files:
  - `actiondock-app-spring/src/main/java/org/team4u/actiondock/auth/ApiKeyAuthFilter.java:36-37`
  - `actiondock-app-spring/src/main/java/org/team4u/actiondock/web/event/EventIngestionController.java:30`
- Trigger: Any POST request to the webhook endpoint with a valid event source ID.
- Workaround: None. This is intentional for webhook receivers but means anyone who knows or guesses an event source ID can post events.

### TODO Comments in Plugin Preset Templates

- Symptoms: Three TODO comments indicate incomplete implementation in processor script presets.
- Files: `actiondock-admin-ui/src/components/plugin/processorScriptPresets.ts:110,127,139`
- Trigger: When users create processor plugins using the preset templates, the generated code has placeholder logic.
- Workaround: Manual adjustment of generated script code after creation.

## Security Considerations

### No Rate Limiting on Any Endpoint

- Risk: Unauthenticated webhook endpoint and all authenticated endpoints lack rate limiting. An attacker can flood the event ingestion endpoint or exhaust execution resources.
- Files:
  - `actiondock-app-spring/src/main/java/org/team4u/actiondock/web/event/EventIngestionController.java`
  - `actiondock-app-spring/src/main/java/org/team4u/actiondock/web/execution/ExecutionController.java`
- Current mitigation: Only API key auth filter (optional, skipped when no tokens configured).
- Recommendations: Add Spring's `RateLimiter` or bucket4j filter. At minimum, rate-limit the unauthenticated webhook endpoint.

### No Request Body Size Limits

- Risk: No `@Size` constraints, no `server.max-http-header-size`, no `spring.servlet.multipart.max-file-size` configuration detected. Large payloads can cause OOM.
- Files: All controller classes in `actiondock-app-spring/src/main/java/org/team4u/actiondock/web/`.
- Current mitigation: None detected.
- Recommendations: Configure `server.tomcat.max-http-form-post-size`, add `@Size` validation on request DTOs, and set Spring's max request size.

### No Input Validation Annotations on Controller DTOs

- Risk: Controller request bodies (`@RequestBody`) have no `@Valid`, `@NotNull`, or `@NotBlank` annotations. All validation is deferred to service layer manual checks.
- Files: All `*Controller.java` files in `actiondock-app-spring/src/main/java/org/team4u/actiondock/web/`.
- Current mitigation: Service layer throws `IllegalArgumentException` for blank/null inputs.
- Recommendations: Add Jakarta Bean Validation annotations to request DTOs and `@Valid` on controller method parameters.

### CORS Allows All Origins by Default

- Risk: CORS configuration defaults to allowing all origins. If deployed publicly with API tokens, any website can make authenticated requests.
- Files: `actiondock-app-spring/src/main/java/org/team4u/actiondock/config/WebCorsConfiguration.java`
- Current mitigation: Configurable via `app.cors.allowed-origins`, but must be explicitly set by operator.
- Recommendations: Default to restrictive origins (empty) and require explicit configuration for allowed origins.

### Subprocess Execution Without Sandboxing

- Risk: Python and Groovy scripts are executed as OS processes with no resource limits (CPU, memory, filesystem access) beyond timeout. Scripts can access the filesystem, network, and environment variables of the host process.
- Files:
  - `actiondock-app-support/src/main/java/org/team4u/actiondock/script/PythonScriptEngine.java`
  - `actiondock-app-support/src/main/java/org/team4u/actiondock/script/GroovyScriptEngine.java` (inferred from `CompiledGroovyScriptCache`)
  - `actiondock-app-support/src/main/java/org/team4u/actiondock/script/ProcessSupport.java`
- Current mitigation: Timeout enforcement via `process.waitFor(timeout)`.
- Recommendations: Run scripts in containers or with OS-level resource limits (cgroups, ulimit). At minimum, restrict environment variables passed to subprocesses.

### Git Command Injection Surface

- Risk: `GitCommandRunner` constructs commands as `List<String>` (not shell strings), which mitigates shell injection. However, the `workdir` path and command arguments are constructed from repository configuration that could be manipulated.
- Files: `actiondock-app-support/src/main/java/org/team4u/actiondock/repository/GitCommandRunner.java`
- Current mitigation: `ProcessBuilder` list-based API avoids shell injection. Path traversal is protected by `safeResolvePath()`.
- Recommendations: Validate that git commands only contain expected subcommands. Consider running git operations in a chroot or container.

## Performance Bottlenecks

### `ForkJoinPool.commonPool()` Used for Script I/O

- Problem: Both `PythonScriptEngine` and `PythonEnvironmentManager` default to `ForkJoinPool.commonPool()` for async stream reading. This pool is shared across the JVM and has a limited thread count (CPU cores - 1). Under concurrent script execution, this becomes a bottleneck.
- Files:
  - `actiondock-app-support/src/main/java/org/team4u/actiondock/script/PythonScriptEngine.java:121`
  - `actiondock-app-support/src/main/java/org/team4u/actiondock/script/PythonEnvironmentManager.java:71`
- Cause: Using the JVM's common fork-join pool for I/O-bound async tasks.
- Improvement path: Use a dedicated bounded thread pool (like `executionExecutor` from `RuntimeConfiguration`) for stream reading, or a dedicated I/O executor.

### Fixed-Size Thread Pool for Execution

- Problem: `RuntimeConfiguration` creates a `newFixedThreadPool` with configurable size. Under load spikes, tasks queue indefinitely and there is no rejection policy or backpressure mechanism.
- Files: `actiondock-app-support/src/main/java/org/team4u/actiondock/config/RuntimeConfiguration.java:59`
- Cause: `Executors.newFixedThreadPool()` uses an unbounded `LinkedBlockingQueue`.
- Improvement path: Use a bounded `ThreadPoolExecutor` with a `CallerRunsPolicy` or custom rejection handler to provide backpressure.

### ConfigValue Loaded on Every Execution

- Problem: `ConfigPlaceholderResolver` calls `configValueRepository.findAll()` on every resolution. `ExecutionApplicationService` calls this for every script execution, loading all config values from the database each time.
- Files:
  - `actiondock-core/src/main/java/org/team4u/actiondock/application/ConfigPlaceholderResolver.java:118`
  - `actiondock-core/src/main/java/org/team4u/actiondock/application/ConfigValueApplicationService.java:70`
- Cause: No caching layer for config values.
- Improvement path: Add an in-memory cache with TTL or event-driven invalidation for config values.

## Fragile Areas

### PluginRuntimeService (689 lines) with Complex Lock Management

- Files: `actiondock-app-support/src/main/java/org/team4u/actiondock/plugin/PluginRuntimeService.java`
- Why fragile: Uses `ReentrantReadWriteLock` with manual lock/unlock patterns via `withReadLock`/`withWriteLock`. Plugin upgrade has a multi-step rollback mechanism (`rollbackUpgrade`) that can leave the system in an inconsistent state if rollback itself fails (logged at ERROR level). Startup plugin loading catches and logs all exceptions, silently continuing with missing plugins.
- Safe modification: Always test with concurrent plugin install/upgrade/uninstall operations. Review lock acquisition order carefully.
- Test coverage: Has `PluginRuntimeServiceTest.java` (772 lines) which is good, but does not appear to cover concurrent scenarios.

### Event Source Application Service (Modified, Uncommitted)

- Files: `actiondock-core/src/main/java/org/team4u/actiondock/application/EventSourceApplicationService.java`
- Why fragile: Currently has uncommitted modifications. Contains logic for event source CRUD and webhook response configuration. The `return null` at line 168 suggests a code path where a result is unexpectedly absent.
- Safe modification: Review uncommitted changes before any modification.
- Test coverage: `EventSourceApplicationServiceTest.java` exists but is newly created (untracked in git status).

### Python Script Bridge Protocol

- Files:
  - `actiondock-app-support/src/main/java/org/team4u/actiondock/script/PythonBridge.java`
  - `actiondock-app-support/src/main/java/org/team4u/actiondock/script/PythonScriptEngine.java`
  - `actiondock-app-support/src/main/java/org/team4u/actiondock/script/ProcessSupport.java`
- Why fragile: Communication between Java and Python processes relies on a fragile text-based protocol over stdin/stderr with magic prefixes (`__ACTIONDOCK_INVOKE__`, `__ACTIONDOCK_PLUGIN__`, `__ACTIONDOCK_STATE__`). If a user script happens to print these prefixes to stderr, it could be misinterpreted as a bridge message. Error handling in `ProcessSupport.parseLogEvent()` silently ignores malformed JSON (`catch (Exception ignored)`).
- Safe modification: Any change to the bridge protocol must be synchronized with the Python wrapper template (`python-wrapper.py` resource).
- Test coverage: `PythonScriptEngineTest.java` (532 lines) provides good coverage but does not test protocol collision scenarios.

### Script Schedule Dispatcher with `synchronized` Methods

- Files: `actiondock-app-support/src/main/java/org/team4u/actiondock/schedule/ScriptScheduleDispatcher.java`
- Why fragile: Uses method-level `synchronized` for all schedule management operations. If any operation blocks (e.g., waiting for a running task to complete), all other schedule operations are blocked. The `refreshAll()` method iterates and cancels schedules while holding the lock.
- Safe modification: Avoid introducing any blocking operations inside synchronized methods.
- Test coverage: `ScheduleApplicationServiceTest.java` exists but does not test concurrent scheduling.

## Scaling Limits

### Unbounded Execution Records

- Current capacity: `ExecutionRecordRepository.findAll()` and `ExecutionController.list()` return all records. No TTL or archival mechanism detected.
- Limit: Database table growth will cause slow queries and memory pressure on list endpoints.
- Scaling path: Add pagination to list endpoints. Implement execution record archival/cleanup (e.g., auto-delete records older than N days).

### Single-Node Execution Model

- Current capacity: `ExecutionApplicationService` uses a fixed-size thread pool for async execution. No distributed execution support.
- Limit: Bounded by single JVM memory and CPU. Cannot scale horizontally for execution.
- Scaling path: Consider a message queue (RabbitMQ, Redis Streams) for execution dispatch if horizontal scaling is needed.

### Shared State Stored in Database

- Current capacity: `SharedStateApplicationService` stores all shared state in a single database table with optional TTL expiration.
- Limit: High-frequency state access (e.g., from Python scripts via the bridge protocol) will hit the database on every read/write.
- Scaling path: Add an in-memory cache layer (e.g., Caffeine) for frequently accessed state entries.

## Dependencies at Risk

### AgentScope AI Provider Client (556 lines, No Tests)

- Risk: The core AI integration client (`AgentScopeAiProviderClient`) has zero test coverage. This module handles API key resolution, model configuration, and multi-provider chat model creation (OpenAI, Anthropic, Gemini, DashScope).
- Files: `actiondock-ai-agentscope/src/main/java/org/team4u/actiondock/ai/agentscope/AgentScopeAiProviderClient.java`
- Impact: Any regression in AI model configuration breaks all AI-dependent features silently.
- Migration plan: Add unit tests for `resolveApiKey()`, model building, and provider selection logic.

### Entire AI API Module Has Zero Tests (52 production files)

- Risk: `actiondock-ai-api` contains 52 production classes (profiles, tools, agents, run records, permissions) with zero test files.
- Files: All files under `actiondock-ai-api/src/main/java/org/team4u/actiondock/ai/api/`
- Impact: The AI subsystem's domain model and API contracts are completely untested.
- Migration plan: Start with tests for `AiToolPermission`, `AiAgentProfile`, and `AiModelProfile` value objects.

### AI Core Module Has Zero Tests (7 production files)

- Risk: `actiondock-ai-core` contains the AI runtime policy and core services with no test coverage.
- Files: All files under `actiondock-ai-core/src/main/java/org/team4u/actiondock/ai/core/`
- Impact: Runtime policy enforcement (tool permissions, agent behavior) is untested.
- Migration plan: Add tests for runtime policy evaluation and agent lifecycle.

## Missing Critical Features

### No Pagination on Any List Endpoint

- Problem: All controller list endpoints return unbounded `List<T>` responses. No `Page<T>`, no `limit`/`offset` parameters.
- Blocks: Cannot deploy to production with significant data volumes without risk of OOM or slow responses.
- Files: All controller classes returning `List<?>` in `actiondock-app-spring/src/main/java/org/team4u/actiondock/web/`.

### No Audit Logging

- Problem: No audit trail for configuration changes, script modifications, plugin installations, or user actions. Security-sensitive operations (API token creation, plugin install/uninstall) are not logged.
- Blocks: Cannot trace who changed what and when. Compliance requirements cannot be met.
- Files: Application service classes across `actiondock-core` and `actiondock-app-support`.

### No Frontend Component Tests

- Problem: Frontend test files exist only for service/utility functions (20 test files in `actiondock-admin-ui/src/services/` and `src/batch/`). No component tests exist for any React components or pages.
- Blocks: UI regressions can only be caught manually. Refactoring UI components is risky.
- Files: `actiondock-admin-ui/src/components/`, `actiondock-admin-ui/src/features/`.

### No Error Monitoring / Alerting

- Problem: No Sentry, no Prometheus metrics, no health check endpoints detected. The only observability is SLF4J log output.
- Blocks: Production issues are only visible by tailing logs.
- Recommendations: Add Spring Boot Actuator health endpoints, consider Prometheus/Grafana for metrics, and Sentry for error tracking.

## Test Coverage Gaps

### AI Subsystem: Zero Test Coverage

- What's not tested: All 64 production files across `actiondock-ai-api` (52 files), `actiondock-ai-core` (7 files), `actiondock-ai-agentscope` (4 files), and `actiondock-ai-plugin-bridge` (1 file).
- Files: `actiondock-ai-api/src/main/java/`, `actiondock-ai-core/src/main/java/`, `actiondock-ai-agentscope/src/main/java/`, `actiondock-ai-plugin-bridge/src/main/java/`
- Risk: AI agent execution, tool permissions, model configuration, and provider client logic are completely untested.
- Priority: High

### Plugin Template Module: Zero Test Coverage

- What's not tested: `actiondock-plugin-template` has 3 production files with 0 test files.
- Files: `actiondock-plugin-template/src/main/java/`
- Risk: Plugin template generation may produce incorrect artifacts.
- Priority: Medium

### CLI Module: No Test Files Detected

- What's not tested: `actiondock-cli` module has production code but no test files were found.
- Files: `actiondock-cli/src/`
- Risk: CLI commands may fail silently.
- Priority: Medium

### Frontend: Only Service-Layer Tests

- What's not tested: All React components, pages, hooks, and contexts. Only utility/service functions are tested.
- Files: `actiondock-admin-ui/src/components/`, `actiondock-admin-ui/src/features/`, `actiondock-admin-ui/src/shared/hooks/`, `actiondock-admin-ui/src/shared/contexts/`
- Risk: UI rendering bugs, form validation issues, and navigation errors go undetected.
- Priority: High

### Only One Integration Test

- What's not tested: End-to-end request flow (HTTP request to response) is covered by only `SharedStorageIntegrationTest.java`. No integration tests for script execution, event ingestion, plugin lifecycle, or AI agent execution.
- Files: `actiondock-app-spring/src/test/java/org/team4u/actiondock/SharedStorageIntegrationTest.java`
- Risk: Component interactions may break when multiple services are wired together.
- Priority: High

---

*Concerns audit: 2026-05-11*
