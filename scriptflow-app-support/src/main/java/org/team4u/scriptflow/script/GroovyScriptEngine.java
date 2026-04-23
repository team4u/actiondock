package org.team4u.scriptflow.script;

import groovy.lang.Binding;
import groovy.lang.GroovyShell;
import groovy.lang.Script;
import org.codehaus.groovy.runtime.InvokerHelper;
import org.team4u.scriptflow.application.ScriptInvocationService;
import org.team4u.scriptflow.config.AppProperties;
import org.team4u.scriptflow.domain.model.ExecutionLogLevel;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;
import org.team4u.scriptflow.domain.port.ScriptEngine;
import org.team4u.scriptflow.plugin.GroovyPlugins;
import org.team4u.scriptflow.plugin.PluginRuntimeService;

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

    public GroovyScriptEngine() {
        this(new AppProperties.Groovy(), PluginRuntimeService.disabled(), ScriptInvocationService.disabled());
    }

    public GroovyScriptEngine(AppProperties.Groovy properties, PluginRuntimeService pluginRuntimeService) {
        this(properties, pluginRuntimeService, ScriptInvocationService.disabled());
    }

    public GroovyScriptEngine(AppProperties.Groovy properties,
                              PluginRuntimeService pluginRuntimeService,
                              ScriptInvocationService scriptInvocationService) {
        this(properties, Clock.systemUTC(), pluginRuntimeService, scriptInvocationService);
    }

    GroovyScriptEngine(AppProperties.Groovy properties,
                       Clock clock,
                       PluginRuntimeService pluginRuntimeService,
                       ScriptInvocationService scriptInvocationService) {
        this.compiledScriptCache = new CompiledGroovyScriptCache(properties, clock, this::compileScriptClass);
        this.pluginRuntimeService = pluginRuntimeService == null ? PluginRuntimeService.disabled() : pluginRuntimeService;
        this.scriptInvocationService = scriptInvocationService == null
                ? ScriptInvocationService.disabled()
                : scriptInvocationService;
    }

    @Override
    public void validate(ScriptDefinition definition) {
        compiledScriptCache.getOrCompile(definition.getSource());
    }

    @Override
    public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
        Binding binding = newBinding(definition, input, executionContext);
        Class<? extends Script> scriptClass = compiledScriptCache.getOrCompile(definition.getSource());
        Script script = InvokerHelper.createScript(scriptClass, binding);
        return script.run();
    }

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
