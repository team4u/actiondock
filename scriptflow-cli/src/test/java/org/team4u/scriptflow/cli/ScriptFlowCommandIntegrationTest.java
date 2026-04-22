package org.team4u.scriptflow.cli;

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

class ScriptFlowCommandIntegrationTest {
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
                    {"status":0,"msg":"处理成功","data":[{"id":"hello"}]}
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
                    {"status":0,"msg":"已受理","data":{"id":"exec-1","status":"PENDING"}}
                    """);
        });
        server.register("GET", "/api/executions/exec-1", request -> {
            int current = pollCount.incrementAndGet();
            if (current == 1) {
                return Response.json(200, """
                        {"status":0,"msg":"处理成功","data":{"id":"exec-1","status":"RUNNING"}}
                        """);
            }
            return Response.json(200, """
                    {"status":0,"msg":"处理成功","data":{"id":"exec-1","status":"SUCCESS","output":{"ok":true}}}
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
    void pluginsInstallSendsMultipartRequest() throws Exception {
        server = new TestServer();
        AtomicReference<CapturedRequest> requestRef = new AtomicReference<>();
        server.register("POST", "/api/plugins/install", request -> {
            requestRef.set(request);
            return Response.json(200, """
                    {"status":0,"msg":"插件安装成功","data":{"pluginId":"demo"}}
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
                    {"status":0,"msg":"处理成功","data":[{"id":"s1"}]}
                    """);
        });

        ExecutionResult result = execute("schedules", "list", "--script-id", "hello");

        assertThat(result.exitCode()).isEqualTo(0);
        assertThat(requestRef.get().path()).isEqualTo("/api/scripts/hello/schedules");
        assertThat(parseJson(result.stdout()).path("data")).hasSize(1);
    }

    @Test
    void invalidJsonInputReturnsValidationEnvelope() throws Exception {
        server = new TestServer();

        ExecutionResult result = execute("executions", "submit", "--script-id", "hello", "--input", "[]");

        assertThat(result.exitCode()).isEqualTo(CliException.EXIT_VALIDATION);
        JsonNode stderrJson = parseJson(result.stderr());
        assertThat(stderrJson.path("status").asInt()).isEqualTo(CliException.EXIT_VALIDATION);
        assertThat(stderrJson.path("msg").asText()).contains("顶层必须是 JSON 对象");
    }

    @Test
    void rootHelpExplainsConfigResolutionOrder() throws Exception {
        ExecutionResult result = execute("--help");

        assertThat(result.exitCode()).isEqualTo(0);
        assertThat(result.stdout()).contains("连接配置优先级: 命令行参数 > 环境变量 > profile 文件 > 默认值");
        assertThat(result.stdout()).contains("SCRIPTFLOW_PROFILE");
        assertThat(result.stdout()).contains("http://localhost:8080");
    }

    @Test
    void executionsHelpExplainsDraftExecutionAndClearConstraint() throws Exception {
        ExecutionResult submitHelp = execute("executions", "submit", "--help");
        ExecutionResult clearHelp = execute("executions", "clear", "--help");

        assertThat(submitHelp.exitCode()).isEqualTo(0);
        assertThat(submitHelp.stdout()).contains("这里走的是 /api/executions");
        assertThat(submitHelp.stdout()).contains("会使用当前保存内容");
        assertThat(submitHelp.stdout()).contains("提交后等待执行结束；会轮询 /api/executions/{id}");
        assertThat(clearHelp.exitCode()).isEqualTo(0);
        assertThat(clearHelp.stdout()).contains("服务端要求必须提供 --script-id，不支持不带条件地全量清空");
        assertThat(clearHelp.stdout()).contains("要清理执行记录的脚本 ID；服务端必填");
    }

    @Test
    void scriptsAndSchedulesHelpExplainPublishedAndRequestBodyRules() throws Exception {
        ExecutionResult executePublishedHelp = execute("scripts", "execute-published", "--help");
        ExecutionResult discardDraftHelp = execute("scripts", "discard-draft", "--help");
        ExecutionResult scheduleUpdateHelp = execute("schedules", "update", "--help");

        assertThat(executePublishedHelp.exitCode()).isEqualTo(0);
        assertThat(executePublishedHelp.stdout()).contains("执行指定脚本的已发布版本，不会使用当前未发布修改");
        assertThat(discardDraftHelp.exitCode()).isEqualTo(0);
        assertThat(discardDraftHelp.stdout()).contains("该命令要求脚本已经存在已发布版本");
        assertThat(scheduleUpdateHelp.exitCode()).isEqualTo(0);
        assertThat(scheduleUpdateHelp.stdout()).contains("请求体仍需带 scriptId，且服务端不允许借此把定时任务改挂到别的脚本上");
    }

    @Test
    void pluginsHelpExplainsInvokeAndConfigPayloadShape() throws Exception {
        ExecutionResult invokeHelp = execute("plugins", "invoke", "--help");
        ExecutionResult configSetHelp = execute("plugins", "config", "set", "--help");

        assertThat(invokeHelp.exitCode()).isEqualTo(0);
        assertThat(invokeHelp.stdout()).contains("会额外返回 debug 区块");
        assertThat(invokeHelp.stdout()).contains("原始 args");
        assertThat(invokeHelp.stdout()).contains("scriptInput");
        assertThat(configSetHelp.exitCode()).isEqualTo(0);
        assertThat(configSetHelp.stdout()).contains("顶层包含 config 字");
        assertThat(configSetHelp.stdout()).contains("{\"config\":{...}}");
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
                ScriptFlowApiClient::new
        );
        ScriptFlowCommand root = new ScriptFlowCommand(services);
        writeDefaultProfile(tempHome, server == null ? "http://localhost:8080" : server.baseUrl());

        CommandLine commandLine = new CommandLine(root);
        commandLine.setCaseInsensitiveEnumValuesAllowed(true);
        commandLine.setOut(new PrintWriter(stdout, true, StandardCharsets.UTF_8));
        commandLine.setErr(new PrintWriter(stderr, true, StandardCharsets.UTF_8));
        commandLine.setExecutionExceptionHandler((exception, cmd, parseResult) -> {
            CliOutput output = root.output();
            if (exception instanceof CliException cliException) {
                cliException.writeTo(output);
                return cliException.exitCode();
            }
            CliException cliException = CliException.transport(output, exception.getMessage() == null ? "命令执行失败" : exception.getMessage());
            cliException.writeTo(output);
            return cliException.exitCode();
        });
        commandLine.setParameterExceptionHandler((exception, args1) -> {
            CliException cliException = CliException.validation(root.output(), exception.getMessage());
            cliException.writeTo(root.output());
            return cliException.exitCode();
        });

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
