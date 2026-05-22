package org.team4u.actiondock.project.knowledge.plugin;

import java.nio.file.Path;
import java.util.List;

/** 知识库生成请求参数，包含仓库路径、额外证据文件、受众和 AI profile 等。 */
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

/** Agent Runner 配置，支持内置 Agent 与外部 CLI Agent。 */
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

/** 单条校验问题，描述文档质量不达标的详细信息。 */
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
