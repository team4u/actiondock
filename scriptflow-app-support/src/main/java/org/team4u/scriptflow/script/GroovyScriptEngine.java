package org.team4u.scriptflow.script;

import groovy.lang.Binding;
import groovy.lang.GroovyShell;
import groovy.lang.Script;
import org.codehaus.groovy.runtime.InvokerHelper;
import org.team4u.scriptflow.config.AppProperties;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.port.ScriptEngine;

import java.time.Clock;
import java.util.Map;

public class GroovyScriptEngine implements ScriptEngine {
    private final CompiledGroovyScriptCache compiledScriptCache;

    public GroovyScriptEngine() {
        this(new AppProperties.Groovy());
    }

    public GroovyScriptEngine(AppProperties.Groovy properties) {
        this(properties, Clock.systemUTC());
    }

    GroovyScriptEngine(AppProperties.Groovy properties, Clock clock) {
        this.compiledScriptCache = new CompiledGroovyScriptCache(properties, clock, this::compileScriptClass);
    }

    @Override
    public void validate(ScriptDefinition definition) {
        compiledScriptCache.getOrCompile(definition.getSource());
    }

    @Override
    public Object execute(ScriptDefinition definition, Map<String, Object> input) {
        Binding binding = newBinding(input);
        Class<? extends Script> scriptClass = compiledScriptCache.getOrCompile(definition.getSource());
        Script script = InvokerHelper.createScript(scriptClass, binding);
        return script.run();
    }

    protected Class<? extends Script> compileScriptClass(String source) {
        return new GroovyShell(newBinding(null)).parse(source).getClass().asSubclass(Script.class);
    }

    private Binding newBinding(Map<String, Object> input) {
        Binding binding = new Binding();
        binding.setVariable("input", input == null ? Map.of() : input);
        return binding;
    }
}
