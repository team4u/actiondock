package org.team4u.actiondock.web.resource;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.repository.RepositoryCapabilityPackageService;
import org.team4u.actiondock.repository.RepositoryCatalogService;
import org.team4u.actiondock.repository.RepositoryCatalogTypes;
import org.team4u.actiondock.repository.RepositoryWebhookService;
import org.team4u.actiondock.repository.RepositoryPluginService;
import org.team4u.actiondock.repository.RepositoryScriptService;
import org.team4u.actiondock.repository.RepositoryKnowledgeService;
import org.team4u.actiondock.repository.RepositoryPlaybookService;
import org.team4u.actiondock.repository.RepositoryCatalogTypes.ToolInstallationOptions;
import org.team4u.actiondock.common.NormalizeUtils;
import org.team4u.actiondock.web.common.ApiResponse;
import org.team4u.actiondock.web.repository.RepositoryInstallRequest;
import org.team4u.actiondock.web.repository.RepositoryPluginInstallRequest;

import java.util.Locale;

/**
 * 统一资源生命周期 facade。
 * <p>
 * 首批覆盖仓库脚本、仓库插件和能力包；底层仍复用现有资源服务。
 */
@RestController
@RequestMapping("/api/resource-lifecycle")
public class ResourceLifecycleController {
    private static final String RESOURCE_REPOSITORY_SCRIPT = "REPOSITORY_SCRIPT";
    private static final String RESOURCE_REPOSITORY_WEBHOOK = "REPOSITORY_WEBHOOK";
    private static final String RESOURCE_REPOSITORY_PLUGIN = "REPOSITORY_PLUGIN";
    private static final String RESOURCE_CAPABILITY_PACKAGE = "CAPABILITY_PACKAGE";
    private static final String RESOURCE_REPOSITORY_KNOWLEDGE = "REPOSITORY_KNOWLEDGE";
    private static final String RESOURCE_REPOSITORY_PLAYBOOK = "REPOSITORY_PLAYBOOK";

    private static final String OP_INSTALL = "install";
    private static final String OP_UPDATE = "update";
    private static final String OP_ADD_LOCAL = "add-local";
    private static final String OP_UPDATE_LOCAL = "update-local";
    private static final String OP_PUBLISH = "publish";
    private static final String OP_PREVIEW = "preview";
    private static final String OP_UNINSTALL = "uninstall";

    private final RepositoryCatalogService repositoryCatalogService;
    private final RepositoryScriptService repositoryToolService;
    private final RepositoryWebhookService repositoryWebhookService;
    private final RepositoryPluginService repositoryPluginService;
    private final RepositoryCapabilityPackageService repositoryCapabilityPackageService;
    private final RepositoryKnowledgeService repositoryKnowledgeService;
    private final RepositoryPlaybookService repositoryPlaybookService;
    private final ObjectMapper objectMapper;

    public ResourceLifecycleController(RepositoryCatalogService repositoryCatalogService,
                                       RepositoryScriptService repositoryToolService,
                                       RepositoryWebhookService repositoryWebhookService,
                                       RepositoryPluginService repositoryPluginService,
                                       RepositoryCapabilityPackageService repositoryCapabilityPackageService,
                                       RepositoryKnowledgeService repositoryKnowledgeService,
                                       RepositoryPlaybookService repositoryPlaybookService,
                                       ObjectMapper objectMapper) {
        this.repositoryCatalogService = repositoryCatalogService;
        this.repositoryToolService = repositoryToolService;
        this.repositoryWebhookService = repositoryWebhookService;
        this.repositoryPluginService = repositoryPluginService;
        this.repositoryCapabilityPackageService = repositoryCapabilityPackageService;
        this.repositoryKnowledgeService = repositoryKnowledgeService;
        this.repositoryPlaybookService = repositoryPlaybookService;
        this.objectMapper = objectMapper;
    }

    @PostMapping("/operations")
    public ApiResponse<ResourceLifecycleOperationView> execute(@RequestBody ResourceLifecycleRequest request) {
        ResourceLifecycleRequest safeRequest = request == null ? new ResourceLifecycleRequest() : request;
        String resourceType = normalizeType(safeRequest.getResourceType());
        String operation = normalizeOperation(safeRequest.getOperation());
        Object result = switch (resourceType) {
            case RESOURCE_REPOSITORY_SCRIPT -> executeRepositoryTool(operation, safeRequest);
            case RESOURCE_REPOSITORY_WEBHOOK -> executeRepositoryWebhook(operation, safeRequest);
            case RESOURCE_REPOSITORY_PLUGIN -> executeRepositoryPlugin(operation, safeRequest);
            case RESOURCE_CAPABILITY_PACKAGE -> executeCapabilityPackage(operation, safeRequest);
            case RESOURCE_REPOSITORY_KNOWLEDGE -> executeRepositoryKnowledge(operation, safeRequest);
            case RESOURCE_REPOSITORY_PLAYBOOK -> executeRepositoryPlaybook(operation, safeRequest);
            default -> throw new IllegalArgumentException("不支持的资源类型: " + resourceType);
        };
        return ApiResponse.success(
                new ResourceLifecycleOperationView(
                        resourceType,
                        operation,
                        safeRequest.getRepositoryId(),
                        resolveResourceId(safeRequest),
                        "COMPLETED",
                        result
                ),
                "资源生命周期操作完成"
        );
    }

