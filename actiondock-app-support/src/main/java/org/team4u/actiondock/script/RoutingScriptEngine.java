package org.team4u.actiondock.script;

import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.port.ScriptEngine;

import java.util.EnumMap;
import java.util.Map;

/**
 * 路由脚本引擎，根据脚本类型分发到对应的引擎实现。
 * <p>
 * 支持 Groovy 和 Python 两种脚本类型的路由。
 *
 * @author jay.wu
 */
public class RoutingScriptEngine implements ScriptEngine {
    private final Map<ScriptType, ScriptEngine> delegates = new EnumMap<>(ScriptType.class);

    /**
     * 创建路由脚本引擎。
     *
     * @param groovyScriptEngine Groovy 脚本引擎实现
     * @param pythonScriptEngine Python 脚本引擎实现
     */
    public RoutingScriptEngine(ScriptEngine groovyScriptEngine, ScriptEngine pythonScriptEngine) {
        delegates.put(ScriptType.GROOVY, groovyScriptEngine);
        delegates.put(ScriptType.PYTHON, pythonScriptEngine);
    }

    /**
     * 校验脚本语法，根据脚本类型路由到对应的引擎实现。
     *
     * @param definition 脚本定义，包含类型和源码
     * @throws IllegalArgumentException 如果脚本类型不支持或语法错误
     */
    @Override
    public void validate(ScriptDefinition definition) {
        resolve(definition).validate(definition);
    }

    /**
     * 执行脚本，根据脚本类型路由到对应的引擎实现。
     *
     * @param definition       脚本定义，包含类型和源码
     * @param input            脚本输入数据
     * @param executionContext 脚本执行上下文
     * @return 脚本执行的返回值
     * @throws IllegalArgumentException 如果脚本类型不支持
     */
    @Override
    public Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext) {
        return resolve(definition).execute(definition, input, executionContext);
    }

    private ScriptEngine resolve(ScriptDefinition definition) {
        ScriptType type = definition.getType() == null ? ScriptType.GROOVY : definition.getType();
        ScriptEngine delegate = delegates.get(type);
        if (delegate == null) {
            throw new IllegalArgumentException("Unsupported script type: " + type);
        }
        return delegate;
    }
}
