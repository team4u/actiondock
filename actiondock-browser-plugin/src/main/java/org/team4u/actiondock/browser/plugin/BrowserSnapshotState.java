package org.team4u.actiondock.browser.plugin;

import java.util.LinkedHashMap;
import java.util.Map;

final class BrowserSnapshotState {
    private long pageVersion = 1L;
    private String currentSnapshotId;
    private String previousSnapshotId;
    private final Map<String, Map<String, Object>> refs = new LinkedHashMap<>();

    long pageVersion() {
        return pageVersion;
    }

    void bumpPageVersion() {
        pageVersion++;
        refs.clear();
        currentSnapshotId = null;
    }

    String currentSnapshotId() {
        return currentSnapshotId;
    }

    String previousSnapshotId() {
        return previousSnapshotId;
    }

    void replace(String snapshotId, Map<String, Map<String, Object>> nextRefs) {
        previousSnapshotId = currentSnapshotId;
        currentSnapshotId = snapshotId;
        refs.clear();
        refs.putAll(nextRefs);
    }

    Map<String, Object> ref(String ref) {
        return refs.get(ref);
    }
}