    private Object executeRepositoryTool(String operation, ResourceLifecycleRequest request) {
        return switch (operation) {
            case OP_ADD_LOCAL -> repositoryToolService.addLocalAsset(normalizeRepositoryId(request),
                    normalizeResourceId(request, "scriptId 不能为空"),
                    convertPayload(request.getPayload(), RepositoryCatalogTypes.RepositoryLocalAssetRequest.class));
            case OP_UPDATE_LOCAL -> repositoryToolService.updateLocalAsset(normalizeRepositoryId(request),
                    normalizeResourceId(request, "scriptId 不能为空"), toolOptions(request.getPayload()));
            case OP_PUBLISH -> repositoryToolService.publishScript(normalizeRepositoryId(request),
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.RepositoryPublishRequest.class));
            case OP_PREVIEW -> repositoryToolService.previewPublishConfig(
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.RepositoryPublishConfigPreviewRequest.class));
            case OP_UNINSTALL -> {
                String installedResourceId = NormalizeUtils.normalize(request.getInstalledResourceId(), "installedResourceId 不能为空");
                repositoryToolService.uninstallScript(installedResourceId);
                yield null;
            }
            default -> throw unsupported(operation, RESOURCE_REPOSITORY_SCRIPT);
        };
    }

    private Object executeRepositoryPlugin(String operation, ResourceLifecycleRequest request) {
        return switch (operation) {
            case OP_INSTALL -> repositoryPluginService.installPlugin(normalizeRepositoryId(request),
                    normalizeResourceId(request, "pluginId 不能为空"), pluginForce(request.getPayload()));
            case OP_UPDATE -> repositoryPluginService.updatePlugin(normalizeRepositoryId(request),
                    normalizeResourceId(request, "pluginId 不能为空"), pluginForce(request.getPayload()));
            case OP_PUBLISH -> repositoryCatalogService.publishPlugin(normalizeRepositoryId(request),
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.RepositoryPluginPublishRequest.class));
            default -> throw unsupported(operation, RESOURCE_REPOSITORY_PLUGIN);
        };
    }

    private Object executeRepositoryWebhook(String operation, ResourceLifecycleRequest request) {
        return switch (operation) {
            case OP_ADD_LOCAL -> repositoryWebhookService.addLocalAsset(normalizeRepositoryId(request),
                    normalizeResourceId(request, "webhookId 不能为空"),
                    convertPayload(request.getPayload(), RepositoryCatalogTypes.RepositoryLocalAssetRequest.class));
            case OP_UPDATE_LOCAL -> repositoryWebhookService.updateLocalAsset(normalizeRepositoryId(request),
                    normalizeResourceId(request, "webhookId 不能为空"), toolOptions(request.getPayload()));
            case OP_PUBLISH -> repositoryWebhookService.publishWebhook(normalizeRepositoryId(request),
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.RepositoryWebhookPublishRequest.class));
            case OP_PREVIEW -> repositoryWebhookService.previewPublish(
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.RepositoryWebhookPublishPreviewRequest.class));
            case OP_UNINSTALL -> {
                String installedResourceId = NormalizeUtils.normalize(request.getInstalledResourceId(), "installedResourceId 不能为空");
                repositoryWebhookService.uninstallWebhook(installedResourceId);
                yield null;
            }
            default -> throw unsupported(operation, RESOURCE_REPOSITORY_WEBHOOK);
        };
    }

    private Object executeRepositoryPlaybook(String operation, ResourceLifecycleRequest request) {
        return switch (operation) {
            case OP_ADD_LOCAL, OP_INSTALL -> repositoryPlaybookService.addLocalAsset(normalizeRepositoryId(request),
                    normalizeResourceId(request, "playbookId 不能为空"),
                    convertPayload(request.getPayload(), RepositoryCatalogTypes.RepositoryLocalAssetRequest.class));
            case OP_UPDATE_LOCAL, OP_UPDATE -> repositoryPlaybookService.updateLocalAsset(normalizeRepositoryId(request),
                    normalizeResourceId(request, "playbookId 不能为空"));
            case OP_PUBLISH -> repositoryPlaybookService.publishPlaybook(normalizeRepositoryId(request),
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.RepositoryPlaybookPublishRequest.class));
            case OP_UNINSTALL -> {
                String installedResourceId = NormalizeUtils.normalize(request.getInstalledResourceId(), "installedResourceId 不能为空");
                repositoryPlaybookService.uninstallPlaybook(installedResourceId);
                yield null;
            }
            default -> throw unsupported(operation, RESOURCE_REPOSITORY_PLAYBOOK);
        };
    }

    private Object executeCapabilityPackage(String operation, ResourceLifecycleRequest request) {
        String repositoryId = normalizeRepositoryId(request);
        return switch (operation) {
            case OP_INSTALL -> repositoryCapabilityPackageService.installCapabilityPackage(repositoryId,
                    normalizeResourceId(request, "packageId 不能为空"));
            case OP_UPDATE -> repositoryCapabilityPackageService.updateCapabilityPackage(repositoryId,
                    normalizeResourceId(request, "packageId 不能为空"));
            case OP_UNINSTALL -> {
                String packageId = normalizeResourceId(request, "packageId 不能为空");
                repositoryCapabilityPackageService.uninstallCapabilityPackage(repositoryId, packageId);
                yield null;
            }
            case OP_PREVIEW -> repositoryCapabilityPackageService.previewCapabilityPackage(repositoryId,
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.CapabilityPackagePublishRequest.class));
            case OP_PUBLISH -> repositoryCapabilityPackageService.publishCapabilityPackage(repositoryId,
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.CapabilityPackagePublishRequest.class));
            default -> throw unsupported(operation, RESOURCE_CAPABILITY_PACKAGE);
        };
    }

    private Object executeRepositoryKnowledge(String operation, ResourceLifecycleRequest request) {
        return switch (operation) {
            case OP_PREVIEW -> repositoryKnowledgeService.previewPublish(
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.RepositoryKnowledgePublishPreviewRequest.class));
            case OP_PUBLISH -> {
                RepositoryCatalogTypes.RepositoryKnowledgePublishRequest payload =
                        requirePayload(request.getPayload(), RepositoryCatalogTypes.RepositoryKnowledgePublishRequest.class);
                yield repositoryKnowledgeService.publishKnowledge(
                        payload.projectRepositoryId(),
                        payload.targetRepositoryId(),
                        new RepositoryKnowledgeService.PublishKnowledgeRequest(
                                payload.knowledgeId(),
                                payload.displayName(),
                                payload.description(),
                                payload.tags(),
                                payload.configItems()
                        )
                );
            }
            default -> throw unsupported(operation, RESOURCE_REPOSITORY_KNOWLEDGE);
        };
    }

    private ToolInstallationOptions toolOptions(JsonNode payload) {
        RepositoryInstallRequest request = convertPayload(payload, RepositoryInstallRequest.class);
        return request == null
                ? ToolInstallationOptions.DEFAULT
                : new ToolInstallationOptions(request.isInstallSchedules(), request.isInstallScriptDependencies(),
                request.isInstallPluginDependencies(), request.isForcePluginUpgrade());
    }

    private boolean pluginForce(JsonNode payload) {
        RepositoryPluginInstallRequest request = convertPayload(payload, RepositoryPluginInstallRequest.class);
        return request != null && request.isForce();
    }

    private <T> T requirePayload(JsonNode payload, Class<T> type) {
        T converted = convertPayload(payload, type);
        if (converted == null) {
            throw new IllegalArgumentException("payload 不能为空");
        }
        return converted;
    }

    private <T> T convertPayload(JsonNode payload, Class<T> type) {
        if (payload == null || payload.isNull()) {
            return null;
        }
        return objectMapper.convertValue(payload, type);
    }

    private String normalizeType(String resourceType) {
        return NormalizeUtils.normalize(resourceType, "resourceType 不能为空").toUpperCase(Locale.ROOT);
    }

    private String normalizeOperation(String operation) {
        return NormalizeUtils.normalize(operation, "operation 不能为空").toLowerCase(Locale.ROOT);
    }

    private String normalizeRepositoryId(ResourceLifecycleRequest request) {
        return NormalizeUtils.normalize(request.getRepositoryId(), "repositoryId 不能为空");
    }

    private String normalizeResourceId(ResourceLifecycleRequest request, String message) {
        return NormalizeUtils.normalize(resolveResourceId(request), message);
    }

    private String resolveResourceId(ResourceLifecycleRequest request) {
        return request.getResourceId();
    }

    private IllegalArgumentException unsupported(String operation, String resourceType) {
        return new IllegalArgumentException("资源类型 " + resourceType + " 不支持操作: " + operation);
    }
}
