package org.team4u.actiondock.browser.plugin;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.ConsoleMessage;
import com.microsoft.playwright.Dialog;
import com.microsoft.playwright.Download;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.Request;
import com.microsoft.playwright.Response;

import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.locks.ReentrantLock;

final class BrowserSession implements AutoCloseable {
    private static final int MAX_EVENTS = 300;

    private final String sessionId;
    private final String ownerKey;
    private final String browserName;
    private final Playwright playwright;
    private final Browser browser;
    private final BrowserContext context;
    private final int defaultTimeoutMs;
    private final Map<String, Page> pages = new LinkedHashMap<>();
    private final IdentityHashMap<Page, String> pageIds = new IdentityHashMap<>();
    private final Map<String, BrowserSnapshotState> snapshotStates = new LinkedHashMap<>();
    private final Map<String, Map<String, Object>> snapshotPayloads = new LinkedHashMap<>();
    private final Map<String, Dialog> dialogs = new LinkedHashMap<>();
    private final Map<String, Download> downloads = new LinkedHashMap<>();
    private final Map<String, AutoCloseable> routes = new LinkedHashMap<>();
    private final IdentityHashMap<Request, String> requestIds = new IdentityHashMap<>();
    private final Map<String, Map<String, Object>> requestRecords = new LinkedHashMap<>();
    private final List<Map<String, Object>> harEntries = new ArrayList<>();
    private final List<Map<String, Object>> events = new ArrayList<>();
    private final Instant createdAt;
    private final ReentrantLock lock = new ReentrantLock();
    private int nextPageNumber = 1;
    private int nextEventId = 1;
    private int nextDialogId = 1;
    private int nextDownloadId = 1;
    private int nextRouteId = 1;
    private int nextSnapshotId = 1;
    private int nextRequestId = 1;
    private volatile Instant lastAccessAt;
    private volatile boolean closed;
    private String activePageId;
    private boolean traceActive;
    private boolean harActive;
    private String harName;
    private Path harPath;

    BrowserSession(String sessionId,
                   String ownerKey,
                   String browserName,
                   Playwright playwright,
                   Browser browser,
                   BrowserContext context,
                   Page page,
                   int defaultTimeoutMs) {
        this.sessionId = sessionId;
        this.ownerKey = ownerKey;
        this.browserName = browserName;
        this.playwright = playwright;
        this.browser = browser;
        this.context = context;
        this.defaultTimeoutMs = defaultTimeoutMs;
        this.createdAt = Instant.now();
        this.lastAccessAt = createdAt;
        context.onPage(this::registerPage);
        registerPage(page);
        this.activePageId = pageIds.get(page);
    }

    String sessionId() {
        return sessionId;
    }

    String ownerKey() {
        return ownerKey;
    }

    String browserName() {
        return browserName;
    }

    BrowserContext context() {
        return context;
    }

    Page page() {
        return page(null);
    }

    Page page(String pageId) {
        String resolvedPageId = Args.isBlank(pageId) ? activePageId : pageId;
        Page page = pages.get(resolvedPageId);
        if (page == null || page.isClosed()) {
            throw new IllegalArgumentException("Browser page not found: " + resolvedPageId);
        }
        return page;
    }

    String activePageId() {
        return activePageId;
    }

    String registerPage(Page page) {
        lock.lock();
        try {
            String existing = pageIds.get(page);
            if (existing != null) {
                return existing;
            }
            String pageId = "p" + nextPageNumber++;
            pageIds.put(page, pageId);
            pages.put(pageId, page);
            snapshotStates.putIfAbsent(pageId, new BrowserSnapshotState());
            page.setDefaultTimeout(defaultTimeoutMs);
            page.setDefaultNavigationTimeout(defaultTimeoutMs);
            wirePage(pageId, page);
            if (activePageId == null) {
                activePageId = pageId;
            }
            addEvent(pageId, "page", Map.of("action", "created", "url", safeUrl(page)));
            return pageId;
        } finally {
            lock.unlock();
        }
    }

    String newPage() {
        Page page = context.newPage();
        return registerPage(page);
    }

    void switchPage(String pageId) {
        page(pageId);
        activePageId = pageId;
    }

    void closePage(String pageId) {
        Page page = page(pageId);
        page.close();
        pages.remove(pageId);
        snapshotStates.remove(pageId);
        if (pageId.equals(activePageId)) {
            activePageId = pages.keySet().stream().findFirst().orElse(null);
        }
    }

