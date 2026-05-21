package org.team4u.actiondock.project.knowledge.plugin.executor;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;
import org.team4u.actiondock.project.knowledge.plugin.domain.AtomicTask;
import org.team4u.actiondock.project.knowledge.plugin.domain.MaintenanceRequest;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;
import org.team4u.actiondock.project.knowledge.plugin.domain.TaskResult;

public interface AtomicTaskExecutor {
    TaskResult execute(ScriptPluginContext context, MaintenanceRequest request, RepositoryFacts facts, AtomicTask task, String template);
}
