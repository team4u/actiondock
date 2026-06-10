package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;

import java.util.Map;

/**
 * 脚本引擎端口，定义脚本校验与执行的抽象能力。
 * <p>
 * 不同的脚本语言（Groovy、Python 等）通过实现此接口提供具体的执行能力。
 *
 * @author jay.wu
 */
public interface ScriptEngine {

    /**
     * 校验脚本定义的语法正确性。
     * <p>
     * 在脚本保存或发布前执行语法检查，确保源代码可以被引擎正确解析。
     *
     * @param definition 要校验的脚本定义
     * @throws org.team4u.actiondock.domain.model.ScriptCompilationException 脚本语法错误时抛出
     */
    void validate(ScriptDefinition definition);

    /**
     * 执行脚本并返回结果。
     * <p>
     * 使用指定的脚本定义和输入参数执行脚本，执行过程中的上下文信息（如超时控制、日志记录）
     * 通过 executionContext 进行管理。
     *
     * @param definition       要执行的脚本定义，包含源代码和脚本类型
     * @param input            脚本输入参数，键值对形式传递给脚本
     * @param executionContext 执行上下文，提供执行过程中的运行时信息和控制能力
     * @return 脚本执行结果，具体类型取决于脚本实现
     * @throws org.team4u.actiondock.domain.model.ScriptExecutionException 脚本执行出错时抛出
     */
    Object execute(ScriptDefinition definition, Map<String, Object> input, ScriptExecutionContext executionContext);
}
