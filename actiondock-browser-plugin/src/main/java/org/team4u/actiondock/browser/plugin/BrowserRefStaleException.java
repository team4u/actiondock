package org.team4u.actiondock.browser.plugin;

final class BrowserRefStaleException extends IllegalArgumentException {
    private final String pageId;
    private final String ref;
    private final String expectedSnapshotId;
    private final String currentSnapshotId;
    private final long pageVersion;

    BrowserRefStaleException(String pageId,
                             String ref,
                             String expectedSnapshotId,
                             String currentSnapshotId,
                             long pageVersion) {
        super("Element ref is stale: @" + ref + ". Call snapshot again.");
        this.pageId = pageId;
        this.ref = ref;
        this.expectedSnapshotId = expectedSnapshotId;
        this.currentSnapshotId = currentSnapshotId;
        this.pageVersion = pageVersion;
    }

    String pageId() {
        return pageId;
    }

    String ref() {
        return ref;
    }

    String expectedSnapshotId() {
        return expectedSnapshotId;
    }

    String currentSnapshotId() {
        return currentSnapshotId;
    }

    long pageVersion() {
        return pageVersion;
    }
}
