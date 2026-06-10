package org.team4u.actiondock.domain.model;

import java.time.LocalDateTime;

/**
 * 脚本来源元数据值对象，封装脚本的版本控制同步信息。
 *
 * @author jay.wu
 */
public class ScriptSourceMetadata {
    private String path;
    private String commit;
    private String digest;
    private LocalDateTime syncedAt;
    private boolean dirty;

    public ScriptSourceMetadata() {
    }

    public String getPath() {
        return path;
    }

    public ScriptSourceMetadata setPath(String path) {
        this.path = path;
        return this;
    }

    public String getCommit() {
        return commit;
    }

    public ScriptSourceMetadata setCommit(String commit) {
        this.commit = commit;
        return this;
    }

    public String getDigest() {
        return digest;
    }

    public ScriptSourceMetadata setDigest(String digest) {
        this.digest = digest;
        return this;
    }

    public LocalDateTime getSyncedAt() {
        return syncedAt;
    }

    public ScriptSourceMetadata setSyncedAt(LocalDateTime syncedAt) {
        this.syncedAt = syncedAt;
        return this;
    }

    public boolean isDirty() {
        return dirty;
    }

    public ScriptSourceMetadata setDirty(boolean dirty) {
        this.dirty = dirty;
        return this;
    }

    /**
     * 标记为已同步，设置同步时间为当前时间并清除 dirty 标志。
     *
     * @return 当前实例
     */
    public ScriptSourceMetadata markSynced(String path, String commit, String digest) {
        this.path = path;
        this.commit = commit;
        this.digest = digest;
        this.syncedAt = LocalDateTime.now();
        this.dirty = false;
        return this;
    }
}
