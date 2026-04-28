package org.team4u.actiondock.web;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.SharedStateApplicationService;
import org.team4u.actiondock.domain.model.SharedStateEntry;

import java.util.List;

/**
 * 共享状态 REST 控制器。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/shared-state")
public class SharedStateController {
    private final SharedStateApplicationService sharedStateApplicationService;

    public SharedStateController(SharedStateApplicationService sharedStateApplicationService) {
        this.sharedStateApplicationService = sharedStateApplicationService;
    }

    @GetMapping("/namespaces")
    public ApiResponse<List<String>> namespaces() {
        return ApiResponse.success(sharedStateApplicationService.listNamespaces());
    }

    @GetMapping
    public ApiResponse<List<SharedStateSummaryView>> list(@RequestParam String namespace) {
        return ApiResponse.success(sharedStateApplicationService.list(namespace).stream().map(this::toSummaryView).toList());
    }

    @GetMapping("/detail")
    public ApiResponse<SharedStateDetailView> detail(@RequestParam String namespace, @RequestParam String key) {
        SharedStateEntry entry = sharedStateApplicationService.get(namespace, key);
        if (entry == null) {
            throw new IllegalArgumentException("共享状态不存在: " + namespace + "/" + key);
        }
        return ApiResponse.success(toDetailView(entry));
    }

    @PostMapping
    public ApiResponse<SharedStateDetailView> create(@RequestBody SharedStateRequest request) {
        return ApiResponse.success(
                toDetailView(sharedStateApplicationService.put(
                        request == null ? null : request.getNamespace(),
                        request == null ? null : request.getKey(),
                        request == null ? null : request.getValue(),
                        request != null && request.isSecret(),
                        request == null ? null : request.getExpiresAt(),
                        null,
                        null
                )),
                "共享状态已保存"
        );
    }

    @PutMapping
    public ApiResponse<SharedStateDetailView> update(@RequestBody SharedStateRequest request) {
        return ApiResponse.success(
                toDetailView(sharedStateApplicationService.put(
                        request == null ? null : request.getNamespace(),
                        request == null ? null : request.getKey(),
                        request == null ? null : request.getValue(),
                        request != null && request.isSecret(),
                        request == null ? null : request.getExpiresAt(),
                        null,
                        null
                )),
                "共享状态已更新"
        );
    }

    @PostMapping("/cas")
    public ApiResponse<SharedStateCompareAndSetView> compareAndSet(@RequestBody SharedStateCompareAndSetRequest request) {
        SharedStateApplicationService.CompareAndSetResult result = sharedStateApplicationService.compareAndSet(
                request == null ? null : request.getNamespace(),
                request == null ? null : request.getKey(),
                request == null ? null : request.getExpectedVersion(),
                request == null ? null : request.getValue(),
                request != null && request.isSecret(),
                request == null ? null : request.getExpiresAt(),
                null,
                null
        );
        return ApiResponse.success(new SharedStateCompareAndSetView()
                .setUpdated(result.updated())
                .setEntry(result.entry() == null ? null : toDetailView(result.entry()))
                .setCurrent(result.current() == null ? null : toDetailView(result.current())));
    }

    @DeleteMapping
    public ApiResponse<Void> delete(@RequestParam String namespace, @RequestParam String key) {
        sharedStateApplicationService.delete(namespace, key);
        return ApiResponse.success(null, "共享状态已删除");
    }

    @PostMapping("/purge-expired")
    public ApiResponse<Long> purgeExpired(@RequestParam(required = false) String namespace) {
        return ApiResponse.success(sharedStateApplicationService.purgeExpired(namespace), "过期共享状态已清理");
    }

    private SharedStateSummaryView toSummaryView(SharedStateEntry entry) {
        return new SharedStateSummaryView()
                .setNamespace(entry.getNamespace())
                .setKey(entry.getKey())
                .setSecret(entry.isSecret())
                .setVersion(entry.getVersion())
                .setExpiresAt(entry.getExpiresAt())
                .setCreatedAt(entry.getCreatedAt())
                .setUpdatedAt(entry.getUpdatedAt())
                .setLastWriterScriptId(entry.getLastWriterScriptId())
                .setLastWriterExecutionId(entry.getLastWriterExecutionId());
    }

    private SharedStateDetailView toDetailView(SharedStateEntry entry) {
        SharedStateDetailView view = new SharedStateDetailView();
        view.setValue(entry.getValue())
                .setNamespace(entry.getNamespace())
                .setKey(entry.getKey())
                .setSecret(entry.isSecret())
                .setVersion(entry.getVersion())
                .setExpiresAt(entry.getExpiresAt())
                .setCreatedAt(entry.getCreatedAt())
                .setUpdatedAt(entry.getUpdatedAt())
                .setLastWriterScriptId(entry.getLastWriterScriptId())
                .setLastWriterExecutionId(entry.getLastWriterExecutionId());
        return view;
    }
}
