package org.team4u.actiondock.web.event;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.WebhookApplicationService;
import org.team4u.actiondock.application.WebhookExecutionResult;
import org.team4u.actiondock.application.WebhookExecutionApplicationService;
import org.team4u.actiondock.domain.model.WebhookDefinition;
import org.team4u.actiondock.domain.model.WebhookScope;
import org.team4u.actiondock.application.WebhookRequest;
import org.team4u.actiondock.repository.RepositoryCatalogTypes;
import org.team4u.actiondock.repository.RepositoryWebhookService;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.List;

@RestController
@RequestMapping("/api/webhooks")
public class WebhookManagementController {
    private final WebhookApplicationService webhookApplicationService;
    private final WebhookExecutionApplicationService webhookExecutionApplicationService;
    private final RepositoryWebhookService repositoryWebhookService;

    public WebhookManagementController(WebhookApplicationService webhookApplicationService,
                                       WebhookExecutionApplicationService webhookExecutionApplicationService,
                                       RepositoryWebhookService repositoryWebhookService) {
        this.webhookApplicationService = webhookApplicationService;
        this.webhookExecutionApplicationService = webhookExecutionApplicationService;
        this.repositoryWebhookService = repositoryWebhookService;
    }

    @GetMapping
    public ApiResponse<List<WebhookDefinition>> list() {
        return ApiResponse.success(webhookApplicationService.list());
    }

    @GetMapping("/{id}")
    public ApiResponse<WebhookDefinition> detail(@PathVariable String id) {
        return ApiResponse.success(webhookApplicationService.get(id));
    }

    @PostMapping
    public ApiResponse<WebhookDefinition> create(@RequestBody WebhookDefinition request) {
        request.setScope(request.getScope() == null ? WebhookScope.PERSONAL : request.getScope());
        return ApiResponse.success(webhookApplicationService.save(request), "已创建");
    }

    @PutMapping("/{id}")
    public ApiResponse<WebhookDefinition> update(@PathVariable String id, @RequestBody WebhookDefinition request) {
        request.setId(id);
        return ApiResponse.success(webhookApplicationService.save(request), "已更新");
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        webhookApplicationService.delete(id);
        return ApiResponse.success(null, "已删除");
    }

    @PostMapping("/{id}/enable")
    public ApiResponse<WebhookDefinition> enable(@PathVariable String id) {
        return ApiResponse.success(webhookApplicationService.enable(id), "已启用");
    }

    @PostMapping("/{id}/disable")
    public ApiResponse<WebhookDefinition> disable(@PathVariable String id) {
        return ApiResponse.success(webhookApplicationService.disable(id), "已停用");
    }

    @PostMapping("/{id}/test-webhook")
    public ApiResponse<WebhookExecutionResult> testWebhook(@PathVariable String id,
                                                           @RequestBody(required = false) WebhookRequest request) {
        return ApiResponse.success(webhookExecutionApplicationService.test(id, request));
    }

    @GetMapping("/{id}/upstream")
    public ApiResponse<RepositoryCatalogTypes.UpstreamStatus> upstreamStatus(@PathVariable String id) {
        return ApiResponse.success(repositoryWebhookService.getUpstreamStatus(id));
    }

    @PostMapping("/{id}/upstream/pull")
    public ApiResponse<WebhookDefinition> upstreamPull(@PathVariable String id,
                                                           @RequestParam(defaultValue = "false") boolean force) {
        return ApiResponse.success(repositoryWebhookService.pullUpstreamWebhook(id, force), "Webhook 工作副本已拉取上游更新");
    }

    @DeleteMapping("/{id}/upstream")
    public ApiResponse<Void> detachUpstream(@PathVariable String id) {
        repositoryWebhookService.detachUpstream(id);
        return ApiResponse.success(null, "已断开上游跟踪");
    }
}
