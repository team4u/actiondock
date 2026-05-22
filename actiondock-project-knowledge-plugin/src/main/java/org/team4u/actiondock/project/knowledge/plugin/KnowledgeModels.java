package org.team4u.actiondock.project.knowledge.plugin;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * 知识库生成请求参数，包含仓库路径、额外证据文件、受众和 AI profile 等。
 */
record KnowledgeRequest(
        /** 待扫描的仓库根目录 */
        Path repoPath,
        /** 用户指定的额外证据文件路径（相对于仓库根目录） */
        List<String> evidenceFiles,
        /** ingest 动作指定的原始资料来源，文件或目录路径（相对于仓库根目录） */
        List<String> sources,
        /** refresh 动作指定的变更文件路径（相对于仓库根目录） */
        List<String> changedFiles,
        /** 目标读者（如 "balanced"、"new-developer"） */
        String audience,
        /** 文档详细程度（如 "standard"、"detailed"） */
        String detailLevel,
        /** AI 配置文件标识，为空时使用确定性生成策略 */
        String aiProfile,
        /** Agent runner 配置 */
        RunnerSpec runner,
        /** 当前流水线模式：init / refresh / ingest */
        String mode
) {
}

/**
 * Agent Runner 配置，支持内置 Agent 与外部 CLI Agent。
 */
record RunnerSpec(
        /** internal / external-cli */
        String type,
        /** 内置 Agent profile */
        String aiProfile,
        /** 外部 CLI 命令前缀，例如 ["claude", "-p"] */
        List<String> command,
        /** 外部 CLI 允许透传的环境变量名 */
        List<String> envKeys,
        /** 单次 Agent 调用超时时间 */
        int timeoutSeconds
) {
}

/**
 * 单条校验问题，描述文档质量不达标的详细信息。
 */
record ValidationIssue(
        /** 问题代码，如 "missing-entry"、"placeholder" */
        String code,
        /** 问题所在的文件路径 */
        String path,
        /** 问题描述 */
        String message,
        /** 关联的文档 ID */
        String documentId,
        /** 关联的分片 ID（预留） */
        String shardId,
        /** 是否可通过重新生成自动修复 */
        boolean repairable
) {
}

/**
 * Chief Architect 输出的单个执行批次，包含阶段序号和需要激活的 Planner 列表。
 */
record KnowledgePhase(
        /** 阶段序号，从 0 开始，数值越小越早执行 */
        int phaseNum,
        /** 本阶段需要激活的领域 Planner 名称列表 */
        List<String> domainsToActivate
) {
}

/**
 * Domain Planner 输出的单个原子文档任务，描述一次 UPSERT 或 PRUNE 操作。
 */
record KnowledgeWorkerTask(
        /** 操作类型：UPSERT（创建或更新）或 PRUNE（删除） */
        String action,
        /** 目标文档路径，必须位于 .knowledge_base/ 下 */
        String targetPath,
        /** 关联的源码实体路径，用于 Agent 定位代码证据 */
        String focusCodeEntity,
        /** Planner 给出的操作线索，帮助 Worker 理解任务意图 */
        String clue,
        /** 生成此任务的 Planner 名称，用于追踪和错误报告 */
        String planner
) {
}

/**
 * Worker 执行后的摘要，包含执行状态和变更文件列表。
 */
record KnowledgeWorkerResult(
        /** 执行状态：COMPLETED 或 FAILED */
        String status,
        /** 实际写入的目标文档路径 */
        String targetPath,
        /** 本次执行中修改或创建的文件列表 */
        List<String> changedFiles,
        /** 执行过程中产生的警告信息 */
        List<String> warnings,
        /** Agent 返回的原始 JSON 对象 */
        Map<String, Object> raw
) {
}
