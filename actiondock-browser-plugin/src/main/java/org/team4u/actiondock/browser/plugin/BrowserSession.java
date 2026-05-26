package org.team4u.actiondock.browser.plugin;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;

import java.time.Instant;
import java.util.concurrent.Callable;
import java.util.concurrent.locks.ReentrantLock;

final class BrowserSession implements AutoCloseable {
    private final String sessionId;
    private final String ownerKey;
    private final String browserName;
    private final Playwright playwright;
    private final Browser browser;
    private final BrowserContext context;
    private final Page page;
    private final Instant createdAt;
    private final ReentrantLock lock = new ReentrantLock();
    private volatile Instant lastAccessAt;
    private volatile boolean closed;

    BrowserSession(String sessionId,
                   String ownerKey,
                   String browserName,
                   Playwright playwright,
                   Browser browser,
                   BrowserContext context,
                   Page page) {
        this.sessionId = sessionId;
        this.ownerKey = ownerKey;
        this.browserName = browserName;
        this.playwright = playwright;
        this.browser = browser;
        this.context = context;
        this.page = page;
        this.createdAt = Instant.now();
        this.lastAccessAt = createdAt;
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
        return page;
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
                browser.close();
            } finally {
                playwright.close();
            }
        } finally {
            lock.unlock();
        }
    }
}
