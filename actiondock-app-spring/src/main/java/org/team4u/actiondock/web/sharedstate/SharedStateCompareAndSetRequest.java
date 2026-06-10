package org.team4u.actiondock.web.sharedstate;

/**
 * 共享状态 CAS 更新请求。
 *
 * @author jay.wu
 */
public class SharedStateCompareAndSetRequest extends SharedStateRequest {
    private Long expectedVersion;

    public Long getExpectedVersion() {
        return expectedVersion;
    }

    public void setExpectedVersion(Long expectedVersion) {
        this.expectedVersion = expectedVersion;
    }
}
