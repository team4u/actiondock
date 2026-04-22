package org.team4u.scriptflow.web;

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
import org.team4u.scriptflow.plugin.PluginConfigView;
import org.team4u.scriptflow.plugin.PluginInvokeView;
import org.team4u.scriptflow.plugin.PluginRuntimeService;
import org.team4u.scriptflow.plugin.PluginView;

import java.io.IOException;
import java.util.List;

@RestController
@RequestMapping("/api/plugins")
public class PluginController {
    private final PluginRuntimeService pluginRuntimeService;

    public PluginController(PluginRuntimeService pluginRuntimeService) {
        this.pluginRuntimeService = pluginRuntimeService;
    }

    @GetMapping
    public ApiResponse<List<PluginView>> list() {
        return ApiResponse.success(pluginRuntimeService.list());
    }

    @GetMapping("/{pluginId}")
    public ApiResponse<PluginView> get(@PathVariable String pluginId) {
        return ApiResponse.success(pluginRuntimeService.get(pluginId));
    }

    @PostMapping("/install")
    public ApiResponse<PluginView> install(@RequestParam("file") MultipartFile file) throws IOException {
        return ApiResponse.success(
                pluginRuntimeService.install(file.getOriginalFilename(), file.getBytes()),
                "插件安装成功"
        );
    }

    @PostMapping("/{pluginId}/upgrade")
    public ApiResponse<PluginView> upgrade(@PathVariable String pluginId, @RequestParam("file") MultipartFile file) throws IOException {
        return ApiResponse.success(
                pluginRuntimeService.upgrade(pluginId, file.getOriginalFilename(), file.getBytes()),
                "插件已升级"
        );
    }

    @PostMapping("/{pluginId}/start")
    public ApiResponse<PluginView> start(@PathVariable String pluginId) {
        return ApiResponse.success(pluginRuntimeService.start(pluginId), "插件已启动");
    }

    @PostMapping("/{pluginId}/stop")
    public ApiResponse<PluginView> stop(@PathVariable String pluginId) {
        return ApiResponse.success(pluginRuntimeService.stop(pluginId), "插件已停止");
    }

    @GetMapping("/{pluginId}/config")
    public ApiResponse<PluginConfigView> getConfig(@PathVariable String pluginId) {
        return ApiResponse.success(pluginRuntimeService.getConfig(pluginId));
    }

    @PutMapping("/{pluginId}/config")
    public ApiResponse<PluginConfigView> saveConfig(@PathVariable String pluginId, @RequestBody PluginConfigRequest request) {
        return ApiResponse.success(
                pluginRuntimeService.saveConfig(pluginId, request == null ? null : request.getConfig()),
                "插件配置已保存"
        );
    }

    @PostMapping("/{pluginId}/actions/{action}/invoke")
    public ApiResponse<PluginInvokeView> invoke(@PathVariable String pluginId,
                                                @PathVariable String action,
                                                @RequestBody(required = false) PluginInvokeRequest request) {
        PluginInvokeRequest invokeRequest = request == null ? new PluginInvokeRequest() : request;
        return ApiResponse.success(
                pluginRuntimeService.invokeForDebug(
                        pluginId,
                        action,
                        invokeRequest.getArgs(),
                        invokeRequest.getScriptInput(),
                        invokeRequest.getResponseView() == ExecutionResponseView.DEBUG
                ),
                "插件调用成功"
        );
    }

    @DeleteMapping("/{pluginId}")
    public ApiResponse<Void> uninstall(@PathVariable String pluginId) {
        pluginRuntimeService.uninstall(pluginId);
        return ApiResponse.success(null, "插件已卸载");
    }
}
