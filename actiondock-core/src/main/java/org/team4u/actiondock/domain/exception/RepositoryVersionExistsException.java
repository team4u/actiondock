package org.team4u.actiondock.domain.exception;

/**
 * 仓库资产版本已存在异常。
 *
 * @author jay.wu
 */
public class RepositoryVersionExistsException extends IllegalArgumentException {
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
        if ("PLUGIN".equals(assetKind)) {
            return "插件";
        }
        if ("CAPABILITY_PACKAGE".equals(assetKind)) {
            return "能力包";
        }
        if ("AI_PACKAGE".equals(assetKind)) {
            return "AI 能力包";
        }
        return "工具";
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
