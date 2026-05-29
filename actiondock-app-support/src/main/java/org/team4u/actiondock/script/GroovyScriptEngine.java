package org.team4u.actiondock.script;

import groovy.lang.Binding;
import groovy.lang.GroovyShell;
import groovy.lang.Script;
import org.codehaus.groovy.runtime.InvokerHelper;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.config.AppProperties;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.plugin.GroovyPlugins;
import org.team4u.actiondock.plugin.PluginRuntimeService;

import java.time.Clock;
import java.util.Map;

/**
 * Groovy 脚本引擎，基于 GroovyShell 提供脚本编译和执行能力。
 * <p>
 * 通过编译缓存优化重复执行的脚本，并为脚本提供 input、log、plugins、scripts 等绑定变量。
 * <p>
 * 推荐通过 {@link #builder()} 构建，也可使用遗留的构造函数快捷方式。
 *
 * @author jay.wu
 */
public class GroovyScriptEngine implements ScriptEngine {
    private final CompiledGroovyScriptCache compiledScriptCache;
    private final AppProperties properties;
    private final PluginRuntimeService pluginRuntimeService;
    private final ScriptInvocationService scriptInvocationService;
    private final SharedStateApplicationService sharedStateApplicationService;

    /**
     * 创建默认的 Groovy 脚本引擎（所有依赖均为禁用状态）。
     * <p>
     * 适用于不需要插件互调、脚本互调和共享状态的简单场景。
     */
    public GroovyScriptEngine() {
        this(builder());
    }

    /**
     * 使用 Groovy 配置和插件服务创建引擎。
     *
     * @param properties           Groovy 脚本引擎配置，为 null 时使用默认值
     * @param pluginRuntimeService 插件运行时服务，为 null 时使用禁用实现
     */
    public GroovyScriptEngine(AppProperties.Groovy properties, PluginRuntimeService pluginRuntimeService) {
        this(builder().groovyProperties(properties).pluginRuntimeService(pluginRuntimeService));
    }

    /**
     * 使用 Groovy 配置、插件服务和脚本互调服务创建引擎。
     *
     * @param properties            Groovy 脚本引擎配置，为 null 时使用默认值
     * @param pluginRuntimeService  插件运行时服务，为 null 时使用禁用实现
     * @param scriptInvocationService 脚本互调服务，为 null 时使用禁用实现
     */
    public GroovyScriptEngine(AppProperties.Groovy properties,
                              PluginRuntimeService pluginRuntimeService,
                              ScriptInvocationService scriptInvocationService) {
        this(builder().groovyProperties(properties).pluginRuntimeService(pluginRuntimeService)
                .scriptInvocationService(scriptInvocationService));
    }

    /**
     * 使用 Groovy 配置和全部可选依赖创建引擎。
     *
     * @param properties                  Groovy 脚本引擎配置，为 null 时使用默认值
     * @param pluginRuntimeService        插件运行时服务，为 null 时使用禁用实现
     * @param scriptInvocationService     脚本互调服务，为 null 时使用禁用实现
     * @param sharedStateApplicationService 共享状态服务，为 null 时使用禁用实现
     */
    public GroovyScriptEngine(AppProperties.Groovy properties,
                              PluginRuntimeService pluginRuntimeService,
                              ScriptInvocationService scriptInvocationService,
                              SharedStateApplicationService sharedStateApplicationService) {
        this(builder().groovyProperties(properties).pluginRuntimeService(pluginRuntimeService)
                .scriptInvocationService(scriptInvocationService).sharedStateApplicationService(sharedStateApplicationService));
    }

    /**
     * 使用全局应用配置和全部可选依赖创建引擎。
     *
     * @param properties                  全局应用配置，为 null 时使用默认值
     * @param pluginRuntimeService        插件运行时服务，为 null 时使用禁用实现
     * @param scriptInvocationService     脚本互调服务，为 null 时使用禁用实现
     * @param sharedStateApplicationService 共享状态服务，为 null 时使用禁用实现
     */
    public GroovyScriptEngine(AppProperties properties,
                              PluginRuntimeService pluginRuntimeService,
                              ScriptInvocationService scriptInvocationService,
                              SharedStateApplicationService sharedStateApplicationService) {
        this(builder().appProperties(properties).pluginRuntimeService(pluginRuntimeService)
                .scriptInvocationService(scriptInvocationService).sharedStateApplicationService(sharedStateApplicationService));
    }

