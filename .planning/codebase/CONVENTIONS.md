# Coding Conventions

**Analysis Date:** 2026-05-11

## Overview

This is a polyglot codebase with three distinct technology stacks:
1. **Java 21** (backend: Spring Boot 3.3.5, DDD architecture)
2. **TypeScript/React 18** (admin UI: Vite + React)
3. **TypeScript/Node.js** (CLI: oclif)

Each stack follows its own conventions. Below are the observed patterns for each.

---

## Java Backend Conventions

### Naming Patterns

**Files:**
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

**Packages:**
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

**Functions/Methods:**
- camelCase for all methods
- Getter/setter pattern: standard `getX()` / `setX()` for entities, fluent builder `setX()` returning `this` for domain models

**Variables:**
- camelCase -- `scriptId`, `submitMode`, `cronExpression`

**Types/Enums:**
- PascalCase enum with UPPER_SNAKE_CASE values -- `ExecutionStatus.PENDING`, `ScriptType.GROOVY`

### Code Style

**Formatting:**
- No explicit checkstyle/checker configuration detected
- Standard Java formatting: 4-space indentation (inferred from source)
- No trailing whitespace, standard braces

**Linting:**
- No PMD, SpotBugs, or ErrorProne configuration detected in POM

### Import Organization

**Order:**
1. `org.team4u.actiondock.*` (project imports)
2. `org.springframework.*` (framework imports)
3. `jakarta.*` (EE imports)
4. Third-party imports
5. `java.*` / `javax.*` standard library

**No wildcard imports observed** -- all imports are explicit class-level.

### Domain Model Pattern (Fluent Setters)

Domain models use **fluent setters** (returning `this`) to enable method chaining:

```java
// From: actiondock-core/src/main/java/org/team4u/actiondock/domain/model/ScriptDefinition.java
ScriptDefinition definition = new ScriptDefinition()
    .setId("script-1")
    .setName("Hello")
    .setType(ScriptType.GROOVY)
    .setSource("return [:]")
    .setInputSchema(Map.of("type", "object"));
```

**Key characteristics:**
- Setters return `this` (the domain object type) for chaining
- Collections returned as unmodifiable views: `Collections.unmodifiableMap()`, `List.copyOf()`
- Defensive copies on collection input: `new ArrayList<>(list)`, `new LinkedHashMap<>(map)`
- Null-safe defaults in setters: `this.packaging = packaging == null ? ScriptPackaging.TOOL : packaging`
- Business logic lives on domain models (e.g., `publish()`, `mergeFrom()`, `toPublishedDefinition()`)

### JPA Entity Pattern

Entities use **standard JavaBean getters/setters** (void return, no chaining):

```java
// From: actiondock-storage-jpa/src/main/java/org/team4u/actiondock/storage/jpa/entity/ScriptEntity.java
public String getName() { return name; }
public void setName(String name) { this.name = name; }
```

**Key characteristics:**
- No Lombok -- all getters/setters are hand-written
- Single-line compact style for simple accessors
- JSON columns stored as `String` with `@Lob` annotation
- Enum values stored as `String` (`.name()`) not ordinal
- Table name and indexes declared via `@Table` annotation

### Constructor Injection

All services use **explicit constructor injection** (no `@Autowired` on fields):

```java
// From: actiondock-core/src/main/java/org/team4u/actiondock/application/ScriptApplicationService.java
public ScriptApplicationService(ScriptRepository scriptRepository,
                                ScriptEngine scriptEngine,
                                ScriptScheduleRepository scriptScheduleRepository,
                                UpstreamBindingRepository upstreamBindingRepository) {
    this.scriptRepository = scriptRepository;
    // ...
}
```

### Error Handling

**Domain validation:** `IllegalArgumentException` with Chinese-language messages:
```java
throw new IllegalArgumentException("脚本不存在: " + id);
throw new IllegalArgumentException("仅支持从仓库工具创建 Fork");
```

**Custom domain exceptions** extend `IllegalArgumentException`:
```java
// From: actiondock-core/src/main/java/org/team4u/actiondock/domain/exception/UpstreamConflictException.java
public class UpstreamConflictException extends IllegalArgumentException {
    private final String localAssetId;
    // ...
}
```

**Application exceptions** in the `application` package carry structured data:
- `InvalidExecutionInputException` -- field-level validation errors
- `InvalidPythonRequirementsException` -- Python dependency issues
- `StructuredExecutionException` -- execution failures with `ErrorDetail`
- `EventAuthenticationException` -- auth failures (401)

**Global exception handler** (`GlobalExceptionHandler`):
- `@RestControllerAdvice` catches all exceptions
- Maps exception types to HTTP status codes (400, 401, 413, 431, 500)
- Returns unified `ApiResponse<T>` envelope with `{ status, msg, data }` structure
- Fallback `Exception.class` handler returns 500 with `ErrorDetail` (type + stack trace)

### API Response Envelope

All REST endpoints return `ApiResponse<T>`:

```java
// From: actiondock-app-spring/src/main/java/org/team4u/actiondock/web/common/ApiResponse.java
ApiResponse.success(data)           // { status: 0, msg: "处理成功", data: ... }
ApiResponse.success(data, "msg")    // { status: 0, msg: "msg", data: ... }
ApiResponse.error("msg", 400, data) // { status: 400, msg: "msg", data: ... }
```

### Javadoc Conventions

**All public classes and methods have Chinese-language Javadoc.** The pattern is consistent:

```java
/**
 * 脚本应用服务，提供脚本定义的 CRUD 操作和发布管理。
 * <p>
 * 封装脚本创建、查询、更新、删除、发布、取消发布及脚本校验等业务逻辑，
 * 维护脚本的发布状态和版本号。
 *
 * @author jay.wu
 */
```