    List<Map<String, Object>> pagesInfo() {
        List<Map<String, Object>> items = new ArrayList<>();
        pages.forEach((pageId, page) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("pageId", pageId);
            item.put("active", pageId.equals(activePageId));
            item.put("closed", page.isClosed());
            item.put("url", safeUrl(page));
            item.put("title", safeTitle(page));
            items.add(item);
        });
        return items;
    }

    String replaceRefs(String pageId, List<Map<String, Object>> elements, Map<String, Object> snapshotPayload) {
        Map<String, Map<String, Object>> refs = new LinkedHashMap<>();
        for (Map<String, Object> element : elements) {
            Object ref = element.get("ref");
            if (ref != null && !String.valueOf(ref).isBlank()) {
                refs.put(String.valueOf(ref), new LinkedHashMap<>(element));
            }
        }
        String snapshotId = "sn" + nextSnapshotId++;
        snapshotStates.computeIfAbsent(pageId, ignored -> new BrowserSnapshotState()).replace(snapshotId, refs);
        snapshotPayloads.put(snapshotId, new LinkedHashMap<>(snapshotPayload));
        while (snapshotPayloads.size() > 20) {
            snapshotPayloads.remove(snapshotPayloads.keySet().iterator().next());
        }
        return snapshotId;
    }

    String replaceRefs(String pageId, List<Map<String, Object>> elements) {
        return replaceRefs(pageId, elements, Map.of());
    }

    Map<String, Object> ref(String pageId, String ref, String expectedSnapshotId) {
        BrowserSnapshotState state = snapshotStates.get(pageId);
        if (state == null) {
            throw new IllegalArgumentException("Element ref not found. Call snapshot again: " + ref);
        }
        if (!Args.isBlank(expectedSnapshotId) && !expectedSnapshotId.equals(state.currentSnapshotId())) {
            throw new BrowserRefStaleException(pageId, ref, expectedSnapshotId, state.currentSnapshotId(), state.pageVersion());
        }
        Map<String, Object> value = state.ref(ref);
        if (value == null) {
            throw new IllegalArgumentException("Element ref not found. Call observe again: " + ref);
        }
        return value;
    }

    long pageVersion(String pageId) {
        return snapshotStates.computeIfAbsent(pageId, ignored -> new BrowserSnapshotState()).pageVersion();
    }

    String currentSnapshotId(String pageId) {
        BrowserSnapshotState state = snapshotStates.get(pageId);
        return state == null ? null : state.currentSnapshotId();
    }

    String previousSnapshotId(String pageId) {
        BrowserSnapshotState state = snapshotStates.get(pageId);
        return state == null ? null : state.previousSnapshotId();
    }

    Map<String, Object> snapshotPayload(String snapshotId) {
        return snapshotPayloads.get(snapshotId);
    }

    void invalidateRefs(String pageId) {
        snapshotStates.computeIfAbsent(pageId, ignored -> new BrowserSnapshotState()).bumpPageVersion();
    }

    void addEvent(String pageId, String type, Map<String, Object> data) {
        lock.lock();
        try {
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("id", nextEventId++);
            event.put("time", Instant.now().toString());
            event.put("sessionId", sessionId);
            event.put("pageId", pageId);
            event.put("type", type);
            event.putAll(data);
            events.add(event);
            while (events.size() > MAX_EVENTS) {
                events.removeFirst();
            }
        } finally {
            lock.unlock();
        }
    }

    List<Map<String, Object>> events(String pageId, List<String> types, int sinceId, boolean clear) {
        List<Map<String, Object>> result = events.stream()
                .filter(event -> Args.isBlank(pageId) || pageId.equals(event.get("pageId")))
                .filter(event -> types == null || types.isEmpty() || types.contains(String.valueOf(event.get("type"))))
                .filter(event -> ((Number) event.get("id")).intValue() > sinceId)
                .map(LinkedHashMap::new)
                .map(item -> (Map<String, Object>) item)
                .toList();
        if (clear) {
            events.clear();
        }
        return result;
    }

    String rememberDialog(String pageId, Dialog dialog) {
        String dialogId = "d" + nextDialogId++;
        dialogs.put(dialogId, dialog);
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("dialogId", dialogId);
        event.put("dialogType", dialog.type());
        event.put("message", dialog.message());
        event.put("defaultValue", dialog.defaultValue());
        addEvent(pageId, "dialog", event);
        return dialogId;
    }

    Dialog takeDialog(String dialogId) {
        Dialog dialog = dialogs.remove(dialogId);
        if (dialog == null) {
            throw new IllegalArgumentException("Dialog not found: " + dialogId);
        }
        return dialog;
    }

    String rememberDownload(String pageId, Download download) {
        String downloadId = "dl" + nextDownloadId++;
        downloads.put(downloadId, download);
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("downloadId", downloadId);
        event.put("url", download.url());
        event.put("suggestedFilename", download.suggestedFilename());
        addEvent(pageId, "download", event);
        return downloadId;
    }

    Download download(String downloadId) {
        Download download = downloads.get(downloadId);
        if (download == null) {
            throw new IllegalArgumentException("Download not found: " + downloadId);
        }
        return download;
    }

    String rememberRoute(AutoCloseable route) {
        String routeId = "r" + nextRouteId++;
        routes.put(routeId, route);
        return routeId;
    }

    AutoCloseable takeRoute(String routeId) {
        AutoCloseable route = routes.remove(routeId);
        if (route == null) {
            throw new IllegalArgumentException("Route not found: " + routeId);
        }
        return route;
    }

    Instant createdAt() {
        return createdAt;
    }

    Instant lastAccessAt() {
        return lastAccessAt;
    }

    boolean isClosed() {
        return closed;
    }

    boolean isTraceActive() {
        return traceActive;
    }

    void setTraceActive(boolean traceActive) {
        this.traceActive = traceActive;
    }

    boolean isHarActive() {
        return harActive;
    }

    void startHar(String name, Path path) {
        this.harActive = true;
        this.harName = name;
        this.harPath = path;
        this.harEntries.clear();
    }

    Path stopHar() {
        this.harActive = false;
        Path path = harPath;
        harName = null;
        harPath = null;
        return path;
    }

    String harName() {
        return harName;
    }

    Path harPath() {
        return harPath;
    }

    List<Map<String, Object>> harEntries() {
        return harEntries.stream().map(LinkedHashMap::new).map(item -> (Map<String, Object>) item).toList();
    }

    String rememberRequest(String pageId, Request request) {
        String requestId = requestIds.get(request);
        if (requestId != null) {
            return requestId;
        }
        requestId = "rq" + nextRequestId++;
        requestIds.put(request, requestId);
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", nextRequestId - 1);
        item.put("requestId", requestId);
        item.put("pageId", pageId);
        item.put("url", request.url());
        item.put("method", request.method());
        item.put("resourceType", request.resourceType());
        item.put("navigation", request.isNavigationRequest());
        item.put("failure", request.failure());
        item.put("startedAt", Instant.now().toString());
        try {
            item.put("requestHeaders", new LinkedHashMap<>(request.headers()));
        } catch (RuntimeException ignored) {
        }
        requestRecords.put(requestId, item);
        return requestId;
    }

    void completeRequest(Request request, Response response, String failure, boolean finished) {
        String requestId = requestIds.get(request);
        if (requestId == null) {
            return;
        }
        Map<String, Object> item = requestRecords.get(requestId);
        if (item == null) {
            return;
        }
        if (!Args.isBlank(failure)) {
            item.put("failure", failure);
        }
        if (response != null) {
            item.put("status", response.status());
            item.put("statusText", response.statusText());
            item.put("ok", response.ok());
            try {
                item.put("responseHeaders", new LinkedHashMap<>(response.headers()));
            } catch (RuntimeException ignored) {
            }
            try {
                item.put("responseBody", response.text());
            } catch (RuntimeException ignored) {
            }
        }
        if (finished) {
            item.put("finishedAt", Instant.now().toString());
        }
        if (harActive) {
            rememberHarEntry(item);
        }
    }

    List<Map<String, Object>> requestRecords(String pageId) {
        return requestRecords.values().stream()
                .filter(item -> Args.isBlank(pageId) || pageId.equals(item.get("pageId")))
                .map(LinkedHashMap::new)
                .map(item -> (Map<String, Object>) item)
                .toList();
    }

    Map<String, Object> requestRecord(String requestId) {
        Map<String, Object> item = requestRecords.get(requestId);
        if (item == null) {
            throw new IllegalArgumentException("Request not found: " + requestId);
        }
        return new LinkedHashMap<>(item);
    }

    void clearRequestRecords(String pageId) {
        requestRecords.entrySet().removeIf(entry -> Args.isBlank(pageId) || pageId.equals(entry.getValue().get("pageId")));
        requestIds.entrySet().removeIf(entry -> {
            String requestId = entry.getValue();
            Map<String, Object> item = requestRecords.get(requestId);
            return item == null || Args.isBlank(pageId) || pageId.equals(item.get("pageId"));
        });
    }

    <T> T withLock(Callable<T> operation) throws Exception {
        lock.lock();
        try {
            if (closed) {
                throw new IllegalStateException("Browser session is closed: " + sessionId);
            }
            lastAccessAt = Instant.now();
            return operation.call();
        } finally {
            lock.unlock();
        }
    }

    @Override
    public void close() {
        lock.lock();
        try {
            if (closed) {
                return;
            }
            closed = true;
            try {
                for (AutoCloseable route : routes.values()) {
                    try {
                        route.close();
                    } catch (Exception ignored) {
                    }
                }
                routes.clear();
                browser.close();
            } finally {
                playwright.close();
            }
        } finally {
            lock.unlock();
        }
    }

    private void wirePage(String pageId, Page page) {
        page.onClose(ignored -> {
            lock.lock();
            try {
                pages.remove(pageId);
                snapshotStates.remove(pageId);
                addEvent(pageId, "page", Map.of("action", "closed"));
                if (pageId.equals(activePageId)) {
                    activePageId = pages.keySet().stream().findFirst().orElse(null);
                }
            } finally {
                lock.unlock();
            }
        });
        page.onConsoleMessage(message -> addEvent(pageId, "console", consoleEvent(message)));
        page.onPageError(message -> addEvent(pageId, "pageError", Map.of("message", message)));
        page.onRequest(request -> {
            String requestId = rememberRequest(pageId, request);
            Map<String, Object> event = requestEvent(request);
            event.put("requestId", requestId);
            addEvent(pageId, "request", event);
        });
        page.onRequestFailed(request -> {
            completeRequest(request, null, request.failure(), true);
            Map<String, Object> event = requestEvent(request);
            event.put("requestId", requestIds.get(request));
            addEvent(pageId, "requestFailed", event);
        });
        page.onRequestFinished(request -> {
            completeRequest(request, null, null, true);
            Map<String, Object> event = requestEvent(request);
            event.put("requestId", requestIds.get(request));
            addEvent(pageId, "requestFinished", event);
        });
        page.onResponse(response -> {
            completeRequest(response.request(), response, null, false);
            Map<String, Object> event = responseEvent(response);
            event.put("requestId", requestIds.get(response.request()));
            addEvent(pageId, "response", event);
        });
        page.onDownload(download -> rememberDownload(pageId, download));
        page.onDialog(dialog -> rememberDialog(pageId, dialog));
        page.onPopup(popup -> {
            String popupPageId = registerPage(popup);
            addEvent(pageId, "popup", Map.of("popupPageId", popupPageId, "url", safeUrl(popup)));
        });
        page.onLoad(ignored -> invalidateRefs(pageId));
    }

    private static Map<String, Object> consoleEvent(ConsoleMessage message) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("messageType", message.type());
        item.put("text", message.text());
        item.put("location", message.location());
        return item;
    }

    private static Map<String, Object> requestEvent(Request request) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("url", request.url());
        item.put("method", request.method());
        item.put("resourceType", request.resourceType());
        item.put("navigation", request.isNavigationRequest());
        item.put("failure", request.failure());
        return item;
    }

    private static Map<String, Object> responseEvent(Response response) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("url", response.url());
        item.put("status", response.status());
        item.put("statusText", response.statusText());
        item.put("ok", response.ok());
        return item;
    }

    private void rememberHarEntry(Map<String, Object> requestRecord) {
        String requestId = String.valueOf(requestRecord.get("requestId"));
        boolean exists = harEntries.stream().anyMatch(item -> requestId.equals(item.get("requestId")));
        if (!exists) {
            harEntries.add(new LinkedHashMap<>(requestRecord));
        }
    }

    private static String safeUrl(Page page) {
        try {
            return page.isClosed() ? "" : page.url();
        } catch (RuntimeException exception) {
            return "";
        }
    }

    private static String safeTitle(Page page) {
        try {
            return page.isClosed() ? "" : page.title();
        } catch (RuntimeException exception) {
            return "";
        }
    }
}
