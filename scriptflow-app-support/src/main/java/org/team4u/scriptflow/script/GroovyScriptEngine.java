package org.team4u.scriptflow.script;

import groovy.lang.Binding;
import groovy.lang.GroovyShell;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.port.ScriptEngine;

import java.util.Map;

public class GroovyScriptEngine implements ScriptEngine {
    @Override
    public void validate(ScriptDefinition definition) {
        Binding binding = new Binding();
        binding.setVariable("input", Map.of());
        new GroovyShell(binding).parse(definition.getSource());
    }

    @Override
    public Object execute(ScriptDefinition definition, Map<String, Object> input) {
        Binding binding = new Binding();
        binding.setVariable("input", input == null ? Map.of() : input);
        return new GroovyShell(binding).evaluate(definition.getSource());
    }
}
