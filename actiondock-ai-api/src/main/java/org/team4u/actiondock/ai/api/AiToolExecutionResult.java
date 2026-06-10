package org.team4u.actiondock.ai.api;

import java.util.Map;

/**
 * AI 工具执行结果。
 * <p>
 * 封装工具执行后的返回数据，包含成功/失败状态、输出数据、错误信息和执行耗时。
 * 提供工厂方法用于快速创建成功或失败的结果实例。
 *
 * @param success      是否执行成功
 * @param output       输出数据键值对
 * @param errorMessage 失败时的错误信息
 * @param latencyMs    执行耗时（毫秒）
 * @author jay.wu
 */
public record AiToolExecutionResult(
        boolean success,
        Map<String, Object> output,
        String errorMessage,
        Long latencyMs
) {

    /**
     * 创建一个成功的执行结果。
     *
     * @param output    输出数据，为 null 时自动转为空 Map
     * @param latencyMs 执行耗时（毫秒）
     * @return 成功的执行结果实例
     */
    public static AiToolExecutionResult success(Map<String, Object> output, long latencyMs) {
        return new AiToolExecutionResult(true, output == null ? Map.of() : output, null, latencyMs);
    }

    /**
     * 创建一个失败的执行结果。
     *
     * @param errorMessage 错误信息
     * @param latencyMs    执行耗时（毫秒）
     * @return 失败的执行结果实例
     */
    public static AiToolExecutionResult failed(String errorMessage, long latencyMs) {
        return new AiToolExecutionResult(false, Map.of(), errorMessage, latencyMs);
    }
}
