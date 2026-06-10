package org.team4u.actiondock.web.plugin;

import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
import org.team4u.actiondock.plugin.PluginConfigView;
import org.team4u.actiondock.plugin.PluginInvokeView;
import org.team4u.actiondock.plugin.PluginReferenceView;
import org.team4u.actiondock.plugin.PluginRuntimeService;
import org.team4u.actiondock.plugin.PluginSummaryView;
import org.team4u.actiondock.plugin.PluginView;
import org.team4u.actiondock.web.common.ApiResponse;
import org.team4u.actiondock.web.common.IntentFilter;
import org.team4u.actiondock.web.execution.ExecutionResponseView;

import java.io.IOException;
import java.util.List;

/**
 * 插件管理 REST 控制器，提供插件的安装、启停、配置和调用端点。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/plugins")
public class PluginController {
    private final PluginRuntimeService pluginRuntimeService;

    public PluginController(PluginRuntimeService pluginRuntimeService) {
        this.pluginRuntimeService = pluginRuntimeService;
    }

    /**
     * 查询所有已安装插件列表。
     *
     * @return API 响应，包含插件视图列表
     */
    @GetMapping
    public ApiResponse<List<PluginSummaryView>> list(@RequestParam(required = false) String intent) {
        return ApiResponse.success(IntentFilter.filter(pluginRuntimeService.list(), intent,
                PluginSummaryView::getPluginId,
                PluginSummaryView::getName,
                PluginSummaryView::getVersion,
                PluginSummaryView::getDescription
        ));
    }

    /**
     * 查询脚本编辑器可用的插件参考。
     *
     * @return API 响应，包含可展示和复制示例的插件参考列表
     */
    @GetMapping("/references")
    public ApiResponse<List<PluginReferenceView>> listReferences() {
        return ApiResponse.success(pluginRuntimeService.listPluginReferences());
    }

    /**
     * 查询单个插件详情。
     *
     * @param pluginId 插件 ID
     * @return API 响应，包含插件视图
     */
    @GetMapping("/{pluginId}")
    public ApiResponse<PluginView> get(@PathVariable String pluginId) {
        return ApiResponse.success(pluginRuntimeService.get(pluginId));
    }

    @GetMapping("/{pluginId}/download")
    public ResponseEntity<Resource> download(@PathVariable String pluginId) {
        PluginView plugin = pluginRuntimeService.get(pluginId);
        byte[] content = pluginRuntimeService.readPluginFile(pluginId);
        String fileName = plugin.getFileName() != null ? plugin.getFileName() : pluginId + ".jar";
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/java-archive"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
                .body(new ByteArrayResource(content));
    }

    /**
     * 通过上传 JAR 文件安装插件。
     *
     * @param file 上传的插件 JAR 文件
     * @return API 响应，包含安装后的插件视图
     * @throws IOException 文件读取异常
     */
    @PostMapping("/install")
    public ApiResponse<PluginView> install(@RequestParam("file") MultipartFile file) throws IOException {
        return ApiResponse.success(
                pluginRuntimeService.install(file.getOriginalFilename(), file.getBytes()),
                "插件安装成功"
        );
    }

    /**
     * 通过上传新版本 JAR 文件升级插件。
     *
     * @param pluginId 待升级的插件 ID
     * @param file 上传的新版本 JAR 文件
     * @return API 响应，包含升级后的插件视图
     * @throws IOException 文件读取异常
     */
    @PostMapping("/{pluginId}/upgrade")
    public ApiResponse<PluginView> upgrade(@PathVariable String pluginId, @RequestParam("file") MultipartFile file) throws IOException {
        return ApiResponse.success(
                pluginRuntimeService.upgrade(pluginId, file.getOriginalFilename(), file.getBytes()),
                "插件已升级"
        );
    }

    /**
     * 启动指定插件。
     *
     * @param pluginId 插件 ID
     * @return API 响应，包含启动后的插件视图
     */
    @PostMapping("/{pluginId}/start")
    public ApiResponse<PluginView> start(@PathVariable String pluginId) {
        return ApiResponse.success(pluginRuntimeService.start(pluginId), "插件已启动");
    }

    /**
     * 停止指定插件。
     *
     * @param pluginId 插件 ID
     * @return API 响应，包含停止后的插件视图
     */
    @PostMapping("/{pluginId}/stop")
    public ApiResponse<PluginView> stop(@PathVariable String pluginId) {
        return ApiResponse.success(pluginRuntimeService.stop(pluginId), "插件已停止");
    }

    /**
     * 查询插件当前配置。
     *
     * @param pluginId 插件 ID
     * @return API 响应，包含插件配置视图
     */
    @GetMapping("/{pluginId}/config")
    public ApiResponse<PluginConfigView> getConfig(@PathVariable String pluginId) {
        return ApiResponse.success(pluginRuntimeService.getConfig(pluginId));
    }

    @GetMapping("/{pluginId}/configs")
    public ApiResponse<List<PluginConfigView>> listConfigs(@PathVariable String pluginId) {
        return ApiResponse.success(pluginRuntimeService.listConfigs(pluginId));
    }

    @GetMapping("/{pluginId}/configs/{configName}")
    public ApiResponse<PluginConfigView> getNamedConfig(@PathVariable String pluginId,
                                                        @PathVariable String configName) {
        return ApiResponse.success(pluginRuntimeService.getConfig(pluginId, configName));
    }

    /**
     * 保存插件配置。
     *
     * @param pluginId 插件 ID
     * @param request 插件配置更新请求，包含新的配置键值对
     * @return API 响应，包含更新后的插件配置视图
     */
    @PutMapping("/{pluginId}/config")
    public ApiResponse<PluginConfigView> saveConfig(@PathVariable String pluginId, @RequestBody PluginConfigRequest request) {
        return ApiResponse.success(
                pluginRuntimeService.saveConfig(pluginId, request == null ? null : request.getConfig()),
                "插件配置已保存"
        );
    }

    @PutMapping("/{pluginId}/configs/{configName}")
    public ApiResponse<PluginConfigView> saveNamedConfig(@PathVariable String pluginId,
                                                         @PathVariable String configName,
                                                         @RequestBody PluginConfigRequest request) {
        return ApiResponse.success(
                pluginRuntimeService.saveConfig(pluginId, configName, request == null ? null : request.getConfig()),
                "插件配置已保存"
        );
    }

    @DeleteMapping("/{pluginId}/configs/{configName}")
    public ApiResponse<Void> deleteNamedConfig(@PathVariable String pluginId,
                                               @PathVariable String configName) {
        pluginRuntimeService.deleteConfig(pluginId, configName);
        return ApiResponse.success(null, "插件配置已删除");
    }

    /**
     * 调试调用插件指定动作。
     * <p>
     * 用于在管理界面测试插件动作的执行效果，支持传入模拟参数和脚本输入。
     *
     * @param pluginId 插件 ID
     * @param action 动作名称
     * @param request 调用请求，包含动作参数和模拟脚本输入
     * @return API 响应，包含插件调用结果视图
     */
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
                        invokeRequest.getResponseView() == ExecutionResponseView.DEBUG,
                        invokeRequest.getConfigName()
                ),
                "插件调用成功"
        );
    }

    /**
     * 卸载指定插件。
     *
     * @param pluginId 插件 ID
     * @return API 响应，无数据
     */
    @DeleteMapping("/{pluginId}")
    public ApiResponse<Void> uninstall(@PathVariable String pluginId,
                                       @RequestParam(defaultValue = "false") boolean force) {
        pluginRuntimeService.uninstall(pluginId, force);
        return ApiResponse.success(null, "插件已卸载");
    }
}
