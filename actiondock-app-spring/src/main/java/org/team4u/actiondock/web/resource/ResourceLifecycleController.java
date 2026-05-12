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
import org.team4u.actiondock.repository.RepositoryEventSourceService;
import org.team4u.actiondock.repository.RepositoryPluginService;
import org.team4u.actiondock.repository.RepositoryToolService;
import org.team4u.actiondock.repository.RepositoryCatalogTypes.ToolInstallationOptions;
import org.team4u.actiondock.shared.NormalizeUtils;
import org.team4u.actiondock.web.common.ApiResponse;
import org.team4u.actiondock.web.repository.RepositoryInstallRequest;
import org.team4u.actiondock.web.repository.RepositoryPluginInstallRequest;
import org.team4u.actiondock.web.script.ScriptViewMapper;

import java.util.Locale;

/**
 * 统一资源生命周期 facade。
 * <p>
 * 首批覆盖仓库工具、仓库插件和能力包；底层仍复用现有资源服务。
 */
@RestController
@RequestMapping("/api/resource-lifecycle")
public class ResourceLifecycleController {
    private static final String RESOURCE_REPOSITORY_TOOL = "REPOSITORY_TOOL";
    private static final String RESOURCE_REPOSITORY_EVENT_SOURCE = "REPOSITORY_EVENT_SOURCE";
    private static final String RESOURCE_REPOSITORY_PLUGIN = "REPOSITORY_PLUGIN";
    private static final String RESOURCE_CAPABILITY_PACKAGE = "CAPABILITY_PACKAGE";

    private static final String OP_INSTALL = "install";
    private static final String OP_UPDATE = "update";
    private static final String OP_WORKING_COPY = "working-copy";
    private static final String OP_PUBLISH = "publish";
    private static final String OP_PREVIEW = "preview";
    private static final String OP_UNINSTALL = "uninstall";

    private final RepositoryCatalogService repositoryCatalogService;
    private final RepositoryToolService repositoryToolService;
    private final RepositoryEventSourceService repositoryEventSourceService;
    private final RepositoryPluginService repositoryPluginService;
    private final RepositoryCapabilityPackageService repositoryCapabilityPackageService;
    private final ObjectMapper objectMapper;

    public ResourceLifecycleController(RepositoryCatalogService repositoryCatalogService,
                                       RepositoryToolService repositoryToolService,
                                       RepositoryEventSourceService repositoryEventSourceService,
                                       RepositoryPluginService repositoryPluginService,
                                       RepositoryCapabilityPackageService repositoryCapabilityPackageService,
                                       ObjectMapper objectMapper) {
        this.repositoryCatalogService = repositoryCatalogService;
        this.repositoryToolService = repositoryToolService;
        this.repositoryEventSourceService = repositoryEventSourceService;
        this.repositoryPluginService = repositoryPluginService;
        this.repositoryCapabilityPackageService = repositoryCapabilityPackageService;
        this.objectMapper = objectMapper;
    }

    @PostMapping("/operations")
    public ApiResponse<ResourceLifecycleOperationView> execute(@RequestBody ResourceLifecycleRequest request) {
        ResourceLifecycleRequest safeRequest = request == null ? new ResourceLifecycleRequest() : request;
        String resourceType = normalizeType(safeRequest.getResourceType());
        String operation = normalizeOperation(safeRequest.getOperation());
        Object result = switch (resourceType) {
            case RESOURCE_REPOSITORY_TOOL -> executeRepositoryTool(operation, safeRequest);
            case RESOURCE_REPOSITORY_EVENT_SOURCE -> executeRepositoryEventSource(operation, safeRequest);
            case RESOURCE_REPOSITORY_PLUGIN -> executeRepositoryPlugin(operation, safeRequest);
            case RESOURCE_CAPABILITY_PACKAGE -> executeCapabilityPackage(operation, safeRequest);
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
            case OP_INSTALL -> repositoryToolService.installTool(normalizeRepositoryId(request),
                    normalizeResourceId(request, "toolId 不能为空"), toolOptions(request.getPayload()));
            case OP_UPDATE -> repositoryToolService.updateTool(normalizeRepositoryId(request),
                    normalizeResourceId(request, "toolId 不能为空"), toolOptions(request.getPayload()));
            case OP_WORKING_COPY -> ScriptViewMapper.toView(
                    repositoryToolService.createToolWorkingCopy(normalizeRepositoryId(request),
                            normalizeResourceId(request, "toolId 不能为空"),
                            convertPayload(request.getPayload(), RepositoryCatalogTypes.WorkingCopyRequest.class)),
                    true
            );
            case OP_PUBLISH -> repositoryToolService.publishTool(normalizeRepositoryId(request),
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.RepositoryPublishRequest.class));
            case OP_PREVIEW -> repositoryToolService.previewPublishConfig(
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.RepositoryPublishConfigPreviewRequest.class));
            case OP_UNINSTALL -> {
                String installedResourceId = NormalizeUtils.normalize(request.getInstalledResourceId(), "installedResourceId 不能为空");
                repositoryToolService.uninstallTool(installedResourceId);
                yield null;
            }
            default -> throw unsupported(operation, RESOURCE_REPOSITORY_TOOL);
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

    private Object executeRepositoryEventSource(String operation, ResourceLifecycleRequest request) {
        return switch (operation) {
            case OP_INSTALL -> repositoryEventSourceService.installEventSource(normalizeRepositoryId(request),
                    normalizeResourceId(request, "eventSourceId 不能为空"), toolOptions(request.getPayload()));
            case OP_UPDATE -> repositoryEventSourceService.updateEventSource(normalizeRepositoryId(request),
                    normalizeResourceId(request, "eventSourceId 不能为空"), toolOptions(request.getPayload()));
            case OP_WORKING_COPY -> repositoryEventSourceService.createEventSourceWorkingCopy(normalizeRepositoryId(request),
                    normalizeResourceId(request, "eventSourceId 不能为空"),
                    convertPayload(request.getPayload(), RepositoryCatalogTypes.WorkingCopyRequest.class));
            case OP_PUBLISH -> repositoryEventSourceService.publishEventSource(normalizeRepositoryId(request),
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.RepositoryEventSourcePublishRequest.class));
            case OP_PREVIEW -> repositoryEventSourceService.previewPublish(
                    requirePayload(request.getPayload(), RepositoryCatalogTypes.RepositoryEventSourcePublishPreviewRequest.class));
            case OP_UNINSTALL -> {
                String installedResourceId = NormalizeUtils.normalize(request.getInstalledResourceId(), "installedResourceId 不能为空");
                repositoryEventSourceService.uninstallEventSource(installedResourceId);
                yield null;
            }
            default -> throw unsupported(operation, RESOURCE_REPOSITORY_EVENT_SOURCE);
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
