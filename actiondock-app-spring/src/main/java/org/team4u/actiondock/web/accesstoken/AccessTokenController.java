package org.team4u.actiondock.web.accesstoken;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.ApiAccessTokenApplicationService;
import org.team4u.actiondock.domain.model.ApiAccessToken;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.List;

/**
 * 访问令牌管理控制器。
 *
 * @author jay.wu
 */
@RestController
@RequestMapping("/api/access-tokens")
public class AccessTokenController {
    private final ApiAccessTokenApplicationService apiAccessTokenApplicationService;

    public AccessTokenController(ApiAccessTokenApplicationService apiAccessTokenApplicationService) {
        this.apiAccessTokenApplicationService = apiAccessTokenApplicationService;
    }

    @GetMapping
    public ApiResponse<List<AccessTokenView>> list() {
        return ApiResponse.success(apiAccessTokenApplicationService.list().stream().map(AccessTokenController::toView).toList());
    }

    @PostMapping
    public ApiResponse<AccessTokenView> create(@RequestBody AccessTokenRequest request) {
        ApiAccessTokenApplicationService.CreatedToken createdToken = apiAccessTokenApplicationService.create(request == null ? null : request.getName());
        return ApiResponse.success(
                toView(createdToken.token()).setTokenValue(createdToken.tokenValue()),
                "访问令牌已创建"
        );
    }

    @PutMapping("/{id}")
    public ApiResponse<AccessTokenView> rename(@PathVariable String id, @RequestBody AccessTokenRequest request) {
        return ApiResponse.success(
                toView(apiAccessTokenApplicationService.rename(id, request == null ? null : request.getName())),
                "访问令牌已更新"
        );
    }

    @PostMapping("/{id}/enable")
    public ApiResponse<AccessTokenView> enable(@PathVariable String id) {
        return ApiResponse.success(toView(apiAccessTokenApplicationService.enable(id)), "访问令牌已启用");
    }

    @PostMapping("/{id}/disable")
    public ApiResponse<AccessTokenView> disable(@PathVariable String id) {
        return ApiResponse.success(toView(apiAccessTokenApplicationService.disable(id)), "访问令牌已停用");
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id) {
        apiAccessTokenApplicationService.delete(id);
        return ApiResponse.success(null, "访问令牌已删除");
    }

    private static AccessTokenView toView(ApiAccessToken token) {
        return new AccessTokenView()
                .setId(token.getId())
                .setName(token.getName())
                .setTokenPreview(token.getTokenPreview())
                .setEnabled(token.isEnabled())
                .setCreatedAt(token.getCreatedAt())
                .setUpdatedAt(token.getUpdatedAt())
                .setLastUsedAt(token.getLastUsedAt());
    }
}
