package org.team4u.actiondock.web.repository;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.repository.RepositoryScriptService;
import org.team4u.actiondock.web.common.ApiResponse;

/**
 * 已安装仓库脚本控制器。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/installed-scripts")
public class InstalledToolController {
    private final RepositoryScriptService repositoryToolService;

    public InstalledToolController(RepositoryScriptService repositoryToolService) {
        this.repositoryToolService = repositoryToolService;
    }

    @DeleteMapping("/{scriptId}")
    public ApiResponse<Void> uninstall(@PathVariable String scriptId) {
        repositoryToolService.uninstallScript(scriptId);
        return ApiResponse.success(null, "已卸载");
    }
}
