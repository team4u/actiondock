package org.team4u.actiondock.repository;

import org.team4u.actiondock.common.NormalizeUtils;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookKnowledgeRef;
import org.team4u.actiondock.domain.model.PlaybookRelatedRef;
import org.team4u.actiondock.domain.model.PlaybookScriptRef;
import org.team4u.actiondock.domain.model.RepositoryDefinition;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.*;

/**
 * 能力包发布预览构建器，计算发布前的检查项和变更差异。
 *
 * <p>从 {@link CapabilityPackageBuilderService} 中提取，
 * 封装发布前校验与版本对比的纯计算逻辑。</p>
 */
final class CapabilityPackagePublishPreviewBuilder {

    private CapabilityPackagePublishPreviewBuilder() {
    }

    static CapabilityPackagePublishPreview buildPreview(RepositoryDefinition repository,
                                                        List<RepositoryScriptDescriptor> publishedScripts,
                                                        List<RepositoryKnowledgeDescriptor> publishedKnowledge,
                                                        List<RepositoryPlaybookDescriptor> publishedPlaybooks,
                                                        List<String> localPlaybookIds,
                                                        CapabilityPackageDraft draft,
                                                        CapabilityPackageDetail currentPackage) {
        List<CapabilityPackageCheck> checks = buildPublishChecks(repository, publishedScripts, publishedKnowledge, publishedPlaybooks, localPlaybookIds, draft);
        CapabilityPackageDiffSummary diff = computeEntryChanges(draft, currentPackage);

        return new CapabilityPackagePublishPreview(
                draft.packageId(),
                draft.version(),
                draft.entries(),
                draft.bundle().models().keySet().stream().sorted().toList(),
                draft.bundle().toolsets().keySet().stream().sorted().toList(),
                draft.bundle().agents().keySet().stream().sorted().toList(),
                draft.bundle().scripts().keySet().stream().sorted().toList(),
                draft.playbooks().stream().map(org.team4u.actiondock.domain.model.Playbook::getId).sorted().toList(),
                draft.configTemplate(),
                draft.scheduleTemplate(),
                draft.presetTemplate(),
                draft.bundle().externalDependencies().values().stream().toList(),
                checks,
                diff
        );
    }

    private static List<CapabilityPackageCheck> buildPublishChecks(RepositoryDefinition repository,
                                                                   List<RepositoryScriptDescriptor> publishedScripts,
                                                                   List<RepositoryKnowledgeDescriptor> publishedKnowledge,
                                                                   List<RepositoryPlaybookDescriptor> publishedPlaybooks,
                                                                   List<String> localPlaybookIds,
                                                                   CapabilityPackageDraft draft) {
        List<CapabilityPackageCheck> checks = new ArrayList<>();
        if (draft.entries().isEmpty()) {
            checks.add(new CapabilityPackageCheck(CHECK_SEVERITY_BLOCKER, "ENTRY_MISSING", "缺少主入口"));
        }
        if (NormalizeUtils.isBlank(draft.releaseNotes())) {
            checks.add(new CapabilityPackageCheck(CHECK_SEVERITY_WARNING, "RELEASE_NOTES_EMPTY", "未填写 release notes"));
        }
        for (RepositoryAiPackageDependency dependency : draft.bundle().externalDependencies().values()) {
            if ((NormalizeUtils.isBlank(dependency.version()))
                    && !DependencyAssetType.AI_PACKAGE.name().equalsIgnoreCase(dependency.assetType())) {
                checks.add(new CapabilityPackageCheck(CHECK_SEVERITY_BLOCKER, "DEPENDENCY_VERSION_MISSING", "存在未声明版本的外部依赖: " + dependency.assetId()));
            } else if (DependencyAssetType.PLUGIN.name().equalsIgnoreCase(dependency.assetType())
                    && (NormalizeUtils.isBlank(dependency.repositoryId()))) {
                checks.add(new CapabilityPackageCheck(CHECK_SEVERITY_WARNING, "PLUGIN_EXTERNAL_ONLY", "插件依赖缺少仓库来源，安装时需要本地已存在: " + dependency.assetId()));
            }
        }
        addPlaybookReferenceChecks(repository, publishedScripts, publishedKnowledge, publishedPlaybooks, localPlaybookIds, draft, checks);
        checks.add(new CapabilityPackageCheck(CHECK_SEVERITY_INFO, "ASSET_SUMMARY",
                "包含 " + draft.bundle().scripts().size() + " 个脚本 / " + draft.bundle().agents().size() + " 个 Agent / "
                        + draft.bundle().toolsets().size() + " 个工具集 / " + draft.bundle().models().size() + " 个模型"));
        return checks;
    }

