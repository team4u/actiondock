package org.team4u.actiondock.web.sharedstate;

/**
 * 共享状态详情视图。
 *
 * @author jay.wu
 */
public class SharedStateDetailView extends SharedStateSummaryView {
    private Object value;

    public Object getValue() {
        return value;
    }

    public SharedStateDetailView setValue(Object value) {
        this.value = value;
        return this;
    }
}
