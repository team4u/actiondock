package org.team4u.actiondock.project.knowledge.plugin.executor;

import org.team4u.actiondock.ai.api.AiAgentRuntime;

/**
 * 原子任务执行器路由器。
 *
 * <p>根据执行器标识将原子任务分派到对应的执行策略实现。
 * 支持内置 AI Agent（{@code builtin-agent}）、外部 CLI（{@code external-cli}）和本地确定性回退三种策略。
 * 每种执行器在遇到不可用条件时自动回退到本地策略。
 *
 * @author ActionDock
 */
public class AtomicTaskExecutorRouter {
    private final AtomicTaskExecutor builtinAgentExecutor;
    private final AtomicTaskExecutor externalCliExecutor;
    private final AtomicTaskExecutor localExecutor;

    /**
     * 创建执行器路由器。
     *
     * @param aiAgentRuntime AI Agent 运行时，为 {@code null} 时内置 Agent 执行器将回退到本地策略
     */
    public AtomicTaskExecutorRouter(AiAgentRuntime aiAgentRuntime) {
        this.localExecutor = new LocalAtomicTaskExecutor();
        this.builtinAgentExecutor = new BuiltinAgentAtomicTaskExecutor(aiAgentRuntime, localExecutor);
        this.externalCliExecutor = new ExternalCliAtomicTaskExecutor(localExecutor);
    }

    /**
     * 根据执行器标识解析对应的执行器实例。
     *
     * @param executor 执行器标识（{@code builtin-agent}、{@code external-cli}、{@code auto} 或其他）
     * @return 对应的执行器实例
     */
    public AtomicTaskExecutor resolve(String executor) {
        return switch (executor) {
            case "builtin-agent", "auto" -> builtinAgentExecutor;
            case "external-cli" -> externalCliExecutor;
            default -> localExecutor;
        };
    }
}
