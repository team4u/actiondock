package org.team4u.actiondock.project.knowledge.plugin.executor;

import org.team4u.actiondock.ai.api.AiAgentRuntime;

public class AtomicTaskExecutorRouter {
    private final AtomicTaskExecutor builtinAgentExecutor;
    private final AtomicTaskExecutor externalCliExecutor;
    private final AtomicTaskExecutor localExecutor;

    public AtomicTaskExecutorRouter(AiAgentRuntime aiAgentRuntime) {
        this.localExecutor = new LocalAtomicTaskExecutor();
        this.builtinAgentExecutor = new BuiltinAgentAtomicTaskExecutor(aiAgentRuntime, localExecutor);
        this.externalCliExecutor = new ExternalCliAtomicTaskExecutor(localExecutor);
    }

    public AtomicTaskExecutor resolve(String executor) {
        return switch (executor) {
            case "builtin-agent", "auto" -> builtinAgentExecutor;
            case "external-cli" -> externalCliExecutor;
            default -> localExecutor;
        };
    }
}
