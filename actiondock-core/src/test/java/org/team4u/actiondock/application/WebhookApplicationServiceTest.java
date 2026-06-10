package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.WebhookDefinition;
import org.team4u.actiondock.domain.model.WebhookScope;
import org.team4u.actiondock.domain.model.WebhookTransport;
import org.team4u.actiondock.domain.model.WebhookTransportType;
import org.team4u.actiondock.domain.model.PublishedScriptRevision;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptPackaging;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.domain.model.WebhookSampleRequest;
import org.team4u.actiondock.domain.port.WebhookRepository;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.mock;

class WebhookApplicationServiceTest {
    private final WebhookRepository webhookRepository = mock(WebhookRepository.class);
    private final RepositoryLocalAssetRepository repositoryLocalAssetRepository = mock(RepositoryLocalAssetRepository.class);
    private final ScriptRepository scriptRepository = mock(ScriptRepository.class);
    private final WebhookApplicationService service = new WebhookApplicationService(
            webhookRepository,
            repositoryLocalAssetRepository,
            scriptRepository
    );

    @Test
    void saveRequiresWebhookScriptId() {
        assertThatThrownBy(() -> service.save(new WebhookDefinition()
                .setKey("demo")
                .setName("Demo")
                .setTransport(new WebhookTransport().setType(WebhookTransportType.HTTP_WEBHOOK))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("webhookScriptId 不能为空");
    }

    @Test
    void saveRequiresPublishedWebhookScript() {
        when(webhookRepository.findByKey("demo")).thenReturn(Optional.empty());
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(new ScriptDefinition()
                .setId("script-1")
                .setName("Demo Script")));

        assertThatThrownBy(() -> service.save(new WebhookDefinition()
                .setKey("demo")
                .setName("Demo")
                .setWebhookScriptId("script-1")
                .setTransport(new WebhookTransport().setType(WebhookTransportType.HTTP_WEBHOOK))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Webhook 脚本未发布: script-1");
    }

    @Test
    void savePinsWebhookEndpointAndSampleRequest() {
        when(webhookRepository.findByKey("demo")).thenReturn(Optional.empty());
        when(scriptRepository.findById("script-1")).thenReturn(Optional.of(publishedScript("script-1")));
        when(webhookRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        WebhookDefinition saved = service.save(new WebhookDefinition()
                .setKey("demo")
                .setName("Demo")
                .setEnabled(true)
                .setWebhookScriptId("script-1")
                .setTransport(new WebhookTransport().setType(WebhookTransportType.HTTP_WEBHOOK))
                .setSampleRequest(new WebhookSampleRequest()
                        .setMethod("post")
                        .setHeaders(Map.of("X-Test", List.of("a")))
                        .setRawBody("{\"hello\":\"world\"}")));

        assertThat(saved.getId()).isNotBlank();
        assertThat(saved.getTransport().getEndpointPath()).isEqualTo("/api/webhooks/" + saved.getId());
        assertThat(saved.getTransport().getContentTypes()).containsExactly("*/*");
        assertThat(saved.getWebhookScriptId()).isEqualTo("script-1");
        assertThat(saved.getSampleRequest().getMethod()).isEqualTo("POST");
        assertThat(saved.getSampleRequest().getHeaders()).containsEntry("X-Test", List.of("a"));
    }

    @Test
    void deleteRemovesWorkingCopyLocalAsset() {
        when(webhookRepository.findById("source-1")).thenReturn(Optional.of(new WebhookDefinition()
                .setId("source-1")
                .setScope(WebhookScope.PERSONAL)));
        when(repositoryLocalAssetRepository.findByLocalAsset(UpstreamAssetType.WEBHOOK, "source-1"))
                .thenReturn(Optional.of(new RepositoryLocalAsset()
                        .setId("asset-1")
                        .setAssetType(UpstreamAssetType.WEBHOOK)
                        .setLocalAssetId("source-1")));

        service.delete("source-1");

        verify(repositoryLocalAssetRepository).deleteById("asset-1");
        verify(webhookRepository).deleteById("source-1");
    }

    @Test
    void deleteSkipsLocalAssetRemovalWhenSourceHasNoLocalAsset() {
        when(webhookRepository.findById("source-1")).thenReturn(Optional.of(new WebhookDefinition()
                .setId("source-1")
                .setScope(WebhookScope.PERSONAL)));
        when(repositoryLocalAssetRepository.findByLocalAsset(UpstreamAssetType.WEBHOOK, "source-1"))
                .thenReturn(Optional.empty());

        service.delete("source-1");

        verify(repositoryLocalAssetRepository, never()).deleteById("asset-1");
        verify(webhookRepository).deleteById("source-1");
    }

    private static ScriptDefinition publishedScript(String id) {
        return new ScriptDefinition()
                .setId(id)
                .setName("Demo Script")
                .setType(ScriptType.GROOVY)
                .setPackaging(ScriptPackaging.TOOL)
                .setSource("return [:]")
                .setPublishedRevision(new PublishedScriptRevision()
                        .setId("revision-" + id)
                        .setScriptId(id)
                        .setVersion(1)
                        .setPublishedAt(LocalDateTime.now())
                        .setName("Demo Script")
                        .setType(ScriptType.GROOVY)
                        .setPackaging(ScriptPackaging.TOOL)
                        .setSource("return [:]"));
    }
}
