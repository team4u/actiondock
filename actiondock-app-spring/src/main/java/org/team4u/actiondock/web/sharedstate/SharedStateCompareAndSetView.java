package org.team4u.actiondock.web.sharedstate;

/**
 * 共享状态 CAS 更新结果视图。
 *
 * @author jay.wu
 */
public class SharedStateCompareAndSetView {
    private boolean updated;
    private SharedStateDetailView entry;
    private SharedStateDetailView current;

    public boolean isUpdated() {
        return updated;
    }

    public SharedStateCompareAndSetView setUpdated(boolean updated) {
        this.updated = updated;
        return this;
    }

    public SharedStateDetailView getEntry() {
        return entry;
    }

    public SharedStateCompareAndSetView setEntry(SharedStateDetailView entry) {
        this.entry = entry;
        return this;
    }

    public SharedStateDetailView getCurrent() {
        return current;
    }

    public SharedStateCompareAndSetView setCurrent(SharedStateDetailView current) {
        this.current = current;
        return this;
    }
}
