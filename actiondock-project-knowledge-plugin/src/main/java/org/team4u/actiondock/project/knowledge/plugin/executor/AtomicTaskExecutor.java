package org.team4u.actiondock.project.knowledge.plugin.executor;

import org.team4u.actiondock.plugin.api.ScriptPluginContext;
import org.team4u.actiondock.project.knowledge.plugin.domain.AtomicTask;
import org.team4u.actiondock.project.knowledge.plugin.domain.MaintenanceRequest;
import org.team4u.actiondock.project.knowledge.plugin.domain.RepositoryFacts;
import org.team4u.actiondock.project.knowledge.plugin.domain.TaskResult;

/**
 * 原子任务执行器接口。
 *
 * <p>定义知识库原子任务的执行契约，支持多种执行策略（内置 AI Agent、外部 CLI、本地确定性回退）。
 *
 * @author ActionDock
 */
public interface AtomicTaskExecutor {

    /**
     * 执行单个原子任务。
     *
     * @param context  脚本插件上下文
     * @param request  维护请求
     * @param facts    仓库扫描结果
     * @param task     待执行的原子任务
     * @param template 任务关联的模板内容
     * @return 任务执行结果
     */
    TaskResult execute(ScriptPluginContext context, MaintenanceRequest request, RepositoryFacts facts, AtomicTask task, String template);
}
