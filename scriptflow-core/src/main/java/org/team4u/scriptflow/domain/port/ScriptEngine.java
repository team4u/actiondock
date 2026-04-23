package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptExecutionContext;

import java.util.Map;

/**
 * 脚本引擎端口，定义脚本校验与执行的抽象能力。
 * <p>
 * 不同的脚本语言（Groovy、Python 等）通过实现此接口提供具体的执行能力。
 *
 * @author jay.wu
 */
public interface ScriptEngine {
    void validate(ScriptDefinition definition);

    Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext);
}
