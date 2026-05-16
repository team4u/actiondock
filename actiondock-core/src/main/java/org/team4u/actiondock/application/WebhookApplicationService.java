package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.WebhookDefinition;
import org.team4u.actiondock.domain.model.WebhookScope;
import org.team4u.actiondock.domain.model.WebhookTransport;
import org.team4u.actiondock.domain.model.WebhookTransportType;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.model.WebhookSampleRequest;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.port.WebhookRepository;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class WebhookApplicationService {
    private final WebhookRepository webhookRepository;
    private final RepositoryLocalAssetRepository repositoryLocalAssetRepository;
    private final ScriptRepository scriptRepository;

    public WebhookApplicationService(WebhookRepository webhookRepository,
                                         RepositoryLocalAssetRepository repositoryLocalAssetRepository,
                                         ScriptRepository scriptRepository) {
        this.webhookRepository = webhookRepository;
        this.repositoryLocalAssetRepository = repositoryLocalAssetRepository;
        this.scriptRepository = scriptRepository;
    }

    public List<WebhookDefinition> list() {
        return webhookRepository.findAll();
    }

    public WebhookDefinition get(String id) {
        return webhookRepository.findById(id)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.WEBHOOK_NOT_FOUND,
                        "Webhook不存在: " + id,
                        Map.of("webhookId", id)
                ));
    }

    public WebhookDefinition save(WebhookDefinition definition) {
        if (definition == null) {
            throw new IllegalArgumentException("Webhook不能为空");
        }
        LocalDateTime now = LocalDateTime.now();
        WebhookDefinition target = resolveTarget(definition, now);
        if (target.getScope() == WebhookScope.REPOSITORY) {
            throw new IllegalArgumentException("仓库 Webhook仅支持通过仓库更新");
        }

        String key = ApplicationServiceSupport.normalize(definition.getKey(), "Webhook Key 不能为空");
        String name = ApplicationServiceSupport.normalize(definition.getName(), "Webhook 名称不能为空");
        String webhookScriptId = ApplicationServiceSupport.normalize(definition.getWebhookScriptId(), "webhookScriptId 不能为空");
        validateKeyUniqueness(key, target.getId());
        ScriptDefinition script = scriptRepository.findById(webhookScriptId)
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.SCRIPT_NOT_FOUND,
                        "Webhook 脚本不存在: " + webhookScriptId,
                        Map.of("scriptId", webhookScriptId)
                ));
        if (!script.hasPublishedRevision()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.SCRIPT_NOT_PUBLISHED,
                    "Webhook 脚本未发布: " + webhookScriptId,
                    Map.of("scriptId", webhookScriptId)
            );
        }

        WebhookTransport transport = configureTransport(definition.getTransport(), target.getId());
        WebhookSampleRequest sampleRequest = normalizeSampleRequest(definition.getSampleRequest());

        target.setKey(key)
                .setName(name)
                .setDescription(definition.getDescription())
                .setEditable(definition.isEditable())
                .setEnabled(definition.isEnabled())
                .setTransport(transport)
                .setWebhookScriptId(webhookScriptId)
                .setSampleRequest(sampleRequest)
                .setUpdatedAt(now);
        return webhookRepository.save(target);
    }

    private WebhookDefinition resolveTarget(WebhookDefinition definition, LocalDateTime now) {
        WebhookDefinition existing = definition.getId() == null || definition.getId().isBlank()
                ? null
                : webhookRepository.findById(definition.getId()).orElse(null);
        return existing == null
                ? new WebhookDefinition()
                .setId(definition.getId() == null || definition.getId().isBlank()
                        ? UUID.randomUUID().toString()
                        : definition.getId())
                .setCreatedAt(now)
                : existing;
    }

    private void validateKeyUniqueness(String key, String targetId) {
        webhookRepository.findByKey(key)
                .filter(found -> !found.getId().equals(targetId))
                .ifPresent(found -> {
                    throw ActionDockException.conflict(
                            ActionDockErrorCodes.WEBHOOK_KEY_EXISTS,
                            "Webhook Key 已存在: " + key,
                            Map.of("key", key)
                    );
                });
    }

    private static WebhookTransport configureTransport(WebhookTransport transport, String targetId) {
        WebhookTransport result = transport == null ? new WebhookTransport() : transport;
        if (result.getType() != WebhookTransportType.HTTP_WEBHOOK) {
            throw new IllegalArgumentException("当前仅支持 HTTP_WEBHOOK");
        }
        result.setEndpointPath("/api/webhooks/" + targetId);
        if (result.getContentTypes().isEmpty()) {
            result.setContentTypes(List.of("*/*"));
        }
        return result;
    }

    private static WebhookSampleRequest normalizeSampleRequest(WebhookSampleRequest sampleRequest) {
        return sampleRequest == null ? new WebhookSampleRequest() : sampleRequest;
    }

    public WebhookDefinition enable(String id) {
        WebhookDefinition source = get(id);
        source.setEnabled(true).setUpdatedAt(LocalDateTime.now());
        return webhookRepository.save(source);
    }

    public WebhookDefinition disable(String id) {
        WebhookDefinition source = get(id);
        source.setEnabled(false).setUpdatedAt(LocalDateTime.now());
        return webhookRepository.save(source);
    }

    public WebhookDefinition markReceived(String id, LocalDateTime receivedAt) {
        WebhookDefinition source = get(id);
        LocalDateTime timestamp = receivedAt == null ? LocalDateTime.now() : receivedAt;
        source.setLastReceivedAt(timestamp).setUpdatedAt(timestamp);
        return webhookRepository.save(source);
    }

    public void delete(String id) {
        get(id);
        repositoryLocalAssetRepository.findByLocalAsset(UpstreamAssetType.WEBHOOK, id)
                .map(RepositoryLocalAsset::getId)
                .ifPresent(repositoryLocalAssetRepository::deleteById);
        webhookRepository.deleteById(id);
    }
}
