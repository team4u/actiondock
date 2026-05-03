package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ApiAccessToken;
import org.team4u.actiondock.domain.port.ApiAccessTokenRepository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * 服务端 API 访问令牌管理服务。
 *
 * @author jay.wu
 */
public class ApiAccessTokenApplicationService {
    private final ApiAccessTokenRepository repository;

    public ApiAccessTokenApplicationService(ApiAccessTokenRepository repository) {
        this.repository = Objects.requireNonNull(repository);
    }

    public List<ApiAccessToken> list() {
        return repository.findAll().stream()
                .sorted((left, right) -> left.getCreatedAt().compareTo(right.getCreatedAt()))
                .map(this::copy)
                .toList();
    }

    public CreatedToken create(String name) {
        LocalDateTime now = LocalDateTime.now();
        String normalizedName = normalizeName(name);
        String id = UUID.randomUUID().toString().replace("-", "");
        String secret = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        String tokenValue = "adk_" + id + "_" + secret;
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

    public boolean hasAnyToken() {
        return repository.count() > 0;
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
                .orElseThrow(() -> new IllegalArgumentException("访问令牌不存在: " + id));
    }

    private String normalizeId(String id) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("访问令牌 ID 不能为空");
        }
        return id.trim();
    }

    private String normalizeName(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("访问令牌名称不能为空");
        }
        return name.trim();
    }

    private String buildPreview(String tokenValue) {
        int tailSize = Math.min(8, tokenValue.length());
        return "****" + tokenValue.substring(tokenValue.length() - tailSize);
    }

    private String hash(String rawToken) {
        return HexFormat.of().formatHex(hashBytes(rawToken));
    }

    private byte[] hashBytes(String rawToken) {
        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest(rawToken.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("当前 JRE 不支持 SHA-256", exception);
        }
    }

    private boolean constantTimeEquals(byte[] actual, String expectedHex) {
        if (actual == null || expectedHex == null || expectedHex.isBlank()) {
            return false;
        }
        try {
            return MessageDigest.isEqual(actual, HexFormat.of().parseHex(expectedHex));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private ParsedToken parse(String rawToken) {
        if (rawToken == null || rawToken.isBlank() || !rawToken.startsWith("adk_")) {
            return null;
        }
        int secondSeparator = rawToken.indexOf('_', 4);
        if (secondSeparator <= 4 || secondSeparator >= rawToken.length() - 1) {
            return null;
        }
        return new ParsedToken(rawToken.substring(4, secondSeparator));
    }

    private ApiAccessToken copy(ApiAccessToken source) {
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
