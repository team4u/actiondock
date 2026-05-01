package org.team4u.actiondock.domain.model;

public class EventSourceAuthConfig {
    private EventSourceAuthMode mode = EventSourceAuthMode.NONE;
    private String tokenHeader;
    private String tokenQueryParam;
    private String signatureHeader;
    private String signaturePrefix;
    private String signaturePayload;
    private String timestampHeader;
    private Integer maxSkewSeconds;
    private String secretConfigKey;

    public EventSourceAuthMode getMode() {
        return mode;
    }

    public EventSourceAuthConfig setMode(EventSourceAuthMode mode) {
        this.mode = mode == null ? EventSourceAuthMode.NONE : mode;
        return this;
    }

    public String getTokenHeader() {
        return tokenHeader;
    }

    public EventSourceAuthConfig setTokenHeader(String tokenHeader) {
        this.tokenHeader = tokenHeader;
        return this;
    }

    public String getTokenQueryParam() {
        return tokenQueryParam;
    }

    public EventSourceAuthConfig setTokenQueryParam(String tokenQueryParam) {
        this.tokenQueryParam = tokenQueryParam;
        return this;
    }

    public String getSignatureHeader() {
        return signatureHeader;
    }

    public EventSourceAuthConfig setSignatureHeader(String signatureHeader) {
        this.signatureHeader = signatureHeader;
        return this;
    }

    public String getSignaturePrefix() {
        return signaturePrefix;
    }

    public EventSourceAuthConfig setSignaturePrefix(String signaturePrefix) {
        this.signaturePrefix = signaturePrefix;
        return this;
    }

    public String getSignaturePayload() {
        return signaturePayload;
    }

    public EventSourceAuthConfig setSignaturePayload(String signaturePayload) {
        this.signaturePayload = signaturePayload;
        return this;
    }

    public String getTimestampHeader() {
        return timestampHeader;
    }

    public EventSourceAuthConfig setTimestampHeader(String timestampHeader) {
        this.timestampHeader = timestampHeader;
        return this;
    }

    public Integer getMaxSkewSeconds() {
        return maxSkewSeconds;
    }

    public EventSourceAuthConfig setMaxSkewSeconds(Integer maxSkewSeconds) {
        this.maxSkewSeconds = maxSkewSeconds;
        return this;
    }

    public String getSecretConfigKey() {
        return secretConfigKey;
    }

    public EventSourceAuthConfig setSecretConfigKey(String secretConfigKey) {
        this.secretConfigKey = secretConfigKey;
        return this;
    }
}