    /**
     * 包内可见的构造函数，支持注入 Clock（主要用于测试子类化）。
     *
     * @param properties            Groovy 配置
     * @param clock                 时钟实例
     * @param pluginRuntimeService  插件运行时服务
     * @param scriptInvocationService 脚本互调服务
     */
    GroovyScriptEngine(AppProperties.Groovy properties,
                       Clock clock,
                       PluginRuntimeService pluginRuntimeService,
                       ScriptInvocationService scriptInvocationService) {
        this(builder().groovyProperties(properties).clock(clock)
                .pluginRuntimeService(pluginRuntimeService).scriptInvocationService(scriptInvocationService));
    }

    /**
     * 使用 Builder 配置构建引擎（包内及内部使用）。
     */
    private GroovyScriptEngine(Builder b) {
        this.properties = b.appProperties == null ? new AppProperties() : b.appProperties;
        AppProperties.Groovy groovyProperties = b.groovyProperties == null
                ? this.properties.getExecution().getGroovy() : b.groovyProperties;
        this.compiledScriptCache = new CompiledGroovyScriptCache(
                groovyProperties, b.clock == null ? Clock.systemUTC() : b.clock, this::compileScriptClass);
        this.pluginRuntimeService = b.pluginRuntimeService == null
                ? PluginRuntimeService.disabled() : b.pluginRuntimeService;
        this.scriptInvocationService = b.scriptInvocationService == null
                ? ScriptInvocationService.disabled() : b.scriptInvocationService;
        this.sharedStateApplicationService = b.sharedStateApplicationService == null
                ? SharedStateApplicationService.disabled() : b.sharedStateApplicationService;
    }

    /**
     * 创建构建器，用于灵活配置引擎的所有依赖项。
     * <p>
     * 示例：{@code GroovyScriptEngine.builder().appProperties(props).pluginRuntimeService(svc).build()}
     *
     * @return 构建器实例
     */
    public static Builder builder() {
        return new Builder();
    }

    /**
     * Groovy 脚本引擎的构建器，支持链式配置所有可选依赖。
     * <p>
     * 所有配置项均为可选，未设置的依赖将自动使用禁用（disabled）实现或默认值。
     */
    public static class Builder {
        private AppProperties appProperties;
        private AppProperties.Groovy groovyProperties;
        private Clock clock;
        private PluginRuntimeService pluginRuntimeService;
        private ScriptInvocationService scriptInvocationService;
        private SharedStateApplicationService sharedStateApplicationService;

        /**
         * 设置全局应用配置。
         *
         * @param appProperties 应用配置，为 null 时使用默认值
         * @return 当前构建器
         */
        public Builder appProperties(AppProperties appProperties) {
            this.appProperties = appProperties;
            return this;
        }

        /**
         * 设置 Groovy 脚本引擎专属配置。
         *
         * @param groovyProperties Groovy 配置，为 null 时从应用配置中获取
         * @return 当前构建器
         */
        public Builder groovyProperties(AppProperties.Groovy groovyProperties) {
            this.groovyProperties = groovyProperties;
            return this;
        }

        /**
         * 设置时钟（主要用于测试）。
         *
         * @param clock 时钟实例，为 null 时使用系统默认时钟
         * @return 当前构建器
         */
        public Builder clock(Clock clock) {
            this.clock = clock;
            return this;
        }

        /**
         * 设置插件运行时服务。
         *
         * @param pluginRuntimeService 插件服务，为 null 时使用禁用实现
         * @return 当前构建器
         */
        public Builder pluginRuntimeService(PluginRuntimeService pluginRuntimeService) {
            this.pluginRuntimeService = pluginRuntimeService;
            return this;
        }

        /**
         * 设置脚本互调服务。
         *
         * @param scriptInvocationService 脚本互调服务，为 null 时使用禁用实现
         * @return 当前构建器
         */
        public Builder scriptInvocationService(ScriptInvocationService scriptInvocationService) {
            this.scriptInvocationService = scriptInvocationService;
            return this;
        }

        /**
         * 设置共享状态应用服务。
         *
         * @param sharedStateApplicationService 共享状态服务，为 null 时使用禁用实现
         * @return 当前构建器
         */
        public Builder sharedStateApplicationService(SharedStateApplicationService sharedStateApplicationService) {
            this.sharedStateApplicationService = sharedStateApplicationService;
            return this;
        }

        /**
         * 构建 Groovy 脚本引擎实例。
         *
         * @return 配置完成的脚本引擎
         */
        public GroovyScriptEngine build() {
            return new GroovyScriptEngine(this);
        }
    }

