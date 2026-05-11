# External Integrations

**Analysis Date:** 2026-05-11

## AI Model Providers

**Multi-provider AI gateway via AgentScope 1.0.11:**
- Provider client implementation: `actiondock-ai-agentscope/src/main/java/org/team4u/actiondock/ai/agentscope/AgentScopeAiProviderClient.java`
- Model profile registry: `actiondock-ai-core/src/main/java/org/team4u/actiondock/ai/core/AiModelProfileService.java`

**Supported Providers (enum: `AiModelProvider`):**
- **OpenAI** - Chat, embedding, structured output, agent runs
- **OpenAI Compatible** - Any OpenAI-compatible API endpoint (e.g., Azure OpenAI, local LLM servers)
- **Anthropic** - Chat, agent runs (embedding not supported)
- **Gemini** - Chat, agent runs (embedding not supported)
- **DashScope** (Alibaba Cloud) - Chat, embedding, structured output, agent runs
- **Ollama** - Local LLM inference (no API key required), chat and embedding

**API Key Management:**
- API keys stored as Config Values in the database
- Resolved at call time via `AiSecretResolver` interface
- Implementation: `AiConfiguration.aiSecretResolver()` in `actiondock-app-support/src/main/java/org/team4u/actiondock/config/AiConfiguration.java`
- Keys referenced by config key name in model profile `apiKeyConfigKey` field

**AI Capabilities:**
- Chat completion (streaming supported)
- Structured output (JSON schema-based)
- Text embeddings (DashScope, OpenAI, Ollama only)
- ReAct agent runs with tool calling
- AI call logging and usage tracking (token counts, latency)

## Data Storage

**Database:**
- **H2 Database** (embedded, file-based)
  - Connection: `jdbc:h2:file:${app.home-dir}/data/actiondock;AUTO_SERVER=TRUE`
  - Config: `actiondock-app-support/src/main/resources/runtime-common.yml`
  - ORM: Spring Data JPA with Hibernate (ddl-auto: validate)
  - Schema migration: Flyway (10 versions, `V1` through `V10`)
  - Migration files: `actiondock-app-spring/src/main/resources/db/migration/`
  - Repositories: 29+ Spring Data JPA repositories in `actiondock-storage-jpa/src/main/java/org/team4u/actiondock/storage/jpa/repo/`
  - Adapters: Domain port implementations in `actiondock-storage-jpa/src/main/java/org/team4u/actiondock/storage/jpa/adapter/`

**Database Tables (from V1 bootstrap):**
- `ai_agent_profile`, `ai_agent_run`, `ai_agent_step`, `ai_call_log`, `ai_model_profile`, `ai_toolset`
- `api_access_token`, `config_value`, `execution`, `execution_preset`, `script`, `script_schedule`
- `event_source`, `event_trigger`, `event_record`, `event_dispatch`
- `plugin_registration`, `repository_definition`, `repository_tool_installation`, `repository_event_source_installation`
- `upstream_binding`, `skill_target`, `managed_skill`, `skill_installation`
- `capability_package_installation`, `shared_state`

**File Storage:**
- Local filesystem only
- Plugin JARs: `${app.home-dir}/plugins/`
- Python virtual environments: `${app.home-dir}/python-envs/`
- Repository working copies: `${app.home-dir}/` (managed by `RepositoryWorkspaceHelper`)
- Skills: `${app.home-dir}/skills/`

**Caching:**
- Groovy compiled script cache: Caffeine (via `CompiledGroovyScriptCache`, max 128 entries, 30 min expiry)
- Config value snapshot cache: In-memory snapshot (re-built on access)

## Authentication & Identity

**Auth Provider:**
- Custom API Key / Bearer Token authentication

**Implementation:**
- Filter: `ApiKeyAuthFilter` in `actiondock-app-spring/src/main/java/org/team4u/actiondock/auth/ApiKeyAuthFilter.java`
- Applies to all `/api/*` routes (except webhook event ingestion endpoints)
- Tokens stored in `api_access_token` database table
- Managed via `ApiAccessTokenApplicationService` in `actiondock-core/src/main/java/org/team4u/actiondock/application/ApiAccessTokenApplicationService.java`
- Tokens can be enabled/disabled; only enabled tokens are checked
- If no enabled tokens exist, all requests are allowed through (open-by-default)

**Webhook Authentication (event sources):**
- `WebhookAuthenticator` in `actiondock-core/src/main/java/org/team4u/actiondock/application/WebhookAuthenticator.java`
- Supports four modes (enum `EventSourceAuthMode`):
  - `HEADER_TOKEN` - Token in a configurable HTTP header
  - `QUERY_TOKEN` - Token in a query parameter
  - `HMAC_SHA256` - HMAC signature verification with optional timestamp anti-replay
  - `NONE` - No authentication
