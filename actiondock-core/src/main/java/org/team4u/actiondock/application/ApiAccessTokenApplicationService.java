package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ApiAccessToken;
import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.port.ApiAccessTokenRepository;

import java.util.Comparator;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * 服务端 API 访问令牌管理服务。
 *
 * @author jay.wu
 */
public class ApiAccessTokenApplicationService {
    private static final String TOKEN_PREFIX = "adk_";
    private static final int TOKEN_PREVIEW_TAIL_SIZE = 8;

    private final ApiAccessTokenRepository repository;

    public ApiAccessTokenApplicationService(ApiAccessTokenRepository repository) {
        this.repository = Objects.requireNonNull(repository);
    }

    public List<ApiAccessToken> list() {
        return repository.findAll().stream()
                .sorted(Comparator.comparing(ApiAccessToken::getCreatedAt))
                .map(ApiAccessTokenApplicationService::copy)
                .toList();
    }

    public CreatedToken create(String name) {
        LocalDateTime now = LocalDateTime.now();
        String normalizedName = normalizeName(name);
        String id = UUID.randomUUID().toString().replace("-", "");
        String secret = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        String tokenValue = TOKEN_PREFIX + id + "_" + secret;
        ApiAccessToken token = new ApiAccessToken()
                .setId(id)
                .setName(normalizedName)
                .setTokenHash(hash(tokenValue))
                .setTokenPreview(buildPreview(tokenValue))
                .setEnabled(true)
                .setCreatedAt(now)
                .setUpdatedAt(now);
        repository.save(token);
        return new CreatedToken(copy(token), tokenValue);
    }

    public ApiAccessToken rename(String id, String name) {
        ApiAccessToken existing = requireExisting(id);
        existing.setName(normalizeName(name))
                .setUpdatedAt(LocalDateTime.now());
        return copy(repository.save(existing));
    }

    public ApiAccessToken enable(String id) {
        return setEnabled(id, true);
    }

    public ApiAccessToken disable(String id) {
        return setEnabled(id, false);
    }

    public void delete(String id) {
        requireExisting(id);
        repository.deleteById(normalizeId(id));
    }

    public boolean hasAnyEnabledToken() {
        return repository.countEnabled() > 0;
    }

    public boolean authenticate(String rawToken) {
        ParsedToken parsed = parse(rawToken);
        if (parsed == null) {
            return false;
        }
        ApiAccessToken token = repository.findById(parsed.id()).orElse(null);
        if (token == null || !token.isEnabled()) {
            return false;
        }
        if (!constantTimeEquals(hashBytes(rawToken), token.getTokenHash())) {
            return false;
        }
        token.setLastUsedAt(LocalDateTime.now())
                .setUpdatedAt(LocalDateTime.now());
        repository.save(token);
        return true;
    }

    private ApiAccessToken setEnabled(String id, boolean enabled) {
        ApiAccessToken existing = requireExisting(id);
        existing.setEnabled(enabled)
                .setUpdatedAt(LocalDateTime.now());
        return copy(repository.save(existing));
    }

    private ApiAccessToken requireExisting(String id) {
        return repository.findById(normalizeId(id))
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.ACCESS_TOKEN_NOT_FOUND,
                        "访问令牌不存在: " + id,
                        Map.of("tokenId", id)
                ));
    }

    private static String normalizeId(String id) {
        return ApplicationServiceSupport.normalize(id, "访问令牌 ID 不能为空");
    }

    private static String normalizeName(String name) {
        return ApplicationServiceSupport.normalize(name, "访问令牌名称不能为空");
    }

    private static String buildPreview(String tokenValue) {
        int tailSize = Math.min(TOKEN_PREVIEW_TAIL_SIZE, tokenValue.length());
        return "****" + tokenValue.substring(tokenValue.length() - tailSize);
    }

    private static String hash(String rawToken) {
        return HexFormat.of().formatHex(hashBytes(rawToken));
    }

    private static byte[] hashBytes(String rawToken) {
        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest(rawToken.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("当前 JRE 不支持 SHA-256", exception);
        }
    }

    private static boolean constantTimeEquals(byte[] actual, String expectedHex) {
        if (actual == null || expectedHex == null || expectedHex.isBlank()) {
            return false;
        }
        try {
            return MessageDigest.isEqual(actual, HexFormat.of().parseHex(expectedHex));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static ParsedToken parse(String rawToken) {
        if (rawToken == null || rawToken.isBlank() || !rawToken.startsWith(TOKEN_PREFIX)) {
            return null;
        }
        int prefixLength = TOKEN_PREFIX.length();
        int secondSeparator = rawToken.indexOf('_', prefixLength);
        if (secondSeparator <= prefixLength || secondSeparator >= rawToken.length() - 1) {
            return null;
        }
        return new ParsedToken(rawToken.substring(prefixLength, secondSeparator));
    }

    private static ApiAccessToken copy(ApiAccessToken source) {
        return new ApiAccessToken()
                .setId(source.getId())
                .setName(source.getName())
                .setTokenHash(source.getTokenHash())
                .setTokenPreview(source.getTokenPreview())
                .setEnabled(source.isEnabled())
                .setCreatedAt(source.getCreatedAt())
                .setUpdatedAt(source.getUpdatedAt())
                .setLastUsedAt(source.getLastUsedAt());
    }

    public record CreatedToken(ApiAccessToken token, String tokenValue) {
    }

    private record ParsedToken(String id) {
    }
}
