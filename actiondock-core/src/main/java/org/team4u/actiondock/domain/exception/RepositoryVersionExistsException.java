package org.team4u.actiondock.domain.exception;

/**
 * 仓库资产版本已存在异常。
 *
 * @author jay.wu
 */
public class RepositoryVersionExistsException extends IllegalArgumentException {
    public static final String KIND_PLUGIN = "PLUGIN";
    public static final String KIND_CAPABILITY_PACKAGE = "CAPABILITY_PACKAGE";
    public static final String KIND_AI_PACKAGE = "AI_PACKAGE";

    private final String assetKind;
    private final String repositoryId;
    private final String assetId;
    private final String version;

    public RepositoryVersionExistsException(String assetKind, String repositoryId, String assetId, String version) {
        super(assetLabel(assetKind) + "版本已存在: " + assetId + "@" + version);
        this.assetKind = assetKind;
        this.repositoryId = repositoryId;
        this.assetId = assetId;
        this.version = version;
    }

    private static String assetLabel(String assetKind) {
        return switch (assetKind) {
            case KIND_PLUGIN -> "插件";
            case KIND_CAPABILITY_PACKAGE -> "能力包";
            case KIND_AI_PACKAGE -> "AI 能力包";
            default -> "工具";
        };
    }

    public String getAssetKind() {
        return assetKind;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public String getAssetId() {
        return assetId;
    }

    public String getVersion() {
        return version;
    }
}