- Secrets resolved from Config Values via `ConfigValueApplicationService`

**Admin UI Authentication:**
- Bearer token stored in `localStorage` (key: `actiondock-admin-access-token`)
- Client: `actiondock-admin-ui/src/shared/auth/tokenStore.ts`
- Token attached to all API requests via `Authorization: Bearer` header

## Monitoring & Observability

**Error Tracking:**
- None (no external error tracking service)

**Health Checks:**
- Spring Boot Actuator: `/actuator/health`, `/actuator/info`
- Config: `management.endpoints.web.exposure.include: health,info`

**AI Call Logging:**
- All AI calls logged to `ai_call_log` table
- Tracked: model, provider, action type, token usage, latency, error details, prompt hash
- Implementation: `AiGatewayImpl.audit()` in `actiondock-ai-core/src/main/java/org/team4u/actiondock/ai/core/AiGatewayImpl.java`

**Logs:**
- SLF4J via Spring Boot default logging (Logback)
- Example: `RepositoryAutoSyncScheduler` logs sync results

## CI/CD & Deployment

**Hosting:**
- Desktop application via jdeploy (wraps Spring Boot JAR)
- jdeploy config in `actiondock-cli/package.json` under `"jdeploy"` key
- Produces native installers for macOS, Windows, Linux
- Singleton mode enforced (only one ActionDock instance running)

**CI Pipeline:**
- None detected (no `.github/workflows/`, no `Jenkinsfile`, no `.gitlab-ci.yml`)

**Build Process:**
- Backend: Maven multi-module build (`mvn package`)
- Frontend: Built during `prepare-package` phase via `exec-maven-plugin`
  - Runs `npm ci` then `npm run build` in `actiondock-admin-ui/`
  - Copies `dist/` to `actiondock-app-spring/target/classes/static/admin/`
- Final artifact: `actiondock-app-spring.jar` (Spring Boot fat JAR with embedded admin UI)

## Environment Configuration

**Required env vars:**
- None strictly required (application ships with sensible defaults)
- AI model API keys should be stored as Config Values via the admin UI or API

**Secrets location:**
- Database `config_value` table (encrypted or plain text depending on user setup)
- AI API keys referenced by config key name in model profiles
- Webhook secrets referenced by config key name in event source auth config

**App home directory structure:**
```
~/.actiondock/
  data/actiondock.mv.db       # H2 database file
  plugins/                     # Installed plugin JARs
  skills/                      # Installed skill packages
  python-envs/                 # Python virtual environments
```

## Webhooks & Callbacks

**Incoming Webhooks:**
- Event ingestion endpoint: `POST /api/event-sources/{id}/events`
- Controller: `actiondock-app-spring/src/main/java/org/team4u/actiondock/web/event/EventIngestionController.java`
- Accepts JSON and arbitrary content types
- Supports configurable auth modes (token, HMAC, none)
- Processes incoming events through normalization then dispatches to triggers
- Webhook event ingestion endpoints are exempt from API key authentication

**Outgoing Webhooks:**
- None detected (no outgoing HTTP webhook dispatch)

**Event Processing Pipeline:**
1. Event received at ingestion endpoint
2. `EventIngestionApplicationService` validates auth, normalizes payload
3. `EventSourceApplicationService` applies JSONPath processors to normalize events
4. `EventTriggerApplicationService` evaluates trigger conditions
5. Matched triggers execute associated scripts (sync or async)

## Git Repository Integration

**Repository Sync:**
- Git clone/pull operations via `GitCommandRunner`
- Implementation: `actiondock-app-support/src/main/java/org/team4u/actiondock/repository/RepositoryGitOperations.java`
- Supports branch-specific clone (`--single-branch`)
- Auto-sync scheduler: `RepositoryAutoSyncScheduler` (default interval: 1800 seconds)
- Commit and push for publishing: automatic git commit with version metadata

**Plugin Artifact Resolution:**
- HTTP/HTTPS download: `HttpPluginArtifactResolver` in `actiondock-app-support/src/main/java/org/team4u/actiondock/repository/HttpPluginArtifactResolver.java`
- Local file: `LocalPluginArtifactResolver` in `actiondock-app-support/src/main/java/org/team4u/actiondock/repository/LocalPluginArtifactResolver.java`

## API Documentation

**OpenAPI/Swagger:**
- springdoc-openapi 2.6.0
- Swagger UI: `/swagger-ui.html`
- Auto-generated from Spring MVC controller annotations

---

*Integration audit: 2026-05-11*
