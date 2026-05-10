package org.team4u.actiondock.domain.exception;

/**
 * 上游冲突异常，当上游资产已更新但本地工作副本也有未发布修改时抛出。
 *
 * @author jay.wu
 */
public class UpstreamConflictException extends IllegalArgumentException {
    private final String localAssetId;
    private final String repositoryId;
    private final String upstreamAssetId;

    public UpstreamConflictException(String localAssetId, String repositoryId, String upstreamAssetId) {
        super("上游资产已更新，但本地工作副本也有未发布修改");
        this.localAssetId = localAssetId;
        this.repositoryId = repositoryId;
        this.upstreamAssetId = upstreamAssetId;
    }

    public String getLocalAssetId() {
        return localAssetId;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public String getUpstreamAssetId() {
        return upstreamAssetId;
    }
}