- Class-level: summary sentence, `<p>` paragraph with details, `@author` tag
- Method-level: summary, `<p>` details, `@param`, `@return`, `@throws`
- Package-private or private methods: sometimes documented, sometimes not
- Enums have Javadoc on each constant value

### Port/Adapter Pattern (Hexagonal Architecture)

**Ports** (interfaces in `domain.port`):
```java
// From: actiondock-core/src/main/java/org/team4u/actiondock/domain/port/ScriptRepository.java
public interface ScriptRepository {
    ScriptDefinition save(ScriptDefinition definition);
    Optional<ScriptDefinition> findById(String id);
    List<ScriptDefinition> findAll();
    void deleteById(String id);
}
```

**Adapters** (implementations in `storage.jpa.adapter`):
```java
// From: actiondock-storage-jpa/src/main/java/org/team4u/actiondock/storage/jpa/adapter/JpaScriptRepositoryAdapter.java
@Component
public class JpaScriptRepositoryAdapter implements ScriptRepository {
    private final SpringDataScriptEntityRepository repository;
    private final JsonCodec jsonCodec;
    // toEntity() / toDomain() conversion methods
}
```

**Base adapter class** provides standard CRUD template:
```java
// From: actiondock-storage-jpa/src/main/java/org/team4u/actiondock/storage/jpa/adapter/AbstractJpaRepositoryAdapter.java
public abstract class AbstractJpaRepositoryAdapter<E, D, R extends CrudRepository<E, String>> {
    public D save(D domain) { return toDomain(repository.save(toEntity(domain))); }
    // ...
    protected abstract E toEntity(D domain);
    protected abstract D toDomain(E entity);
}
```

---

## TypeScript Frontend Conventions (Admin UI)

### Naming Patterns

**Files:**
- React components: `PascalCase.tsx` -- `ExecutionLogPanel.tsx`, `ScriptEditorPage.tsx`
- API modules: `api.ts` (one per feature) -- `features/scripts/api.ts`
- Service modules: `camelCase.ts` -- `httpClient.ts`, `schema.ts`
- Test files: co-located with source using `.test.ts` or `.test.tsx` suffix -- `utils.test.ts`, `ExecutionLogPanel.test.tsx`
- Type definition files: `types.ts` or `index.ts` in shared directories
- Custom hooks: `use` prefix -- `useScriptExecution.ts`, `usePollingExecution.ts`
- Route files: `routes.tsx`

**Directories:**
- Feature-based organization under `src/features/<feature>/`
  - `api.ts` -- API calls for the feature
  - `pages/` -- Page-level components
  - `routes.tsx` -- Route definitions
- `src/components/` -- Shared components organized by domain
- `src/services/` -- Cross-feature service functions
- `src/shared/` -- Shared utilities, API client, auth, contexts, hooks
- `src/app/` -- Application shell, routing, theme
- `src/batch/` -- Batch execution logic

### Code Style

**TypeScript strict mode** enabled (`tsconfig.app.json`):
- `"strict": true`
- `"forceConsistentCasingInFileNames": true`
- `"noEmit": true` (build handled by Vite)
- `"jsx": "react-jsx"`
- `"module": "ESNext"`, `"moduleResolution": "Node"`

**No ESLint or Prettier configuration detected.** Formatting is implicit.

**No path aliases** -- all imports use relative paths (`../../shared/api/httpClient`).

### Import Organization

**Order (observed):**
1. External libraries (`vitest`, `react`)
2. Local types (`type { ... }`)
3. Local modules (relative paths)

```typescript
// From: actiondock-admin-ui/src/services/utils.test.ts
import { describe, expect, it } from "vitest";
import { toSingleLineCommand } from "./utils";
```

### API Client Pattern

All API calls go through a shared `request<T>()` function:

```typescript
// From: actiondock-admin-ui/src/shared/api/httpClient.ts
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Adds Authorization header from token store
  // Handles 401 by emitting auth-required event
  // Unwraps { status, msg, data } envelope, returns data
  // Throws ApiError on non-OK responses
}
```

**Feature API modules** are thin wrappers:
```typescript
// From: actiondock-admin-ui/src/features/scripts/api.ts
export function listScripts(): Promise<ScriptDefinition[]> {
  return request<ScriptDefinition[]>("/api/scripts?includeUiSchema=true");
}
```

**Barrel file** re-exports all feature APIs:
```typescript
// From: actiondock-admin-ui/src/services/api.ts
export * from "../features/scripts/api";
export * from "../features/ai/api";
// ...
```

### React Patterns

- **Functional components** only (no class components observed)
- **Custom hooks** for stateful logic (`useScriptExecution`, `usePollingExecution`)
- **@tanstack/react-query** for server state management
- **Ant Design (antd)** as the UI component library
- **React Router v6** for routing
- **Monaco Editor** for code editing

---

## TypeScript CLI Conventions

### Naming Patterns

**Files:**
- Commands: `src/commands/<topic>/<command>.ts` (oclif convention)
- Libraries: `src/lib/<module>.ts`
- Tests: `test/<module>.test.ts` (separate `test/` directory)

**Module format:** ESM (`"type": "module"`)

### Code Style

- Standard TypeScript with strict mode
- oclif framework conventions for CLI structure
- Uses `vi.stubGlobal("fetch", ...)` pattern for mocking globals in tests

---

## Cross-Cutting Conventions

### Commit Messages

Based on recent git log:
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

---

*Convention analysis: 2026-05-11*
