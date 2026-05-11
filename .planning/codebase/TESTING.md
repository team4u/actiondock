# Testing Patterns

**Analysis Date:** 2026-05-11

## Java Backend Testing

### Test Framework

**Runner:**
- JUnit 5 (`org.junit.jupiter.api`)
- Spring Boot Test (`@SpringBootTest`)
- Mockito (`org.mockito`)

**Assertion Library:**
- AssertJ (`org.assertj.core.api.Assertions`)

**Run Commands:**
```bash
# Run all tests across all modules
mvn test

# Run tests for a specific module with dependencies
mvn -pl actiondock-core -am -DskipTests compile
mvn -pl actiondock-core -am test

# Run a specific test class
mvn -pl actiondock-core -am -Dtest=ScriptApplicationServiceTest test

# Run a specific test method
mvn -pl actiondock-app-spring -am -Dtest=ScriptControllerTest#detailReturnsWrappedScriptDefinition test
```

### Test File Organization

**Location:**
- Co-located in standard Maven test directory: `src/test/java/`
- Mirrors the main source package structure

**Naming:**
- `<ClassName>Test.java` -- `ScriptApplicationServiceTest.java`, `ScriptControllerTest.java`
- No `IT` or `Integration` suffix convention (except one file: `SharedStorageIntegrationTest.java`)

**Structure:**
```
actiondock-core/src/test/java/org/team4u/actiondock/application/
    ScriptApplicationServiceTest.java
    ExecutionApplicationServiceTest.java
    EventIngestionApplicationServiceTest.java
    ...

actiondock-app-spring/src/test/java/org/team4u/actiondock/web/
    ScriptControllerTest.java
    ExecutionControllerTest.java
    ConfigValueControllerTest.java
    ...

actiondock-app-support/src/test/java/org/team4u/actiondock/
    script/GroovyScriptEngineTest.java
    script/PythonScriptEngineTest.java
    plugin/PluginRuntimeServiceTest.java
    ai/ActionDockDynamicAiToolProviderTest.java
    ...

actiondock-storage-jpa/src/test/java/org/team4u/actiondock/storage/jpa/
    adapter/JpaScriptRepositoryAdapterTest.java
    repo/SpringDataExecutionEntityRepositoryTest.java
    json/JacksonJsonCodecTest.java
    ...

actiondock-plugin-api/src/test/java/org/team4u/actiondock/plugin/api/
    PluginConfigBinderTest.java
    PluginManifestLoaderTest.java
```

### Test Structure

**Unit tests (core domain/application):**
```java
// From: actiondock-core/src/test/java/org/team4u/actiondock/application/ScriptApplicationServiceTest.java
class ScriptApplicationServiceTest {
    // 1. Mock all dependencies as fields
    private final ScriptRepository scriptRepository = mock(ScriptRepository.class);
    private final ScriptEngine scriptEngine = mock(ScriptEngine.class);
    private final ScriptScheduleRepository scriptScheduleRepository = mock(ScriptScheduleRepository.class);
    private final UpstreamBindingRepository upstreamBindingRepository = mock(UpstreamBindingRepository.class);

    // 2. Create service under test with mocks
    private final ScriptApplicationService service =
            new ScriptApplicationService(scriptRepository, scriptEngine, scriptScheduleRepository, upstreamBindingRepository);

    // 3. Each test is a named method describing the behavior
    @Test
    void saveSetsDefaultsForNewScript() {
        // 4. Arrange: configure mocks
        when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        // 5. Act
        ScriptDefinition saved = service.save(new ScriptDefinition()
                .setId("script-1")
                .setName("Hello")
                .setSource("return [:]")
                .setVersion(null)
                .setStatus(null));

        // 6. Assert with AssertJ
        assertThat(saved.getVersion()).isEqualTo(1);
        assertThat(saved.getStatus()).isEqualTo(ScriptStatus.DRAFT);
        assertThat(saved.getCreatedAt()).isNotNull();
    }
}
```

**Key patterns:**
- No `@BeforeEach`/`@AfterEach` unless needed (most tests use field-level mocks)
- No test runner annotation on class (JUnit 5 default)
- Test method names: `methodNameBehavior` in camelCase -- `saveSetsDefaultsForNewScript`, `publishMarksScriptAsPublishedAndIncrementsVersion`
- Arrange-Act-Assert structure (no explicit comments)

