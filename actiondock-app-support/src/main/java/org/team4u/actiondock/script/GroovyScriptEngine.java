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
 *
 * @author jay.wu
 */
public class GroovyScriptEngine implements ScriptEngine {
    private final CompiledGroovyScriptCache compiledScriptCache;
    private final PluginRuntimeService pluginRuntimeService;
    private final ScriptInvocationService scriptInvocationService;
    private final SharedStateApplicationService sharedStateApplicationService;

    public GroovyScriptEngine() {
        this(new AppProperties.Groovy(), PluginRuntimeService.disabled(), ScriptInvocationService.disabled(), SharedStateApplicationService.disabled());
    }

    public GroovyScriptEngine(AppProperties.Groovy properties, PluginRuntimeService pluginRuntimeService) {
        this(properties, pluginRuntimeService, ScriptInvocationService.disabled(), SharedStateApplicationService.disabled());
    }

    public GroovyScriptEngine(AppProperties.Groovy properties,
                              PluginRuntimeService pluginRuntimeService,
                              ScriptInvocationService scriptInvocationService) {
        this(properties, pluginRuntimeService, scriptInvocationService, SharedStateApplicationService.disabled());
    }

    public GroovyScriptEngine(AppProperties.Groovy properties,
                              PluginRuntimeService pluginRuntimeService,
                              ScriptInvocationService scriptInvocationService,
                              SharedStateApplicationService sharedStateApplicationService) {
        this(properties, Clock.systemUTC(), pluginRuntimeService, scriptInvocationService, sharedStateApplicationService);
    }

    GroovyScriptEngine(AppProperties.Groovy properties,
                       Clock clock,
                       PluginRuntimeService pluginRuntimeService,
                       ScriptInvocationService scriptInvocationService) {
        this(properties, clock, pluginRuntimeService, scriptInvocationService, SharedStateApplicationService.disabled());
    }

    GroovyScriptEngine(AppProperties.Groovy properties,
                       Clock clock,
                       PluginRuntimeService pluginRuntimeService,
                       ScriptInvocationService scriptInvocationService,
                       SharedStateApplicationService sharedStateApplicationService) {
        this.compiledScriptCache = new CompiledGroovyScriptCache(properties, clock, this::compileScriptClass);
        this.pluginRuntimeService = pluginRuntimeService == null ? PluginRuntimeService.disabled() : pluginRuntimeService;
        this.scriptInvocationService = scriptInvocationService == null
                ? ScriptInvocationService.disabled()
                : scriptInvocationService;
        this.sharedStateApplicationService = sharedStateApplicationService == null
                ? SharedStateApplicationService.disabled()
                : sharedStateApplicationService;
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

    private Binding newBinding(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
        Binding binding = new Binding();
        binding.setVariable("input", input == null ? Map.of() : input);
        binding.setVariable("config", executionContext == null ? Map.of() : executionContext.getConfig());
        binding.setVariable("log", new ScriptLogger(executionContext));
        binding.setVariable("plugins", new GroovyPlugins(pluginRuntimeService, definition, input, executionContext));
        binding.setVariable("scripts", new GroovyScripts(scriptInvocationService, definition, executionContext));
        binding.setVariable("state", new ScriptStateBridge(sharedStateApplicationService, definition, executionContext));
        return binding;
    }

    static final class ScriptLogger {
        private final ScriptExecutionContext executionContext;

        ScriptLogger(ScriptExecutionContext executionContext) {
            this.executionContext = executionContext;
        }

        public void debug(Object message) {
            write(ExecutionLogLevel.DEBUG, message);
        }

        public void info(Object message) {
            write(ExecutionLogLevel.INFO, message);
        }

        public void warn(Object message) {
            write(ExecutionLogLevel.WARN, message);
        }

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