    private static void addPlaybookReferenceChecks(RepositoryDefinition repository,
                                                   List<RepositoryScriptDescriptor> publishedScripts,
                                                   List<RepositoryKnowledgeDescriptor> publishedKnowledge,
                                                   List<RepositoryPlaybookDescriptor> publishedPlaybooks,
                                                   List<String> localPlaybookIds,
                                                   CapabilityPackageDraft draft,
                                                   List<CapabilityPackageCheck> checks) {
        LinkedHashSet<String> missingScriptIds = new LinkedHashSet<>();
        LinkedHashSet<String> missingKnowledgeRepositoryIds = new LinkedHashSet<>();
        LinkedHashSet<String> missingPlaybookIds = new LinkedHashSet<>();
        java.util.Set<String> draftPlaybookIds = draft.playbooks().stream()
                .map(org.team4u.actiondock.domain.model.Playbook::getId)
                .collect(java.util.stream.Collectors.toSet());

        for (Playbook playbook : NormalizeUtils.nullSafeList(draft.playbooks())) {
            for (PlaybookScriptRef ref : NormalizeUtils.nullSafeList(playbook.getScriptRefs())) {
                String scriptId = NormalizeUtils.normalizeNullable(ref.getScriptId());
                if (scriptId == null) {
                    continue;
                }
                boolean published = publishedScripts.stream().anyMatch(item -> Objects.equals(item.scriptId(), scriptId));
                if (!published) {
                    missingScriptIds.add(scriptId);
                }
            }
            for (PlaybookKnowledgeRef ref : NormalizeUtils.nullSafeList(playbook.getKnowledgeRefs())) {
                String knowledgeRepositoryId = NormalizeUtils.normalizeNullable(ref.getRepositoryId());
                if (knowledgeRepositoryId == null) {
                    continue;
                }
                boolean published = publishedKnowledge.stream().anyMatch(item -> Objects.equals(item.knowledgeId(), knowledgeRepositoryId));
                if (!published) {
                    missingKnowledgeRepositoryIds.add(knowledgeRepositoryId);
                }
            }
            for (PlaybookRelatedRef ref : NormalizeUtils.nullSafeList(playbook.getRelatedPlaybookRefs())) {
                String relatedPlaybookId = NormalizeUtils.normalizeNullable(ref.getPlaybookId());
                if (relatedPlaybookId == null) {
                    continue;
                }
                if (draftPlaybookIds.contains(relatedPlaybookId)) {
                    continue;
                }
                boolean published = publishedPlaybooks.stream().anyMatch(item -> Objects.equals(item.playbookId(), relatedPlaybookId));
                if (published) {
                    continue;
                }
                boolean localExists = localPlaybookIds.contains(relatedPlaybookId);
                if (localExists) {
                    continue;
                }
                missingPlaybookIds.add(relatedPlaybookId);
            }
        }

        if (!missingScriptIds.isEmpty()) {
            checks.add(new CapabilityPackageCheck(
                    CHECK_SEVERITY_BLOCKER,
                    "PLAYBOOK_SCRIPT_REF_MISSING",
                    "能力包中的 Playbook 引用了尚未发布到目标仓库的脚本，请先分别发布脚本: " + String.join(", ", missingScriptIds)
            ));
        }
        if (!missingKnowledgeRepositoryIds.isEmpty()) {
            checks.add(new CapabilityPackageCheck(
                    CHECK_SEVERITY_BLOCKER,
                    "PLAYBOOK_KNOWLEDGE_REF_MISSING",
                    "能力包中的 Playbook 引用了尚未作为知识源发布到目标仓库的项目仓库，请先分别发布知识源: "
                            + String.join(", ", missingKnowledgeRepositoryIds)
            ));
        }
        if (!missingPlaybookIds.isEmpty()) {
            checks.add(new CapabilityPackageCheck(
                    CHECK_SEVERITY_BLOCKER,
                    "PLAYBOOK_RELATED_REF_MISSING",
                    "能力包中的 Playbook 引用了包外且在目标仓库或本地不可解析的相关任务手册: "
                            + String.join(", ", missingPlaybookIds)
            ));
        }
    }

