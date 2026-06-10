package org.team4u.actiondock.web.repository;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.repository.InstalledResourceService;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.List;

@RestController
@RequestMapping("/api/installed-resources")
public class InstalledResourceController {
    private final InstalledResourceService installedResourceService;

    public InstalledResourceController(InstalledResourceService installedResourceService) {
        this.installedResourceService = installedResourceService;
    }

    @GetMapping
    public ApiResponse<List<InstalledResourceService.InstalledResourceView>> list() {
        return ApiResponse.success(installedResourceService.list());
    }

    @PostMapping("/uninstall")
    public ApiResponse<Void> uninstall(@RequestBody InstalledResourceUninstallRequest request) {
        InstalledResourceUninstallRequest safeRequest = request == null ? new InstalledResourceUninstallRequest() : request;
        installedResourceService.uninstall(safeRequest.getType(), safeRequest.getId());
        return ApiResponse.success(null, "资源已卸载");
    }
}
