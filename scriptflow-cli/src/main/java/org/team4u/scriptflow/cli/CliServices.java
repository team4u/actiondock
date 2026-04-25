package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.PrintStream;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;

/**
 * CLI 基础服务容器，提供 JSON 序列化、IO 流、环境变量和 API 客户端工厂等依赖。
 *
 * @author jay.wu
 */
public final class CliServices {
    @FunctionalInterface
    public interface Sleeper {
        void sleep(long millis) throws InterruptedException;
    }

    @FunctionalInterface
    public interface ApiClientFactory {
        ScriptFlowApiClient create(CliConfigService.ResolvedConnectionConfig config, ObjectMapper objectMapper, CliOutput output);
    }

    private final ObjectMapper objectMapper;
    private final Map<String, String> environment;
    private final Path homeDirectory;
    private final PrintStream stdout;
    private final PrintStream stderr;
    private final Sleeper sleeper;
    private final ApiClientFactory apiClientFactory;

    /**
     * 创建默认的 CLI 服务容器。
     * <p>
     * 使用系统环境变量、用户主目录、标准 IO 流和默认 API 客户端工厂。
     *
     * @return 默认配置的 CLI 服务实例
     */
    public static CliServices defaultServices() {
        ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
        return new CliServices(
                objectMapper,
                System.getenv(),
                Paths.get(System.getProperty("user.home")),
                System.out,
                System.err,
                Thread::sleep,
                ScriptFlowApiClient::new
        );
    }

    public CliServices(ObjectMapper objectMapper,
                       Map<String, String> environment,
                       Path homeDirectory,
                       PrintStream stdout,
                       PrintStream stderr,
                       Sleeper sleeper,
                       ApiClientFactory apiClientFactory) {
        this.objectMapper = objectMapper;
        this.environment = environment;
        this.homeDirectory = homeDirectory;
        this.stdout = stdout;
        this.stderr = stderr;
        this.sleeper = sleeper;
        this.apiClientFactory = apiClientFactory;
    }

    public ObjectMapper objectMapper() {
        return objectMapper;
    }

    public Map<String, String> environment() {
        return environment;
    }

    public Path homeDirectory() {
        return homeDirectory;
    }

    public PrintStream stdout() {
        return stdout;
    }

    public PrintStream stderr() {
        return stderr;
    }

    public Sleeper sleeper() {
        return sleeper;
    }

    public ApiClientFactory apiClientFactory() {
        return apiClientFactory;
    }
}
