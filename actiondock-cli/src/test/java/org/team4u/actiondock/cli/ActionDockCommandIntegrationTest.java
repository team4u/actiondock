package org.team4u.actiondock.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintStream;
import java.io.PrintWriter;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class ActionDockCommandIntegrationTest {
    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @TempDir
    Path tempHome;

    private TestServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.close();
        }
    }

    @Test
    void scriptsListUsesResolvedBaseUrlAndBearerToken() throws Exception {
        server = new TestServer();
        AtomicReference<CapturedRequest> requestRef = new AtomicReference<>();
        server.register("GET", "/api/scripts", request -> {
            requestRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"Success","data":[{"id":"hello"}]}
                    """);
        });

        ExecutionResult result = execute("scripts", "list");

        assertThat(result.exitCode()).isEqualTo(0);
        assertThat(requestRef.get().query()).isEqualTo("includeUiSchema=true");
        assertThat(requestRef.get().headers().getFirst("Authorization")).isEqualTo("Bearer test-token");
        assertThat(result.stderr()).isBlank();
        assertThat(parseJson(result.stdout()).path("data")).hasSize(1);
    }

    @Test
    void executionsSubmitWaitPollsUntilTerminalStatus() throws Exception {
        server = new TestServer();
        AtomicReference<CapturedRequest> submitRef = new AtomicReference<>();
        AtomicInteger pollCount = new AtomicInteger();
        server.register("POST", "/api/executions", request -> {
            submitRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"Accepted","data":{"id":"exec-1","status":"PENDING"}}
                    """);
        });
        server.register("GET", "/api/executions/exec-1", request -> {
            int current = pollCount.incrementAndGet();
            if (current == 1) {
                return Response.json(200, """
                        {"status":0,"msg":"Success","data":{"id":"exec-1","status":"RUNNING"}}
                        """);
            }
            return Response.json(200, """
                    {"status":0,"msg":"Success","data":{"id":"exec-1","status":"SUCCESS","output":{"ok":true}}}
                    """);
        });

        ExecutionResult result = execute(
                "executions", "submit",
                "--script-id", "hello",
                "--input", "{\"name\":\"Alice\"}",
                "--mode", "ASYNC",
                "--wait",
                "--poll-interval-ms", "0"
        );

        assertThat(result.exitCode()).isEqualTo(0);
        assertThat(submitRef.get().headers().getFirst("Authorization")).isEqualTo("Bearer test-token");
        assertThat(parseJson(submitRef.get().body()).path("mode").asText()).isEqualTo("ASYNC");
        assertThat(parseJson(result.stdout()).path("data").path("status").asText()).isEqualTo("SUCCESS");
        assertThat(pollCount.get()).isGreaterThanOrEqualTo(2);
    }

    @Test
    void executionsSubmitAcceptsCompleteRequestBodyFile() throws Exception {
        server = new TestServer();
        AtomicReference<CapturedRequest> submitRef = new AtomicReference<>();
        server.register("POST", "/api/executions", request -> {
            submitRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"Accepted","data":{"id":"exec-1","status":"SUCCESS"}}
                    """);
        });
        Path requestFile = tempHome.resolve("execution-request.json");
        Files.writeString(requestFile, """
                {"scriptId":"hello","input":{"name":"Alice"},"mode":"ASYNC","responseView":"DEBUG"}
                """);

        ExecutionResult result = execute("executions", "submit", "--file", requestFile.toString());

        assertThat(result.exitCode()).isEqualTo(0);
        JsonNode body = parseJson(submitRef.get().body());
        assertThat(body.path("scriptId").asText()).isEqualTo("hello");
        assertThat(body.path("input").path("name").asText()).isEqualTo("Alice");
        assertThat(body.path("mode").asText()).isEqualTo("ASYNC");
        assertThat(body.path("responseView").asText()).isEqualTo("DEBUG");
    }

    @Test
    void scriptsExecutePublishedAcceptsCompleteRequestBodyFile() throws Exception {
        server = new TestServer();
        AtomicReference<CapturedRequest> requestRef = new AtomicReference<>();
        server.register("POST", "/api/scripts/hello/published/execute", request -> {
            requestRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"Accepted","data":{"id":"exec-1","status":"SUCCESS"}}
                    """);
        });
        Path requestFile = tempHome.resolve("published-execute-request.json");
        Files.writeString(requestFile, """
                {"input":{"name":"Alice"},"mode":"SYNC","responseView":"RESULT"}
                """);

        ExecutionResult result = execute("scripts", "execute-published", "hello", "--file", requestFile.toString());

        assertThat(result.exitCode()).isEqualTo(0);
        JsonNode body = parseJson(requestRef.get().body());
        assertThat(body.path("input").path("name").asText()).isEqualTo("Alice");
        assertThat(body.path("mode").asText()).isEqualTo("SYNC");
        assertThat(body.path("responseView").asText()).isEqualTo("RESULT");
    }

    @Test
    void pluginsInvokeAcceptsCompleteRequestBodyFile() throws Exception {
        server = new TestServer();
        AtomicReference<CapturedRequest> requestRef = new AtomicReference<>();
        server.register("POST", "/api/plugins/plugin-a/actions/summarize/invoke", request -> {
            requestRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"Plugin invoked","data":{"result":{"ok":true}}}
                    """);
        });
        Path requestFile = tempHome.resolve("plugin-invoke-request.json");
        Files.writeString(requestFile, """
                {"args":{"topic":"ops"},"scriptInput":{"locale":"zh-CN"},"responseView":"DEBUG"}
                """);

        ExecutionResult result = execute("plugins", "invoke", "plugin-a", "summarize", "--file", requestFile.toString());

        assertThat(result.exitCode()).isEqualTo(0);
        JsonNode body = parseJson(requestRef.get().body());
        assertThat(body.path("args").path("topic").asText()).isEqualTo("ops");
        assertThat(body.path("scriptInput").path("locale").asText()).isEqualTo("zh-CN");
        assertThat(body.path("responseView").asText()).isEqualTo("DEBUG");
    }

    @Test
    void completeRequestBodyFileCannotBeCombinedWithSplitJsonOptions() throws Exception {
        server = new TestServer();
        Path requestFile = tempHome.resolve("execution-request.json");
        Files.writeString(requestFile, """
                {"scriptId":"hello","input":{}}
                """);

        ExecutionResult result = execute(
                "executions", "submit",
                "--file", requestFile.toString(),
                "--script-id", "hello",
                "--input", "{}"
        );

        assertThat(result.exitCode()).isEqualTo(CliException.EXIT_VALIDATION);
        assertThat(parseJson(result.stderr()).path("msg").asText()).contains("--file cannot be combined");
    }

    @Test
    void pluginsInstallSendsMultipartRequest() throws Exception {
        server = new TestServer();
        AtomicReference<CapturedRequest> requestRef = new AtomicReference<>();
        server.register("POST", "/api/plugins/install", request -> {
            requestRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"Plugin installed","data":{"pluginId":"demo"}}
                    """);
        });

        Path jarFile = tempHome.resolve("demo.jar");
        Files.writeString(jarFile, "jar-content");
        ExecutionResult result = execute("plugins", "install", "--jar", jarFile.toString());

        assertThat(result.exitCode()).isEqualTo(0);
        assertThat(requestRef.get().headers().getFirst("Content-type")).startsWith("multipart/form-data");
        assertThat(requestRef.get().body()).contains("filename=\"demo.jar\"");
        assertThat(requestRef.get().body()).contains("jar-content");
    }

    @Test
    void schedulesListWithScriptIdUsesScopedEndpoint() throws Exception {
        server = new TestServer();
        AtomicReference<CapturedRequest> requestRef = new AtomicReference<>();
        server.register("GET", "/api/scripts/hello/schedules", request -> {
            requestRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"Success","data":[{"id":"s1"}]}
                    """);
        });

        ExecutionResult result = execute("schedules", "list", "--script-id", "hello");

        assertThat(result.exitCode()).isEqualTo(0);
        assertThat(requestRef.get().path()).isEqualTo("/api/scripts/hello/schedules");
        assertThat(parseJson(result.stdout()).path("data")).hasSize(1);
    }

    @Test
    void configValuesCommandsUseConfigValueApi() throws Exception {
        server = new TestServer();
        AtomicReference<CapturedRequest> createRef = new AtomicReference<>();
        AtomicReference<CapturedRequest> updateRef = new AtomicReference<>();
        server.register("POST", "/api/config-values", request -> {
            createRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"created","data":{"key":"openai.api_key"}}
                    """);
        });
        server.register("PUT", "/api/config-values/openai.api_key", request -> {
            updateRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"updated","data":{"key":"openai.api_key"}}
                    """);
        });

        Path configFile = tempHome.resolve("config-value.json");
        Files.writeString(configFile, """
                {"key":"openai.api_key","value":"secret","description":"OpenAI key"}
                """);

        ExecutionResult createResult = execute("config-values", "create", "--file", configFile.toString());
        ExecutionResult updateResult = execute("config-values", "update", "openai.api_key", "--file", configFile.toString());

        assertThat(createResult.exitCode()).isEqualTo(0);
        assertThat(updateResult.exitCode()).isEqualTo(0);
        assertThat(parseJson(createRef.get().body()).path("key").asText()).isEqualTo("openai.api_key");
        assertThat(parseJson(updateRef.get().body()).path("value").asText()).isEqualTo("secret");
    }

    @Test
    void repositoriesCommandsCoverDefinitionsAndTools() throws Exception {
        server = new TestServer();
        AtomicReference<CapturedRequest> createRef = new AtomicReference<>();
        AtomicReference<CapturedRequest> installRef = new AtomicReference<>();
        AtomicReference<CapturedRequest> developRef = new AtomicReference<>();
        server.register("POST", "/api/repositories", request -> {
            createRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"created","data":{"id":"repo-main"}}
                    """);
        });
        server.register("POST", "/api/repositories/repo-main/tools/hello/install", request -> {
            installRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"installed","data":{"scriptId":"hello"}}
                    """);
        });
        server.register("POST", "/api/repositories/repo-main/tools/hello/develop", request -> {
            developRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"developed","data":{"id":"hello-dev"}}
                    """);
        });

        Path repoFile = tempHome.resolve("repository.json");
        Files.writeString(repoFile, """
                {"id":"repo-main","name":"Main","type":"LOCAL_DIR","url":"/tmp/repo","enabled":true,"trustLevel":"TRUSTED"}
                """);

        ExecutionResult createResult = execute("repositories", "create", "--file", repoFile.toString());
        ExecutionResult installResult = execute(
                "repositories", "tools", "install", "repo-main", "hello",
                "--install-schedules",
                "--install-plugin-dependencies",
                "--force-plugin-upgrade"
        );
        ExecutionResult developResult = execute("repositories", "tools", "develop", "repo-main", "hello", "--script-id", "hello-dev");

        assertThat(createResult.exitCode()).isEqualTo(0);
        assertThat(installResult.exitCode()).isEqualTo(0);
        assertThat(developResult.exitCode()).isEqualTo(0);
        assertThat(parseJson(createRef.get().body()).path("id").asText()).isEqualTo("repo-main");
        JsonNode installBody = parseJson(installRef.get().body());
        assertThat(installBody.path("installSchedules").asBoolean()).isTrue();
        assertThat(installBody.path("installPluginDependencies").asBoolean()).isTrue();
        assertThat(installBody.path("forcePluginUpgrade").asBoolean()).isTrue();
        assertThat(parseJson(developRef.get().body()).path("scriptId").asText()).isEqualTo("hello-dev");
    }

    @Test
    void repositoriesPluginsAndScriptsDevelopmentCommandsUseExpectedEndpoints() throws Exception {
        server = new TestServer();
        AtomicReference<CapturedRequest> pluginDetailRef = new AtomicReference<>();
        AtomicReference<CapturedRequest> forkRef = new AtomicReference<>();
        AtomicReference<CapturedRequest> pullRef = new AtomicReference<>();
        server.register("GET", "/api/repositories/repo-main/plugins/demo-plugin", request -> {
            pluginDetailRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"success","data":{"descriptor":{"pluginId":"demo-plugin"}}}
                    """);
        });
        server.register("POST", "/api/scripts/source/fork", request -> {
            forkRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"forked","data":{"id":"source-fork"}}
                    """);
        });
        server.register("POST", "/api/scripts/hello-dev/development-pull", request -> {
            pullRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"pulled","data":{"id":"hello-dev"}}
                    """);
        });

        ExecutionResult pluginGetResult = execute("repositories", "plugins", "get", "repo-main", "demo-plugin");
        ExecutionResult legacyPluginGetResult = execute("plugins", "repository", "get", "repo-main", "demo-plugin");
        ExecutionResult forkResult = execute("scripts", "fork", "source", "--id", "source-fork", "--name", "Source Fork");
        ExecutionResult pullResult = execute("scripts", "development-pull", "hello-dev", "--force");

        assertThat(pluginGetResult.exitCode()).isEqualTo(0);
        assertThat(legacyPluginGetResult.exitCode()).isEqualTo(0);
        assertThat(forkResult.exitCode()).isEqualTo(0);
        assertThat(pullResult.exitCode()).isEqualTo(0);
        assertThat(pluginDetailRef.get().path()).isEqualTo("/api/repositories/repo-main/plugins/demo-plugin");
        assertThat(forkRef.get().query()).isEqualTo("includeUiSchema=true");
        assertThat(parseJson(forkRef.get().body()).path("id").asText()).isEqualTo("source-fork");
        assertThat(pullRef.get().query()).contains("includeUiSchema=true");
        assertThat(pullRef.get().query()).contains("force=true");
    }

    @Test
    void invalidJsonInputReturnsValidationEnvelope() throws Exception {
        server = new TestServer();

        ExecutionResult result = execute("executions", "submit", "--script-id", "hello", "--input", "[]");

        assertThat(result.exitCode()).isEqualTo(CliException.EXIT_VALIDATION);
        JsonNode stderrJson = parseJson(result.stderr());
        assertThat(stderrJson.path("status").asInt()).isEqualTo(CliException.EXIT_VALIDATION);
        assertThat(stderrJson.path("msg").asText()).contains("must be a JSON object at the top level");
        assertThat(stderrJson.path("error").path("code").asText()).isEqualTo("INVALID_JSON_OBJECT");
        assertThat(stderrJson.path("error").path("expected").asText()).isEqualTo("JSON object");
        assertThat(stderrJson.path("error").path("actual").asText()).isEqualTo("array");
    }

    @Test
    void invalidInlineJsonGuidesPowerShellUsersTowardFilesOrStdin() throws Exception {
        server = new TestServer();

        ExecutionResult result = execute("executions", "submit", "--script-id", "hello", "--input", "{\"name\":");

        assertThat(result.exitCode()).isEqualTo(CliException.EXIT_VALIDATION);
        String message = parseJson(result.stderr()).path("msg").asText();
        assertThat(message).contains("is not valid JSON");
        assertThat(message).contains("PowerShell");
        assertThat(message).contains("--input-file input.json");
        assertThat(message).contains("--input-file -");
        JsonNode stderrJson = parseJson(result.stderr());
        assertThat(stderrJson.path("error").path("code").asText()).isEqualTo("INVALID_JSON");
        assertThat(stderrJson.path("error").path("retryExamples")).isNotEmpty();
    }

    @Test
    void missingScriptIdReturnsRecoverableErrorDetails() throws Exception {
        server = new TestServer();

        ExecutionResult result = execute("executions", "submit");

        assertThat(result.exitCode()).isEqualTo(CliException.EXIT_VALIDATION);
        JsonNode stderrJson = parseJson(result.stderr());
        assertThat(stderrJson.path("error").path("code").asText()).isEqualTo("MISSING_REQUIRED_OPTION");
        assertThat(stderrJson.path("error").path("command").asText()).isEqualTo("actiondock executions submit");
        assertThat(stderrJson.path("error").path("missing").toString()).contains("--script-id");
        assertThat(stderrJson.path("error").path("alternatives").toString()).contains("--file");
        assertThat(stderrJson.path("error").path("retryExamples").toString()).contains("--script-id");
    }

    @Test
    void mutuallyExclusiveRequestBodyOptionsReturnRecoverableErrorDetails() throws Exception {
        server = new TestServer();
        Path requestFile = tempHome.resolve("request.json");
        Files.writeString(requestFile, """
                {"scriptId":"hello","input":{}}
                """);

        ExecutionResult result = execute("executions", "submit", "--file", requestFile.toString(), "--script-id", "hello");

        assertThat(result.exitCode()).isEqualTo(CliException.EXIT_VALIDATION);
        JsonNode stderrJson = parseJson(result.stderr());
        assertThat(stderrJson.path("error").path("code").asText()).isEqualTo("MUTUALLY_EXCLUSIVE_OPTIONS");
        assertThat(stderrJson.path("error").path("mutuallyExclusiveWith").toString()).contains("--file");
        assertThat(stderrJson.path("error").path("retryExamples").toString()).contains("request.json");
    }

    @Test
    void scriptsSchemaExampleGeneratesInputAndOutputExamples() throws Exception {
        server = new TestServer();
        AtomicReference<CapturedRequest> requestRef = new AtomicReference<>();
        server.register("GET", "/api/scripts/hello", request -> {
            requestRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"Success","data":{
                      "id":"hello",
                      "inputSchema":{
                        "type":"object",
                        "properties":{
                          "name":{"type":"string","examples":["Alice"]},
                          "limit":{"type":"integer","default":10},
                          "mode":{"type":"string","enum":["FAST","SAFE"]}
                        },
                        "required":["name"]
                      },
                      "outputSchema":{
                        "type":"object",
                        "properties":{
                          "ok":{"type":"boolean"},
                          "count":{"type":"integer"}
                        }
                      }
                    }}
                    """);
        });

        ExecutionResult result = execute("scripts", "schema", "hello", "--example");

        assertThat(result.exitCode()).isEqualTo(0);
        assertThat(requestRef.get().query()).isEqualTo("includeUiSchema=true");
        JsonNode data = parseJson(result.stdout()).path("data");
        assertThat(data.path("inputExample").path("name").asText()).isEqualTo("Alice");
        assertThat(data.path("inputExample").path("limit").asInt()).isEqualTo(10);
        assertThat(data.path("inputExample").path("mode").asText()).isEqualTo("FAST");
        assertThat(data.path("outputExample").path("ok").asBoolean()).isTrue();
        assertThat(data.path("notes")).isNotEmpty();
    }

    @Test
    void rootHelpExplainsConfigResolutionOrder() throws Exception {
        ExecutionResult result = execute("--help");

        assertThat(result.exitCode()).isEqualTo(0);
        assertThat(result.stdout()).contains("Connection config precedence");
        assertThat(result.stdout()).contains("profile file > defaults");
        assertThat(result.stdout()).contains("ACTIONDOCK_PROFILE");
        assertThat(result.stdout()).contains("http://localhost:8080");
    }

    @Test
    void executionsHelpExplainsDraftExecutionAndClearConstraint() throws Exception {
        ExecutionResult submitHelp = execute("executions", "submit", "--help");
        ExecutionResult clearHelp = execute("executions", "clear", "--help");

        assertThat(submitHelp.exitCode()).isEqualTo(0);
        assertThat(submitHelp.stdout()).contains("Purpose:");
        assertThat(submitHelp.stdout()).contains("Required:");
        assertThat(submitHelp.stdout()).contains("Input JSON shape:");
        assertThat(submitHelp.stdout()).contains("Recoverable errors:");
        assertThat(submitHelp.stdout()).contains("\"scriptId\":\"hello\"");
        assertThat(submitHelp.stdout()).contains("--mode SYNC");
        assertThat(clearHelp.exitCode()).isEqualTo(0);
        assertThat(clearHelp.stdout()).contains("The server requires --script-id");
        assertThat(clearHelp.stdout()).contains("unconditional full clearing");
        assertThat(clearHelp.stdout()).contains("Script ID whose execution records should be cleared");
        assertThat(clearHelp.stdout()).contains("Required");
    }

    @Test
    void scriptsAndSchedulesHelpExplainPublishedAndRequestBodyRules() throws Exception {
        ExecutionResult executePublishedHelp = execute("scripts", "execute-published", "--help");
        ExecutionResult discardDraftHelp = execute("scripts", "discard-draft", "--help");
        ExecutionResult scheduleUpdateHelp = execute("schedules", "update", "--help");

        assertThat(executePublishedHelp.exitCode()).isEqualTo(0);
        assertThat(executePublishedHelp.stdout()).contains("Purpose:");
        assertThat(executePublishedHelp.stdout()).contains("Input JSON shape:");
        assertThat(executePublishedHelp.stdout()).contains("ignore current unpublished");
        assertThat(discardDraftHelp.exitCode()).isEqualTo(0);
        assertThat(discardDraftHelp.stdout()).contains("requires the script to already have a published version");
        assertThat(scheduleUpdateHelp.exitCode()).isEqualTo(0);
        assertThat(scheduleUpdateHelp.stdout()).contains("Input JSON shape:");
        assertThat(scheduleUpdateHelp.stdout()).contains("does not allow moving a schedule");
    }

    @Test
    void pluginsHelpExplainsInvokeAndConfigPayloadShape() throws Exception {
        ExecutionResult invokeHelp = execute("plugins", "invoke", "--help");
        ExecutionResult configSetHelp = execute("plugins", "config", "set", "--help");

        assertThat(invokeHelp.exitCode()).isEqualTo(0);
        assertThat(invokeHelp.stdout()).contains("Purpose:");
        assertThat(invokeHelp.stdout()).contains("Mutual exclusion:");
        assertThat(invokeHelp.stdout()).contains("scriptInput");
        assertThat(invokeHelp.stdout()).contains("Input JSON shape:");
        assertThat(configSetHelp.exitCode()).isEqualTo(0);
        assertThat(configSetHelp.stdout()).contains("Input JSON shape:");
        assertThat(configSetHelp.stdout()).contains("\"config\"");
    }

    @Test
    void discoverReturnsCommandTreeAndRecommendedFlows() throws Exception {
        ExecutionResult result = execute("discover", "--json");

        assertThat(result.exitCode()).isEqualTo(0);
        JsonNode data = parseJson(result.stdout()).path("data");
        assertThat(data.path("schemaVersion").asText()).isEqualTo("actiondock.cli.discover.v1");
        assertThat(data.path("agentFeatures").toString()).contains("--help-json");
        assertThat(data.path("commands").toString()).contains("executions");
        assertThat(data.path("recommendedFlows").toString()).contains("execute script safely");
    }

    @Test
    void helpJsonWorksForLeafCommandWithoutRequiredArguments() throws Exception {
        ExecutionResult result = execute("executions", "submit", "--help-json");

        assertThat(result.exitCode()).isEqualTo(0);
        JsonNode data = parseJson(result.stdout()).path("data");
        assertThat(data.path("schemaVersion").asText()).isEqualTo("actiondock.cli.help.v1");
        assertThat(data.path("command").asText()).isEqualTo("actiondock executions submit");
        assertThat(data.path("options").toString()).contains("--script-id");
        assertThat(data.path("options").toString()).contains("--dry-run");
        assertThat(data.path("constraints").toString()).contains("--file is mutually exclusive");
        assertThat(data.path("inputShapes").path("file").path("scriptId").asText()).isEqualTo("hello");
        assertThat(data.path("exitCodes").path("2").asText()).isEqualTo("validation error");
    }

    @Test
    void validateOnlyDoesNotContactServer() throws Exception {
        Path configFile = tempHome.resolve("config-value.json");
        Files.writeString(configFile, """
                {"key":"openai.api_key","value":"secret","description":"OpenAI key"}
                """);

        ExecutionResult result = execute("config-values", "create", "--file", configFile.toString(), "--validate-only");

        assertThat(result.exitCode()).isEqualTo(0);
        JsonNode stdoutJson = parseJson(result.stdout());
        assertThat(stdoutJson.path("msg").asText()).isEqualTo("Validation passed");
        assertThat(stdoutJson.path("data").path("valid").asBoolean()).isTrue();
        assertThat(stdoutJson.path("data").path("command").asText()).isEqualTo("actiondock config-values create");
    }

    @Test
    void dryRunReturnsJsonRequestPreviewWithoutContactingServer() throws Exception {
        ExecutionResult result = execute(
                "executions", "submit",
                "--script-id", "hello",
                "--input", "{\"name\":\"Alice\"}",
                "--wait",
                "--dry-run"
        );

        assertThat(result.exitCode()).isEqualTo(0);
        JsonNode data = parseJson(result.stdout()).path("data");
        assertThat(parseJson(result.stdout()).path("msg").asText()).isEqualTo("Dry run");
        assertThat(data.path("request").path("method").asText()).isEqualTo("POST");
        assertThat(data.path("request").path("path").asText()).isEqualTo("/api/executions");
        assertThat(data.path("request").path("body").path("scriptId").asText()).isEqualTo("hello");
        assertThat(data.path("request").path("body").path("input").path("name").asText()).isEqualTo("Alice");
        assertThat(data.path("metadata").path("waitRequested").asBoolean()).isTrue();
    }

    @Test
    void dryRunReturnsMultipartPreviewWithoutFileBytes() throws Exception {
        Path jarFile = tempHome.resolve("demo.jar");
        Files.writeString(jarFile, "jar-content");

        ExecutionResult result = execute("plugins", "install", "--jar", jarFile.toString(), "--dry-run");

        assertThat(result.exitCode()).isEqualTo(0);
        JsonNode request = parseJson(result.stdout()).path("data").path("request");
        assertThat(request.path("method").asText()).isEqualTo("POST");
        assertThat(request.path("path").asText()).isEqualTo("/api/plugins/install");
        assertThat(request.path("contentType").asText()).isEqualTo("multipart/form-data");
        assertThat(request.path("multipart").path("fileName").asText()).isEqualTo("demo.jar");
        assertThat(request.path("multipart").path("size").asInt()).isEqualTo("jar-content".getBytes(StandardCharsets.UTF_8).length);
        assertThat(request.toString()).doesNotContain("jar-content");
    }

    @Test
    void dryRunAndValidateOnlyAreMutuallyExclusive() throws Exception {
        ExecutionResult result = execute(
                "executions", "submit",
                "--script-id", "hello",
                "--input", "{}",
                "--dry-run",
                "--validate-only"
        );

        assertThat(result.exitCode()).isEqualTo(CliException.EXIT_VALIDATION);
        JsonNode stderrJson = parseJson(result.stderr());
        assertThat(stderrJson.path("error").path("code").asText()).isEqualTo("MUTUALLY_EXCLUSIVE_OPTIONS");
        assertThat(stderrJson.path("error").path("mutuallyExclusiveWith").toString()).contains("--dry-run");
    }

    private ExecutionResult execute(String... args) throws Exception {
        ByteArrayOutputStream stdoutBytes = new ByteArrayOutputStream();
        ByteArrayOutputStream stderrBytes = new ByteArrayOutputStream();
        PrintStream stdout = new PrintStream(stdoutBytes, true, StandardCharsets.UTF_8);
        PrintStream stderr = new PrintStream(stderrBytes, true, StandardCharsets.UTF_8);

        CliServices services = new CliServices(
                objectMapper,
                Map.of(),
                tempHome,
                stdout,
                stderr,
                millis -> {
                },
                ActionDockApiClient::new
        );
        ActionDockCommand root = new ActionDockCommand(services);
        writeDefaultProfile(tempHome, server == null ? "http://localhost:8080" : server.baseUrl());

        CommandLine commandLine = ActionDockCliApplication.createCommandLine(root);
        commandLine.setOut(new PrintWriter(stdout, true, StandardCharsets.UTF_8));
        commandLine.setErr(new PrintWriter(stderr, true, StandardCharsets.UTF_8));

        int exitCode = commandLine.execute(args);
        stdout.flush();
        stderr.flush();
        return new ExecutionResult(exitCode, stdoutBytes.toString(StandardCharsets.UTF_8), stderrBytes.toString(StandardCharsets.UTF_8));
    }

    private void writeDefaultProfile(Path home, String baseUrl) {
        CliConfigService service = new CliConfigService(objectMapper, Map.of(), home);
        CliConfigService.ConfigFile file = new CliConfigService.ConfigFile();
        CliConfigService.ProfileConfig profile = new CliConfigService.ProfileConfig();
        profile.setBaseUrl(baseUrl);
        profile.setToken("test-token");
        file.setCurrentProfile("default");
        file.getProfiles().put("default", profile);
        service.save(file);
    }

    private JsonNode parseJson(String json) throws Exception {
        return objectMapper.readTree(json);
    }

    private record ExecutionResult(int exitCode, String stdout, String stderr) {
    }

    private record CapturedRequest(String method, String path, String query, Headers headers, String body) {
    }

    private record Response(int statusCode, String contentType, String body) {
        static Response json(int statusCode, String body) {
            return new Response(statusCode, "application/json", body);
        }
    }

    @FunctionalInterface
    private interface ExchangeHandler {
        Response handle(CapturedRequest request) throws Exception;
    }

    private static final class TestServer implements AutoCloseable {
        private final HttpServer httpServer;
        private final Map<String, ExchangeHandler> handlers = new ConcurrentHashMap<>();

        private TestServer() throws IOException {
            this.httpServer = HttpServer.create(new InetSocketAddress(0), 0);
            this.httpServer.createContext("/", this::handle);
            this.httpServer.start();
        }

        private String baseUrl() {
            return "http://127.0.0.1:" + httpServer.getAddress().getPort();
        }

        private void register(String method, String path, ExchangeHandler handler) {
            handlers.put(method + " " + path, handler);
        }

        private void handle(HttpExchange exchange) throws IOException {
            String key = exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath();
            ExchangeHandler handler = handlers.get(key);
            Response response;
            try {
                if (handler == null) {
                    response = Response.json(404, "{\"status\":404,\"msg\":\"not found\",\"data\":null}");
                } else {
                    response = handler.handle(new CapturedRequest(
                            exchange.getRequestMethod(),
                            exchange.getRequestURI().getPath(),
                            exchange.getRequestURI().getRawQuery(),
                            exchange.getRequestHeaders(),
                            new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)
                    ));
                }
            } catch (Exception exception) {
                response = Response.json(500, "{\"status\":500,\"msg\":\"" + exception.getMessage() + "\",\"data\":null}");
            }

            byte[] bytes = response.body().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", response.contentType());
            exchange.sendResponseHeaders(response.statusCode(), bytes.length);
            try (OutputStream responseBody = exchange.getResponseBody()) {
                responseBody.write(bytes);
            }
        }

        @Override
        public void close() {
            httpServer.stop(0);
        }
    }
}
