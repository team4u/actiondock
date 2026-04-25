package org.team4u.actiondock.web;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.domain.model.RepositoryDefinition;
import org.team4u.actiondock.domain.model.RepositoryToolInstallation;
import org.team4u.actiondock.repository.RepositoryCatalogService;

import java.util.List;

/**
 * 工具仓库 REST 控制器。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/repositories")
public class RepositoryController {
    private final RepositoryCatalogService repositoryCatalogService;

    public RepositoryController(RepositoryCatalogService repositoryCatalogService) {
        this.repositoryCatalogService = repositoryCatalogService;
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
    public ApiResponse<List<RepositoryCatalogService.RepositoryToolDescriptor>> listAllTools() {
        return ApiResponse.success(repositoryCatalogService.listAllRepositoryTools());
    }

    /**
     * 查询指定仓库的工具列表。
     *
     * @param id 仓库 ID
     * @return API 响应，包含工具描述符列表
     */
    @GetMapping("/{id}/tools")
    public ApiResponse<List<RepositoryCatalogService.RepositoryToolDescriptor>> listRepositoryTools(@PathVariable String id) {
        return ApiResponse.success(repositoryCatalogService.listRepositoryTools(id));
    }

    /**
     * 查询仓库中指定工具的详情。
     *
     * @param id 仓库 ID
     * @param toolId 工具 ID
     * @return API 响应，包含工具详情
     */
    @GetMapping("/{id}/tools/{toolId}")
    public ApiResponse<RepositoryCatalogService.RepositoryToolDetail> detail(@PathVariable String id,
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
        boolean installSchedules = request != null && request.isInstallSchedules();
        return ApiResponse.success(repositoryCatalogService.installTool(id, toolId, installSchedules), "安装完成");
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
        boolean installSchedules = request != null && request.isInstallSchedules();
        return ApiResponse.success(repositoryCatalogService.updateTool(id, toolId, installSchedules), "更新完成");
    }

    /**
     * 将本地脚本发布到仓库。
     *
     * @param id 仓库 ID
     * @param request 发布请求，包含待发布的脚本信息
     * @return API 响应，包含发布后的工具描述符
     */
    @PostMapping("/{id}/publish")
    public ApiResponse<RepositoryCatalogService.RepositoryToolDescriptor> publish(@PathVariable String id,
                                                                                  @RequestBody RepositoryCatalogService.RepositoryPublishRequest request) {
        return ApiResponse.success(repositoryCatalogService.publishTool(id, request), "发布完成");
    }
}
