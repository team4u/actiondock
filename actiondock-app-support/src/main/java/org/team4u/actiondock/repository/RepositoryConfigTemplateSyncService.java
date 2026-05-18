package org.team4u.actiondock.repository;

import org.team4u.actiondock.domain.model.ConfigValue;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;

import static org.team4u.actiondock.repository.RepositoryCatalogTypes.PUBLISH_MODE_INLINE;

/**
 * 仓库配置模板同步服务，负责将仓库中的配置模板同步为受管配置值。
 *
 * @author jay.wu
 */
class RepositoryConfigTemplateSyncService {

    private final ConfigValueRepository configValueRepository;

    RepositoryConfigTemplateSyncService(ConfigValueRepository configValueRepository) {
        this.configValueRepository = configValueRepository;
    }

    void syncConfigTemplates(String repositoryId, String repositoryScriptId, String repositoryVersion,
                             List<RepositoryCatalogTypes.ConfigTemplateItem> templates) {
        for (RepositoryCatalogTypes.ConfigTemplateItem template : templates) {
            ConfigValue existing = configValueRepository.findByKey(template.key()).orElse(null);
            String publishMode = template.resolvePublishMode();
            if (existing == null) {
                configValueRepository.save(createManagedConfigValue(template, repositoryId, repositoryScriptId, repositoryVersion, publishMode));
                continue;
            }
            if (isSameSource(existing, repositoryId, repositoryScriptId)) {
                updateManagedConfigValue(existing, template, repositoryVersion, publishMode);
                configValueRepository.save(existing);
            }
        }
    }

    void removeManagedConfigTemplates(String repositoryId, String packageId) {
        for (ConfigValue configValue : configValueRepository.findAll()) {
            if (configValue.isManaged()
                    && Objects.equals(repositoryId, configValue.getRepositoryId())
                    && Objects.equals(packageId, configValue.getRepositoryScriptId())) {
                configValueRepository.deleteByKey(configValue.getKey());
            }
        }
    }

    private static ConfigValue createManagedConfigValue(RepositoryCatalogTypes.ConfigTemplateItem template,
                                                        String repositoryId, String repositoryScriptId,
                                                        String repositoryVersion, String publishMode) {
        return new ConfigValue()
                .setKey(template.key())
                .setValue(publishMode.equals(PUBLISH_MODE_INLINE) ? template.defaultValue() : "")
                .setDescription(NormalizeUtils.normalizeNullable(template.label()))
                .setSecret(template.secret())
                .setRepositoryId(repositoryId)
                .setRepositoryScriptId(repositoryScriptId)
                .setRepositoryVersion(repositoryVersion)
                .setPublishMode(publishMode)
                .setManaged(true)
                .setOverridden(false)
                .setCreatedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now());
    }

    private static boolean isSameSource(ConfigValue existing, String repositoryId, String repositoryScriptId) {
        return Objects.equals(existing.getRepositoryId(), repositoryId)
                && Objects.equals(existing.getRepositoryScriptId(), repositoryScriptId);
    }

    private static void updateManagedConfigValue(ConfigValue existing,
                                                 RepositoryCatalogTypes.ConfigTemplateItem template,
                                                 String repositoryVersion, String publishMode) {
        existing.setDescription(NormalizeUtils.normalizeNullable(template.label()))
                .setSecret(template.secret())
                .setRepositoryVersion(repositoryVersion)
                .setPublishMode(publishMode)
                .setManaged(true)
                .setUpdatedAt(LocalDateTime.now());
        if (!existing.isOverridden()) {
            existing.setValue(publishMode.equals(PUBLISH_MODE_INLINE) ? template.defaultValue() : "");
        }
    }
}