### Mocking

**Framework:** Mockito (static `mock()`, `when()`, `verify()`, `ArgumentCaptor`)

**Patterns:**

```java
// Standard mock creation
private final ScriptRepository scriptRepository = mock(ScriptRepository.class);

// Stubbing
when(scriptRepository.findById("script-1")).thenReturn(Optional.of(existing));
when(scriptRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

// Void stubbing
Mockito.doThrow(new IllegalArgumentException("missing"))
    .when(scriptApplicationService).validate("missing");

// Verification
verify(scriptScheduleRepository).deleteByScriptId("script-1");
verify(scriptEngine).validate(definition);

// Argument capture
ArgumentCaptor<ScriptSchedule> scheduleCaptor = ArgumentCaptor.forClass(ScriptSchedule.class);
verify(scriptScheduleRepository).save(scheduleCaptor.capture());
ScriptSchedule forkSchedule = scheduleCaptor.getValue();
assertThat(forkSchedule.getScriptId()).isEqualTo("tool-fork");
```

**What to Mock:**
- All domain port interfaces (`ScriptRepository`, `ScriptEngine`, `ExecutionRepository`)
- Application services in controller tests (`@MockBean`)

**What NOT to Mock:**
- Domain models (`ScriptDefinition`, `ExecutionRecord`) -- constructed directly with fluent setters
- Value objects and enums

### Spring Boot Controller Tests

```java
// From: actiondock-app-spring/src/test/java/org/team4u/actiondock/web/ScriptControllerTest.java
@SpringBootTest(
    classes = RuntimeApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.MOCK,
    properties = {
        "spring.config.name=does-not-exist",
        "server.port=0",
        "spring.datasource.url=jdbc:h2:mem:script-controller;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.open-in-view=false",
        "spring.h2.console.enabled=false",
        "app.execution.async-pool-size=1"
    }
)
@AutoConfigureMockMvc
@Import(GlobalExceptionHandler.class)
class ScriptControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ScriptApplicationService scriptApplicationService;

    @Test
    void detailReturnsWrappedScriptDefinition() throws Exception {
        when(scriptApplicationService.get("script-1")).thenReturn(new ScriptDefinition()
                .setId("script-1").setName("Hello"));

        mockMvc.perform(get("/api/scripts/script-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(0))
                .andExpect(jsonPath("$.data.id").value("script-1"));
    }
}
```

**Key characteristics:**
- Uses `@SpringBootTest` with `WebEnvironment.MOCK` (no real server)
- In-memory H2 with `create-drop` DDL strategy
- Application services mocked with `@MockBean`
- `MockMvc` for HTTP testing
- Hamcrest matchers for JSON path assertions (`jsonPath`, `containsString`)
- AssertJ for complex assertions
- `@Import(GlobalExceptionHandler.class)` to test exception handling

### Integration Tests

**Storage integration** tests verify JPA adapter round-tripping:
```java
// From: actiondock-storage-jpa/src/test/java/org/team4u/actiondock/storage/jpa/adapter/JpaScriptRepositoryAdapterTest.java
class JpaScriptRepositoryAdapterTest {
    @Test
    void saveSerializesAndFindByIdDeserializesScriptDefinition() {
        SpringDataScriptEntityRepository repository = mock(SpringDataScriptEntityRepository.class);
        AtomicReference<ScriptEntity> stored = new AtomicReference<>();
        when(repository.save(any())).thenAnswer(invocation -> {
            ScriptEntity entity = invocation.getArgument(0);
            stored.set(entity);
            return entity;
        });
        // ... tests entity <-> domain conversion
    }
}
```

**Full Spring context integration** test:
```java
// From: actiondock-app-spring/src/test/java/org/team4u/actiondock/SharedStorageIntegrationTest.java
class SharedStorageIntegrationTest {
    @TempDir
    Path tempDir;

    @Test
    void webAndCliContextsShareTheSameConfiguredStorage() {
        // Starts real Spring context with H2 file DB
        // Tests cross-context data sharing
    }
}
```

