package org.team4u.actiondock.project.knowledge.plugin;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/** 知识库生成请求参数，包含仓库路径、额外证据文件、受众和 AI profile 等。 */
record KnowledgeRequest(
        /** 待扫描的仓库根目录 */
        Path repoPath,
        /** 用户指定的额外证据文件路径（相对于仓库根目录） */
        List<String> evidenceFiles,
        /** 目标读者（如 "balanced"、"new-developer"） */
        String audience,
        /** 文档详细程度（如 "standard"、"detailed"） */
        String detailLevel,
        /** AI 配置文件标识，为空时使用确定性生成策略 */
        String aiProfile
) {
}

/** 仓库扫描产生的单条证据记录，包含文件路径、类型、内容摘要和指纹。 */
record EvidenceRecord(
        /** 证据唯一标识，内部编号如 "ev-1" 或用户指定的 "ext-1" */
        String id,
        /** 文件相对路径 */
        String path,
        /** 证据分类（sql / flow / ops / readme / source / external） */
        String type,
        /** 文件内容截取（最多 {@link RepositoryScanner#MAX_SNIPPET_BYTES} 字节） */
        String snippet,
        /** 基于 SHA-256 的内容指纹（16 字符十六进制） */
        String fingerprint
) {
}

/** 仓库扫描结果，包含项目基本信息、证据列表和分类路径索引。 */
record ScanResult(
        Path repoPath,
        /** 从仓库目录名推断的项目名称 */
        String projectName,
        /** 基于扫描结果自动生成的项目摘要 */
        String summary,
        /** README 文件前 {@link RepositoryScanner#MAX_README_LINES} 行内容 */
        String readmeExcerpt,
        /** 检测到的技术栈列表（java / node / go / python / rust / ops） */
        List<String> stacks,
        /** 所有收集到的证据记录 */
        List<EvidenceRecord> evidence,
        /** 业务入口文件路径（controller / router / handler 等） */
        List<String> flowPaths,
        /** 从 SQL 迁移中解析出的表名 */
        List<String> tableNames,
        /** SQL 文件路径 */
        List<String> sqlPaths,
        /** 运维相关文件路径（配置、安全、日志等） */
        List<String> operationPaths,
        /** 扫描过程中产生的警告信息 */
        List<String> warnings
) {
}

/** 单篇文档的生成规格，定义文档 ID、标题、输出路径和关联证据。 */
record DocumentSpec(
        /** 文档标识，对应固定的文档类型 */
        String documentId,
        /** 文档标题（中文） */
        String title,
        /** 正式发布时的相对输出路径 */
        String outputPath,
        /** 作为生成依据的证据文件路径列表 */
        List<String> evidencePaths,
        /** 传递给 AI 的提示线索，描述文档应包含的内容方向 */
        String promptHint
) {
}

/** 已生成的知识库文档，包含完整的 Markdown 内容和内容指纹。 */
record KnowledgeDocument(
        String documentId,
        String title,
        String outputPath,
        /** 文档 Markdown 正文，已标准化（确保 # 标题开头和尾部换行） */
        String body,
        /** 内容指纹，用于增量发布时判断是否有变化 */
        String fingerprint
) {
}

/** 知识库生成草稿，包含项目摘要和所有待发布的文档。 */
record KnowledgeDraft(
        String projectName,
        /** 项目摘要，AI 生成时覆盖扫描摘要 */
        String projectSummary,
        List<String> stacks,
        List<KnowledgeDocument> documents,
        /** 生成过程中的警告信息（如 AI 回退提示） */
        List<String> warnings
) {
}

/** 文档引用，用于渲染和发布阶段传递轻量级的文档元信息。 */
record DocumentRef(
        String documentId,
        String title,
        String outputPath
) {
}

/** 单篇已存储文档的持久化状态，用于增量发布时的差异比较。 */
record StoredDocumentState(
        String documentId,
        String outputPath,
        /** 上次发布时的内容指纹 */
        String fingerprint
) {
}

/** 知识库整体持久化状态，记录所有已发布文档和生成时间。 */
record KnowledgeState(
        /** 文档 ID 到存储状态的映射 */
        Map<String, StoredDocumentState> documents,
        /** 本次生成的所有文件路径列表 */
        List<String> generatedFiles,
        /** 最后一次发布的时间戳（ISO-8601） */
        String updatedAt
) {
}

/** 渲染阶段输出，包含 staging 根目录、文档列表和待持久化的状态。 */
record RenderBundle(
        /** staging 临时目录的绝对路径 */
        Path stagingRoot,
        /** 本次渲染产生的所有文档引用 */
        List<DocumentRef> documents,
        /** 生成报告的相对路径 */
        String reportPath,
        /** 本次渲染对应的持久化状态快照 */
        KnowledgeState state
) {
}

/** 发布阶段结果，包含变更文件列表、清理文件列表和最终状态。 */
record PublishResult(
        /** 新增或变更的文件路径列表 */
        List<String> changedFiles,
        /** 已从仓库中清理的旧文件路径列表 */
        List<String> removedFiles,
        /** 发布完成后的持久化状态 */
        KnowledgeState state
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
