package org.team4u.scriptflow.script;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.scriptflow.domain.port.ScriptEngine;

@Configuration(proxyBeanMethods = false)
public class ScriptEngineConfiguration {
    @Bean
    public ScriptEngine scriptEngine() {
        return new GroovyScriptEngine();
    }
}