    /**
     * 校验 Groovy 脚本语法是否正确。
     * <p>
     * 通过编译缓存编译脚本源码，若语法有误将抛出异常。
     *
     * @param definition 脚本定义，包含待校验的源码
     * @throws IllegalArgumentException 如果脚本语法错误
     */
    @Override
    public void validate(ScriptDefinition definition) {
        compiledScriptCache.getOrCompile(definition.getSource());
    }

    /**
     * 执行 Groovy 脚本。
     * <p>
     * 从编译缓存获取或编译脚本类，创建绑定变量（input、config、log、plugins、scripts、state）后执行脚本。
     *
     * @param definition       脚本定义，包含源码和元信息
     * @param input            脚本输入数据，通过 {@code input} 绑定变量提供给脚本
     * @param executionContext 脚本执行上下文，包含执行 ID、配置和日志收集器
     * @return 脚本执行的返回值
     */
    @Override
    public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
        Binding binding = newBinding(definition, input, executionContext);
        Class<? extends Script> scriptClass = compiledScriptCache.getOrCompile(definition.getSource());
        Script script = InvokerHelper.createScript(scriptClass, binding);
        return script.run();
    }

    /**
     * 编译 Groovy 脚本源码为脚本类。
     * <p>
     * 使用空绑定变量解析并编译脚本，编译后的类可被缓存和复用。
     *
     * @param source Groovy 脚本源码
     * @return 编译后的脚本类
     */
    protected Class<? extends Script> compileScriptClass(String source) {
        return new GroovyShell(newBinding(null, null, null)).parse(source).getClass().asSubclass(Script.class);
    }

    /**
     * 创建 Groovy 脚本执行的绑定变量集合。
     * <p>
     * 为脚本提供以下内置变量：
     * <ul>
     *   <li>{@code input} — 脚本输入参数</li>
     *   <li>{@code config} — 全局配置快照</li>
     *   <li>{@code log} — 日志记录器（debug/info/warn/error）</li>
     *   <li>{@code plugins} — 插件互调桥接</li>
     *   <li>{@code scripts} — 脚本互调桥接</li>
     *   <li>{@code state} — 共享状态桥接</li>
     *   <li>{@code context} — 运行时上下文信息</li>
     *   <li>{@code shell} — Shell 命令执行器</li>
     * </ul>
     *
     * @param definition       脚本定义，可为 null（编译阶段不需要）
     * @param input            输入参数，可为 null
     * @param executionContext 执行上下文，可为 null
     * @return Groovy 绑定变量集合
     */
    private Binding newBinding(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
        Binding binding = new Binding();
        binding.setVariable("input", input == null ? Map.of() : input);
        binding.setVariable("config", executionContext == null ? Map.of() : executionContext.getConfig());
        binding.setVariable("log", new ScriptLogger(executionContext));
        binding.setVariable("plugins", new GroovyPlugins(pluginRuntimeService, definition, input, executionContext));
        binding.setVariable("scripts", new GroovyScripts(scriptInvocationService, definition, executionContext));
        binding.setVariable("state", new ScriptStateBridge(sharedStateApplicationService, definition, executionContext));
        binding.setVariable("context", ScriptRuntimeSupport.context(properties, executionContext));
        binding.setVariable("shell", new ScriptShell(properties, executionContext));
        return binding;
    }

    /**
     * 脚本日志记录器，将日志写入执行上下文的日志收集器。
     * <p>
     * 暴露为 Groovy 脚本的 {@code log} 绑定变量，支持 debug/info/warn/error 四个级别。
     */
    static final class ScriptLogger {
        private final ScriptExecutionContext executionContext;

        ScriptLogger(ScriptExecutionContext executionContext) {
            this.executionContext = executionContext;
        }

        /** 记录 DEBUG 级别日志。 */
        public void debug(Object message) {
            write(ExecutionLogLevel.DEBUG, message);
        }

        /** 记录 INFO 级别日志。 */
        public void info(Object message) {
            write(ExecutionLogLevel.INFO, message);
        }

        /** 记录 WARN 级别日志。 */
        public void warn(Object message) {
            write(ExecutionLogLevel.WARN, message);
        }

        /** 记录 ERROR 级别日志。 */
        public void error(Object message) {
            write(ExecutionLogLevel.ERROR, message);
        }

        private void write(ExecutionLogLevel level, Object message) {
            if (executionContext == null) {
                return;
            }
            executionContext.log(level, String.valueOf(message));
        }
    }
}