    private static CapabilityPackageDiffSummary computeEntryChanges(CapabilityPackageDraft draft,
                                                                     CapabilityPackageDetail currentPackage) {
        List<String> currentEntryKeys = currentPackage == null
                ? List.of()
                : currentPackage.releaseFile().entries().stream().map(item -> item.type() + ":" + item.id()).toList();
        List<String> nextEntryKeys = draft.entries().stream().map(item -> item.type() + ":" + item.id()).toList();
        List<String> addedEntries = nextEntryKeys.stream().filter(item -> !currentEntryKeys.contains(item)).toList();
        List<String> removedEntries = currentEntryKeys.stream().filter(item -> !nextEntryKeys.contains(item)).toList();
        List<String> changedAssets = new ArrayList<>();
        collectChangedAsset(changedAssets, "scripts", currentPackage,
                currentPackage == null ? null : currentPackage.releaseFile().scripts().stream().map(AiPackageScriptFile::id).toList(),
                draft.bundle().scripts().keySet().stream().toList());
        collectChangedAsset(changedAssets, "agents", currentPackage,
                currentPackage == null ? null : currentPackage.releaseFile().agents().stream().map(AiPackageAgentFile::id).toList(),
                draft.bundle().agents().keySet().stream().toList());
        collectChangedAsset(changedAssets, "toolsets", currentPackage,
                currentPackage == null ? null : currentPackage.releaseFile().toolsets().stream().map(AiPackageToolsetFile::id).toList(),
                draft.bundle().toolsets().keySet().stream().toList());
        collectChangedAsset(changedAssets, "models", currentPackage,
                currentPackage == null ? null : currentPackage.releaseFile().models().stream().map(AiPackageModelFile::id).toList(),
                draft.bundle().models().keySet().stream().toList());
        collectChangedAsset(changedAssets, "playbooks", currentPackage,
                currentPackage == null ? null : currentPackage.releaseFile().playbooks().stream().map(org.team4u.actiondock.domain.model.Playbook::getId).toList(),
                draft.playbooks().stream().map(org.team4u.actiondock.domain.model.Playbook::getId).toList());
        return new CapabilityPackageDiffSummary(
                currentPackage == null ? "INITIAL" : "COMPARE",
                addedEntries,
                removedEntries,
                changedAssets
        );
    }

    private static void collectChangedAsset(List<String> changedAssets, String label,
                                             CapabilityPackageDetail currentPackage,
                                             List<String> currentIds, List<String> nextIds) {
        List<String> sortedCurrent = NormalizeUtils.nullSafeList(currentIds).stream().sorted().toList();
        List<String> sortedNext = nextIds.stream().sorted().toList();
        if (currentPackage == null || !Objects.equals(sortedCurrent, sortedNext)) {
            changedAssets.add(label);
        }
    }
}
