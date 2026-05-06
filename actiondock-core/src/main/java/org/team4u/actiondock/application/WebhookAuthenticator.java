package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.EventSourceAuthConfig;
import org.team4u.actiondock.domain.model.EventSourceAuthMode;
import org.team4u.actiondock.domain.model.EventSourceDefinition;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;

/**
 * Webhook 鉴权验证器，负责对传入事件执行 Token 或 HMAC 签名校验。
 *
 * @author jay.wu
 */
class WebhookAuthenticator {

    private static final String SIGNATURE_PAYLOAD_TIMESTAMP_DOT_RAW_BODY = "TIMESTAMP_DOT_RAW_BODY";
    private static final String HMAC_SHA256_ALGORITHM = "HmacSHA256";

    private final ConfigValueApplicationService configValueApplicationService;

    WebhookAuthenticator(ConfigValueApplicationService configValueApplicationService) {
        this.configValueApplicationService = configValueApplicationService;
    }

    /**
     * 校验传入事件的鉴权凭据。
     * <p>
     * 根据事件源的鉴权模式（HEADER_TOKEN / QUERY_TOKEN / HMAC_SHA256 / NONE）
     * 执行相应的验证逻辑，校验失败时抛出 {@link EventAuthenticationException}。
     *
     * @param source  事件源定义，包含鉴权配置
     * @param payload 传入的事件请求负载
     * @throws EventAuthenticationException 鉴权失败时抛出
     */
    void verify(EventSourceDefinition source, IncomingEventPayload payload) {
        EventSourceAuthConfig auth = source.getAuth();
        if (auth == null || auth.getMode() == null || auth.getMode() == EventSourceAuthMode.NONE) {
            return;
        }
        boolean passed = switch (auth.getMode()) {
            case HEADER_TOKEN -> verifyHeaderToken(auth, payload);
            case QUERY_TOKEN -> verifyQueryToken(auth, payload);
            case HMAC_SHA256 -> verifyHmac(auth, payload);
            default -> true;
        };
        if (!passed) {
            throw new EventAuthenticationException("事件鉴权失败");
        }
    }

    private boolean verifyHeaderToken(EventSourceAuthConfig auth, IncomingEventPayload payload) {
        String provided = valueByName(payload.getHeaders(), auth.getTokenHeader());
        return verifyToken(provided, auth);
    }

    private boolean verifyQueryToken(EventSourceAuthConfig auth, IncomingEventPayload payload) {
        String provided = ObjectValues.stringValue(payload.getQuery().get(auth.getTokenQueryParam()));
        return verifyToken(provided, auth);
    }

    private boolean verifyToken(String providedToken, EventSourceAuthConfig auth) {
        String secret = resolveSecret(auth);
        return constantTimeEquals(secret, providedToken);
    }

    private boolean verifyHmac(EventSourceAuthConfig auth, IncomingEventPayload payload) {
        String secret = resolveSecret(auth);
        if (secret == null || secret.isBlank()) {
            return false;
        }
        String signature = valueByName(payload.getHeaders(), auth.getSignatureHeader());
        if (signature == null || signature.isBlank()) {
            return false;
        }
        String prefix = auth.getSignaturePrefix() == null ? "" : auth.getSignaturePrefix();
        if (!prefix.isEmpty() && !signature.startsWith(prefix)) {
            return false;
        }
        String actual = prefix.isEmpty() ? signature : signature.substring(prefix.length());
        String signingPayload = buildSigningPayload(auth, payload);
        return constantTimeEquals(hmacSha256Bytes(secret, signingPayload), actual);
    }

    private static String buildSigningPayload(EventSourceAuthConfig auth, IncomingEventPayload payload) {
        String rawBody = payload.getRawBody() == null ? "" : payload.getRawBody();
        if (!SIGNATURE_PAYLOAD_TIMESTAMP_DOT_RAW_BODY.equalsIgnoreCase(auth.getSignaturePayload())) {
            return rawBody;
        }
        String timestamp = valueByName(payload.getHeaders(), auth.getTimestampHeader());
        if (timestamp == null || !isTimestampWithinSkew(timestamp, auth.getMaxSkewSeconds())) {
            return "";
        }
        return timestamp + "." + rawBody;
    }

    private static boolean isTimestampWithinSkew(String timestamp, Integer maxSkewSeconds) {
        if (maxSkewSeconds == null || maxSkewSeconds <= 0) {
            return true;
        }
        try {
            long epoch = Long.parseLong(timestamp);
            Duration skew = Duration.between(Instant.ofEpochSecond(epoch), Instant.now());
            return Math.abs(skew.toSeconds()) <= maxSkewSeconds;
        } catch (NumberFormatException exception) {
            return false;
        }
    }

    private static byte[] hmacSha256Bytes(String secret, String payload) {
        try {
            Mac mac = Mac.getInstance(HMAC_SHA256_ALGORITHM);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), HMAC_SHA256_ALGORITHM));
            return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        } catch (Exception exception) {
            throw new IllegalStateException("HMAC 计算失败", exception);
        }
    }

    private String resolveSecret(EventSourceAuthConfig auth) {
        if (auth.getSecretConfigKey() == null || auth.getSecretConfigKey().isBlank()) {
            return null;
        }
        return configValueApplicationService.snapshot().get(auth.getSecretConfigKey());
    }

    private static boolean constantTimeEquals(String expected, String actual) {
        if (expected == null || actual == null) {
            return false;
        }
        return constantTimeEquals(expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
    }

    private static boolean constantTimeEquals(byte[] expected, byte[] actual) {
        return MessageDigest.isEqual(expected, actual);
    }

    private static boolean constantTimeEquals(byte[] expected, String actualHex) {
        if (expected == null || actualHex == null || actualHex.isBlank()) {
            return false;
        }
        try {
            byte[] actual = HexFormat.of().parseHex(actualHex);
            return constantTimeEquals(expected, actual);
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    static String valueByName(Map<String, Object> values, String key) {
        if (values == null || values.isEmpty() || key == null || key.isBlank()) {
            return null;
        }
        Object exact = values.get(key);
        if (exact != null) {
            return ObjectValues.stringValue(exact);
        }
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(key)) {
                return ObjectValues.stringValue(entry.getValue());
            }
        }
        return null;
    }
}
