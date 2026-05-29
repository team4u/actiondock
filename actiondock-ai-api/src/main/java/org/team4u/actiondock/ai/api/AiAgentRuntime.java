package org.team4u.actiondock.ai.api;

/**
 * AI Agent 运行时接口，提供 Agent 的提交、执行、恢复和取消能力。
 * <p>
 * 支持同步执行和异步提交两种模式。异步提交后可通过 {@code getRun} 查询状态，
 * 也可通过 {@code resume} 在需要人工确认时恢复执行。
 *
 * @author jay.wu
 */
public interface AiAgentRuntime {

    /**
     * 异步提交 Agent 运行任务。
     *
     * @param request Agent 运行请求，包含输入消息和配置
     * @param context Agent 运行上下文
     * @return 提交结果，包含运行 ID 等信息
     */
    AiAgentRunSubmission submit(AiAgentRunRequest request, AiAgentRunContext context);

    /**
     * 同步执行 Agent 运行任务并等待完成。
     *
     * @param request Agent 运行请求，包含输入消息和配置
     * @param context Agent 运行上下文
     * @return 运行结果，包含最终输出和执行步骤
     */
    AiAgentRunResult run(AiAgentRunRequest request, AiAgentRunContext context);

    /**
     * 恢复已暂停的 Agent 运行。
     *
     * @param runId   运行记录 ID
     * @param command 恢复命令，包含人工审批结果等信息
     * @return 运行结果
     */
    AiAgentRunResult resume(String runId, AiAgentResumeCommand command);

    /**
     * 取消正在运行的 Agent 任务。
     *
     * @param runId 运行记录 ID
     */
    void cancel(String runId);

    /**
     * 获取 Agent 运行的当前快照。
     *
     * @param runId 运行记录 ID
     * @return 运行快照，包含状态和已完成的步骤信息
     */
    AiAgentRunSnapshot getRun(String runId);
}