### Test Data Patterns

**No factory classes or fixtures detected.** Test data is constructed inline using fluent setters:

```java
ScriptDefinition definition = new ScriptDefinition()
    .setId("script-1")
    .setName("Hello")
    .setType(ScriptType.GROOVY)
    .setSource("return [:]")
    .setInputSchema(Map.of("type", "object"))
    .setStatus(ScriptStatus.DRAFT)
    .setVersion(1);
```

**Common test IDs:** `"script-1"`, `"exec-1"`, `"schedule-1"`, `"repo.tool"`, `"tool-fork"`

### Error Testing

```java
// Expected exception with AssertJ
assertThatThrownBy(() -> service.discardDraft("script-1"))
    .isInstanceOf(IllegalArgumentException.class)
    .hasMessage("脚本未发布: script-1");

// Does-not-throw pattern
assertThatCode(() -> engine.validate(new ScriptDefinition().setSource("return [:]")))
    .doesNotThrowAnyException();
```

### Coverage

**No coverage enforcement detected.** No JaCoCo or similar plugin in `pom.xml`.

---

## TypeScript Frontend Testing (Admin UI)

### Test Framework

**Runner:** Vitest 2.1.9

**Config:** No dedicated `vitest.config.ts` file (uses Vitest defaults)

**Assertion Library:** Vitest built-in (`expect`)

**Run Commands:**
```bash
cd actiondock-admin-ui
npm test          # Run all tests
npx vitest run    # Explicit vitest run
npx vitest        # Watch mode
```

### Test File Organization

**Location:** Co-located with source files using `.test.ts` / `.test.tsx` suffix

**Naming:**
- `<filename>.test.ts` -- `utils.test.ts`, `schema.test.ts`
- `<ComponentName>.test.tsx` -- `ExecutionLogPanel.test.tsx`

**Structure:**
```
actiondock-admin-ui/src/
    services/
        api.test.ts
        utils.test.ts
        schema.test.ts
        scriptDiff.test.ts
        ...
    batch/
        parser.test.ts
        session.test.ts
    components/
        execution/ExecutionLogPanel.test.tsx
        execution/ExecutionResultCard.test.tsx
        execution/BatchRunPanel.test.tsx
        schema/SchemaObjectResultView.test.tsx
        skill/SkillExamplePanel.test.tsx
        common/MarkdownDescription.test.tsx
    features/
        ai/pages/AiOverviewPage.test.tsx
        capabilities/pages/scriptEditor/types.test.ts
        capabilities/pages/scriptEditor/useScriptExecution.test.ts
        settings/pages/ConfigValueManagementPage.test.tsx
    app/
        navRegistry.test.tsx
```

### Test Structure

**Pure function tests:**
```typescript
// From: actiondock-admin-ui/src/services/utils.test.ts
import { describe, expect, it } from "vitest";
import { toSingleLineCommand } from "./utils";

describe("toSingleLineCommand", () => {
  it("flattens shell continuation lines for copy", () => {
    expect(
      toSingleLineCommand(`actiondock \\
  --base-url 'http://localhost:8080' \\
  scripts get 'hello-groovy'`)
    ).toBe("actiondock --base-url 'http://localhost:8080' scripts get 'hello-groovy'");
  });
});
```

**Component tests (static rendering):**
```typescript
// From: actiondock-admin-ui/src/components/execution/ExecutionLogPanel.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExecutionLogPanel } from "./ExecutionLogPanel";

describe("ExecutionLogPanel", () => {
  it("renders execution logs", () => {
    const html = renderToStaticMarkup(
      <ExecutionLogPanel logs={[...]} />
    );
    expect(html).toContain("执行日志");
    expect(html).toContain("INFO");
  });
});
```

**API client tests (with module mocking):**
```typescript
// From: actiondock-admin-ui/src/services/api.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getApiKeyMock = vi.fn();
vi.mock("./shared/auth/tokenStore", () => ({
  getApiKey: getApiKeyMock,
  emitAuthRequired: vi.fn()
}));

describe("api request auth handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("adds Authorization header when browser token exists", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 0, msg: "ok", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listScripts } = await import("./api");
    await listScripts();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });
});
```

