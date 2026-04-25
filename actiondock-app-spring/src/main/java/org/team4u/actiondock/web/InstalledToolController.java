package org.team4u.actiondock.web;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.repository.RepositoryCatalogService;

/**
 * 已安装仓库工具控制器。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/installed-tools")
public class InstalledToolController {
    private final RepositoryCatalogService repositoryCatalogService;

    public InstalledToolController(RepositoryCatalogService repositoryCatalogService) {
        this.repositoryCatalogService = repositoryCatalogService;
    }

    @DeleteMapping("/{scriptId}")
    public ApiResponse<Void> uninstall(@PathVariable String scriptId) {
        repositoryCatalogService.uninstallTool(scriptId);
        return ApiResponse.success(null, "已卸载");
    }
}
