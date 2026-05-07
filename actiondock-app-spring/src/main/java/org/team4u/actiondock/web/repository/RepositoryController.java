package org.team4u.actiondock.web.repository;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.RepositoryEventSourceInstallation;
import org.team4u.actiondock.domain.model.RepositoryToolInstallation;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.repository.RepositoryCatalogService;
import org.team4u.actiondock.repository.RepositoryCatalogTypes;
import org.team4u.actiondock.repository.RepositoryCatalogTypes.ToolInstallationOptions;
import org.team4u.actiondock.repository.RepositoryCapabilityPackageService;
import org.team4u.actiondock.repository.RepositoryEventSourceService;
import org.team4u.actiondock.repository.RepositoryPluginService;
import org.team4u.actiondock.repository.RepositorySkillService;
import org.team4u.actiondock.repository.RepositoryToolService;
import org.team4u.actiondock.web.common.ApiResponse;

import java.io.IOException;
import java.util.List;
import java.util.function.Function;

/**
 * 工具仓库 REST 控制器。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/repositories")
public class RepositoryController {
    private final RepositoryCatalogService repositoryCatalogService;
    private final RepositoryPluginService repositoryPluginService;
    private final RepositoryToolService repositoryToolService;
    private final RepositoryEventSourceService repositoryEventSourceService;
    private final RepositoryCapabilityPackageService repositoryCapabilityPackageService;
    private final RepositorySkillService repositorySkillService;

    public RepositoryController(RepositoryCatalogService repositoryCatalogService,
                                RepositoryPluginService repositoryPluginService,
                                RepositoryToolService repositoryToolService,
                                RepositoryEventSourceService repositoryEventSourceService,
                                RepositoryCapabilityPackageService repositoryCapabilityPackageService,
                                RepositorySkillService repositorySkillService) {
        this.repositoryCatalogService = repositoryCatalogService;
        this.repositoryPluginService = repositoryPluginService;
        this.repositoryToolService = repositoryToolService;
        this.repositoryEventSourceService = repositoryEventSourceService;
        this.repositoryCapabilityPackageService = repositoryCapabilityPackageService;
        this.repositorySkillService = repositorySkillService;
    }

    /**
     * 查询所有仓库定义列表。
     *
     * @return API 响应，包含仓库定义列表
     */
    @GetMapping
    public ApiResponse<List<RepositoryDefinition>> list() {
        return ApiResponse.success(repositoryCatalogService.listRepositories());
    }

    /**
     * 创建仓库定义。
     *
     * @param request 仓库定义内容
     * @return API 响应，包含创建后的仓库定义
     */
    @PostMapping
    public ApiResponse<RepositoryDefinition> create(@RequestBody RepositoryDefinition request) {
        return ApiResponse.success(repositoryCatalogService.saveRepository(request), "仓库已创建");
    }

    /**
     * 更新仓库定义。
     *
     * @param id 仓库 ID
     * @param request 仓库定义内容
     * @return API 响应，包含更新后的仓库定义
     */
    @PutMapping("/{id}")
    public ApiResponse<RepositoryDefinition> update(@PathVariable String id, @RequestBody RepositoryDefinition request) {
        request.setId(id);
        return ApiResponse.success(repositoryCatalogService.saveRepository(request), "仓库已更新");
    }

    /**
     * 删除仓库定义。
     *
     * @param id 仓库 ID
     * @return API 响应，无数据
     */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        repositoryCatalogService.deleteRepository(id);
        return ApiResponse.success(null, "仓库已删除");
    }

    /**
     * 同步仓库工具列表。
     *
     * @param id 仓库 ID
     * @return API 响应，包含同步后的仓库定义
     */
    @PostMapping("/{id}/sync")
    public ApiResponse<RepositoryDefinition> sync(@PathVariable String id) {
        return ApiResponse.success(repositoryCatalogService.syncRepository(id), "同步完成");
    }

    /**
     * 查询所有仓库的工具列表。
     *
     * @return API 响应，包含工具描述符列表
     */
    @GetMapping("/tools")
    public ApiResponse<List<RepositoryCatalogTypes.RepositoryToolDescriptor>> listAllTools() {
        return ApiResponse.success(repositoryCatalogService.listAllRepositoryTools());
    }

    /**
     * 查询指定仓库的工具列表。
     *
     * @param id 仓库 ID
     * @return API 响应，包含工具描述符列表
     */
    @GetMapping("/{id}/tools")
    public ApiResponse<List<RepositoryCatalogTypes.RepositoryToolDescriptor>> listRepositoryTools(@PathVariable String id) {
        return ApiResponse.success(repositoryCatalogService.listRepositoryTools(id));
    }

    @GetMapping("/event-sources")
    public ApiResponse<List<RepositoryCatalogTypes.RepositoryEventSourceDescriptor>> listAllEventSources() {
        return ApiResponse.success(repositoryCatalogService.listAllRepositoryEventSources());
    }

    @GetMapping("/{id}/event-sources")
    public ApiResponse<List<RepositoryCatalogTypes.RepositoryEventSourceDescriptor>> listRepositoryEventSources(@PathVariable String id) {
        return ApiResponse.success(repositoryCatalogService.listRepositoryEventSources(id));
    }

    @GetMapping("/{id}/event-sources/{eventSourceId}")
    public ApiResponse<RepositoryCatalogTypes.RepositoryEventSourceDetail> eventSourceDetail(@PathVariable String id,
                                                                                             @PathVariable String eventSourceId) {
        return ApiResponse.success(repositoryCatalogService.getRepositoryEventSource(id, eventSourceId));
    }

    @GetMapping("/packages")
    public ApiResponse<List<RepositoryCatalogTypes.CapabilityPackageDescriptor>> listAllPackages() {
        return ApiResponse.success(repositoryCatalogService.listAllCapabilityPackages());
    }

    @GetMapping("/{id}/packages")
    public ApiResponse<List<RepositoryCatalogTypes.CapabilityPackageDescriptor>> listRepositoryPackages(@PathVariable String id) {
        return ApiResponse.success(repositoryCatalogService.listCapabilityPackages(id));
    }

    @GetMapping("/{id}/packages/{packageId}")
    public ApiResponse<RepositoryCatalogTypes.CapabilityPackageDetail> capabilityPackageDetail(@PathVariable String id,
                                                                                                 @PathVariable String packageId) {
        return ApiResponse.success(repositoryCatalogService.getCapabilityPackage(id, packageId));
    }

    @GetMapping("/plugins")
    public ApiResponse<List<RepositoryCatalogTypes.RepositoryPluginDescriptor>> listAllPlugins() {
        return ApiResponse.success(repositoryCatalogService.listAllRepositoryPlugins());
    }

    @GetMapping("/skills")
    public ApiResponse<List<RepositoryCatalogTypes.RepositorySkillDescriptor>> listAllSkills() {
        return ApiResponse.success(repositorySkillService.listAllRepositorySkills());
    }

    @GetMapping("/{id}/plugins")
    public ApiResponse<List<RepositoryCatalogTypes.RepositoryPluginDescriptor>> listRepositoryPlugins(@PathVariable String id) {
        return ApiResponse.success(repositoryCatalogService.listRepositoryPlugins(id));
    }

    @GetMapping("/{id}/skills")
    public ApiResponse<List<RepositoryCatalogTypes.RepositorySkillDescriptor>> listRepositorySkills(@PathVariable String id) {
        return ApiResponse.success(repositorySkillService.listRepositorySkills(id));
    }

    @GetMapping("/{id}/plugins/{pluginId}")
    public ApiResponse<RepositoryCatalogTypes.RepositoryPluginDetail> pluginDetail(@PathVariable String id,
                                                                                     @PathVariable String pluginId) {
        return ApiResponse.success(repositoryCatalogService.getRepositoryPlugin(id, pluginId));
    }

    @GetMapping("/{id}/skills/{skillId}")
    public ApiResponse<RepositoryCatalogTypes.RepositorySkillDetail> skillDetail(@PathVariable String id,
                                                                                   @PathVariable String skillId) {
        return ApiResponse.success(repositorySkillService.getRepositorySkill(id, skillId));
    }

    @GetMapping("/{id}/skills/{skillId}/archive")
    public ResponseEntity<byte[]> skillArchive(@PathVariable String id,
                                               @PathVariable String skillId) {
        RepositoryCatalogTypes.RepositoryBinaryArchive archive = repositorySkillService.exportRepositorySkillArchive(id, skillId);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + archive.fileName() + "\"")
                .body(archive.content());
    }

    @PostMapping("/{id}/plugins/{pluginId}/install")
    public ApiResponse<RepositoryCatalogTypes.RepositoryPluginInstallResult> installPlugin(@PathVariable String id,
                                                                                            @PathVariable String pluginId,
                                                                                            @RequestBody(required = false) RepositoryPluginInstallRequest request) {
        return resolveForceAndApply(request, force -> repositoryPluginService.installPlugin(id, pluginId, force), "插件安装完成");
    }

    @PostMapping("/{id}/plugins/{pluginId}/update")
    public ApiResponse<RepositoryCatalogTypes.RepositoryPluginInstallResult> updatePlugin(@PathVariable String id,
                                                                                           @PathVariable String pluginId,
                                                                                           @RequestBody(required = false) RepositoryPluginInstallRequest request) {
        return resolveForceAndApply(request, force -> repositoryPluginService.updatePlugin(id, pluginId, force), "插件更新完成");
    }

    /**
     * 查询仓库中指定工具的详情。
     *
     * @param id 仓库 ID
     * @param toolId 工具 ID
     * @return API 响应，包含工具详情
     */
    @GetMapping("/{id}/tools/{toolId}")
    public ApiResponse<RepositoryCatalogTypes.RepositoryToolDetail> detail(@PathVariable String id,
                                                                             @PathVariable String toolId) {
        return ApiResponse.success(repositoryCatalogService.getRepositoryTool(id, toolId));
    }

    /**
     * 从仓库安装指定工具到本地。
     *
     * @param id 仓库 ID
     * @param toolId 工具 ID
     * @param request 安装请求，可指定是否同时安装调度配置
     * @return API 响应，包含安装记录
     */
    @PostMapping("/{id}/tools/{toolId}/install")
    public ApiResponse<RepositoryToolInstallation> install(@PathVariable String id,
                                                     @PathVariable String toolId,
                                                     @RequestBody(required = false) RepositoryInstallRequest request) {
        return resolveOptionsAndApply(request,
                options -> repositoryToolService.installTool(id, toolId, options), "安装完成");
    }

    /**
     * 更新已安装的仓库工具到最新版本。
     *
     * @param id 仓库 ID
     * @param toolId 工具 ID
     * @param request 更新请求，可指定是否同时更新调度配置
     * @return API 响应，包含更新后的安装记录
     */
    @PostMapping("/{id}/tools/{toolId}/update")
    public ApiResponse<RepositoryToolInstallation> update(@PathVariable String id,
                                                    @PathVariable String toolId,
                                                    @RequestBody(required = false) RepositoryInstallRequest request) {
        return resolveOptionsAndApply(request,
                options -> repositoryToolService.updateTool(id, toolId, options), "更新完成");
    }

    @PostMapping("/{id}/tools/{toolId}/develop")
    public ApiResponse<ScriptDefinition> develop(@PathVariable String id,
                                                 @PathVariable String toolId,
                                                 @RequestBody(required = false) RepositoryCatalogTypes.DevelopmentSyncRequest request) {
        return ApiResponse.success(repositoryToolService.syncToolForDevelopment(id, toolId, request), "已同步为开发脚本");
    }

    /**
     * 将本地脚本发布到仓库。
     *
     * @param id 仓库 ID
     * @param request 发布请求，包含待发布的脚本信息
     * @return API 响应，包含发布后的工具描述符
     */
    @PostMapping("/{id}/publish")
    public ApiResponse<RepositoryCatalogTypes.RepositoryToolDescriptor> publish(@PathVariable String id,
                                                                                  @RequestBody RepositoryCatalogTypes.RepositoryPublishRequest request) {
        return ApiResponse.success(repositoryToolService.publishTool(id, request), "发布完成");
    }

    @PostMapping("/{id}/packages/preview")
    public ApiResponse<RepositoryCatalogTypes.CapabilityPackagePublishPreview> previewCapabilityPackage(
            @PathVariable String id,
            @RequestBody RepositoryCatalogTypes.CapabilityPackagePublishRequest request) {
        return ApiResponse.success(repositoryCapabilityPackageService.previewCapabilityPackage(id, request));
    }

    @PostMapping("/{id}/packages/publish")
    public ApiResponse<RepositoryCatalogTypes.CapabilityPackageDescriptor> publishCapabilityPackage(
            @PathVariable String id,
            @RequestBody RepositoryCatalogTypes.CapabilityPackagePublishRequest request) {
        return ApiResponse.success(repositoryCapabilityPackageService.publishCapabilityPackage(id, request), "能力包发布完成");
    }

    @PostMapping("/publish-config-preview")
    public ApiResponse<RepositoryCatalogTypes.RepositoryPublishConfigPreview> previewPublishConfig(
            @RequestBody RepositoryCatalogTypes.RepositoryPublishConfigPreviewRequest request) {
        return ApiResponse.success(repositoryToolService.previewPublishConfig(request));
    }

    @PostMapping("/{id}/publish-plugin")
    public ApiResponse<RepositoryCatalogTypes.RepositoryPluginDescriptor> publishPlugin(@PathVariable String id,
                                                                                         @RequestBody RepositoryCatalogTypes.RepositoryPluginPublishRequest request) {
        return ApiResponse.success(repositoryCatalogService.publishPlugin(id, request), "插件发布完成");
    }

    @PostMapping(value = "/{id}/publish-skill-archive", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<RepositoryCatalogTypes.RepositorySkillDescriptor> publishSkillArchive(@PathVariable String id,
                                                                                                @RequestParam(value = "releaseNotes", required = false) String releaseNotes,
                                                                                                @RequestParam("archive") MultipartFile archive) throws IOException {
        return ApiResponse.success(
                repositoryCatalogService.publishSkillArchive(id, releaseNotes, archive.getOriginalFilename(), archive.getBytes()),
                "Skill 发布完成"
        );
    }

    @PostMapping("/{id}/packages/{packageId}/install")
    public ApiResponse<RepositoryCatalogTypes.CapabilityPackageInstallResult> installCapabilityPackage(@PathVariable String id,
                                                                                                          @PathVariable String packageId) {
        return ApiResponse.success(repositoryCapabilityPackageService.installCapabilityPackage(id, packageId), "能力包安装完成");
    }

    @PostMapping("/{id}/packages/{packageId}/update")
    public ApiResponse<RepositoryCatalogTypes.CapabilityPackageInstallResult> updateCapabilityPackage(@PathVariable String id,
                                                                                                         @PathVariable String packageId) {
        return ApiResponse.success(repositoryCapabilityPackageService.updateCapabilityPackage(id, packageId), "能力包更新完成");
    }

    @DeleteMapping("/{id}/packages/{packageId}")
    public ApiResponse<Void> uninstallCapabilityPackage(@PathVariable String id,
                                                        @PathVariable String packageId) {
        repositoryCapabilityPackageService.uninstallCapabilityPackage(id, packageId);
        return ApiResponse.success(null, "能力包已卸载");
    }

    private <T> ApiResponse<T> resolveForceAndApply(RepositoryPluginInstallRequest request,
                                                    Function<Boolean, T> action,
                                                    String successMessage) {
        boolean force = request != null && request.isForce();
        return ApiResponse.success(action.apply(force), successMessage);
    }

    private <T> ApiResponse<T> resolveOptionsAndApply(RepositoryInstallRequest request,
                                                      Function<ToolInstallationOptions, T> action,
                                                      String successMessage) {
        ToolInstallationOptions options = request != null
                ? new ToolInstallationOptions(request.isInstallSchedules(), request.isInstallScriptDependencies(), request.isInstallPluginDependencies(), request.isForcePluginUpgrade())
                : ToolInstallationOptions.DEFAULT;
        return ApiResponse.success(action.apply(options), successMessage);
    }
}