### Mocking

**Framework:** Vitest built-in (`vi.fn()`, `vi.mock()`, `vi.stubGlobal()`)

**Patterns:**

```typescript
// Module mock
vi.mock("./shared/auth/tokenStore", () => ({
  getApiKey: getApiKeyMock,
  emitAuthRequired: emitAuthRequiredMock
}));

// Global stub
vi.stubGlobal("fetch", fetchMock);

// Dynamic import after mock setup
const { listScripts } = await import("./api");

// Cleanup
vi.clearAllMocks();
vi.resetModules();
vi.unstubAllGlobals();
```

**What to Mock:**
- `fetch` global (via `vi.stubGlobal`)
- Module dependencies (via `vi.mock`)
- Auth token store

**What NOT to Mock:**
- Pure functions under test
- React component rendering (tests use `renderToStaticMarkup`)

### Fixtures and Test Data

**No shared fixture files.** Test data is defined inline in each test:

```typescript
const baseDetail: ConfigValueDetail = {
  key: "openai.api_key",
  value: "sk-live",
  valueMasked: "sk-****",
  // ...
};
```

### Coverage

**No coverage enforcement detected.** No `@vitest/coverage` in dependencies.

---

## TypeScript CLI Testing

### Test Framework

**Runner:** Vitest 4.0.3

**Config:** No dedicated `vitest.config.ts`

**Run Commands:**
```bash
cd actiondock-cli
npm test          # Runs 'pretest' (build) then 'vitest run'
npx vitest run
```

### Test File Organization

**Location:** Separate `test/` directory (not co-located)

**Structure:**
```
actiondock-cli/
    test/
        cli.test.ts       # Integration tests with HTTP mock server
        input.test.ts
        runtime.test.ts
        schema.test.ts
        update-env.test.ts
    src/lib/
        event.test.ts     # Co-located unit test
```

### Test Structure

**CLI integration tests** use a real HTTP mock server and spawn the CLI as a child process:

```typescript
// From: actiondock-cli/test/cli.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: http.Server;
let baseUrl = "";
const requests: Array<{...}> = [];

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    // Mock API responses
    if (req.method === "GET" && req.url === "/api/scripts") {
      return json(res, { status: 0, msg: "ok", data: [...] });
    }
  });
});

afterAll(() => { server.close(); });
```

**Unit tests** follow standard Vitest patterns:
```typescript
// From: actiondock-cli/src/lib/event.test.ts
import { describe, expect, it } from "vitest";
import { applyProcessorFieldOverrides, mergeDefinitionPatch } from "./event.js";

describe("applyProcessorFieldOverrides", () => {
  it("clears event trigger processor fields when patch uses empty objects", () => {
    // Arrange, Act, Assert
  });
});
```

---

## Test Counts

| Module | Test Files | Type |
|--------|-----------|------|
| `actiondock-core` | 13 | Unit (Mockito) |
| `actiondock-app-spring` | 18 | Unit (MockMvc) + Integration |
| `actiondock-app-support` | 12 | Unit (Mockito) |
| `actiondock-storage-jpa` | 7 | Unit (adapter) + Repo |
| `actiondock-plugin-api` | 2 | Unit |
| `actiondock-admin-ui` | 44 | Unit (Vitest) |
| `actiondock-cli` | 6 | Unit + Integration (Vitest) |
| **Total** | **~102** | |

---

## Common Patterns Summary

**Java unit test template:**
```java
class XyzServiceTest {
    private final Dependency dep = mock(Dependency.class);
    private final XyzService service = new XyzService(dep);

    @Test
    void methodDoesExpectedBehavior() {
        when(dep.find(any())).thenReturn(Optional.of(existing));
        Result result = service.doSomething("id");
        assertThat(result.getValue()).isEqualTo(expected);
    }
}
```

**TypeScript unit test template:**
```typescript
import { describe, expect, it } from "vitest";
import { functionUnderTest } from "./module";

describe("functionUnderTest", () => {
  it("describes the expected behavior", () => {
    const result = functionUnderTest(input);
    expect(result).toEqual(expected);
  });
});
```

---

*Testing analysis: 2026-05-11*
