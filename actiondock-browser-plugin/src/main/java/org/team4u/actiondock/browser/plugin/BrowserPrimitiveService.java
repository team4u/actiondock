package org.team4u.actiondock.browser.plugin;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.options.Cookie;
import com.microsoft.playwright.options.LoadState;
import com.microsoft.playwright.options.SameSiteAttribute;
import com.microsoft.playwright.options.WaitForSelectorState;
import com.microsoft.playwright.options.WaitUntilState;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class BrowserPrimitiveService {
    private final BrowserSessionManager sessions;
    private final BrowserPathResolver pathResolver;
    private final BrowserHostPolicy hostPolicy;

    BrowserPrimitiveService(BrowserSessionManager sessions, BrowserPathResolver pathResolver, BrowserHostPolicy hostPolicy) {
        this.sessions = sessions;
        this.pathResolver = pathResolver;
        this.hostPolicy = hostPolicy;
    }

    Map<String, Object> createSession(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserPluginConfig config = config(context);
        BrowserConfigValidator.validate(config);
        String browserName = BrowserConfigValidator.normalizeBrowser(Args.optionalString(args, "browser", config.getDefaultBrowser()));
        boolean headless = Args.optionalBoolean(args, "headless", config.isHeadless());
        int timeoutMs = Args.optionalInt(args, "timeoutMs", config.getDefaultTimeoutMs());

        Playwright playwright = Playwright.create();
        Browser browser = launchBrowser(playwright, browserName, headless);
        Browser.NewContextOptions contextOptions = new Browser.NewContextOptions()
                .setAcceptDownloads(true);

        Map<String, Object> viewport = Args.optionalMap(args, "viewport");
        if (!viewport.isEmpty()) {
            int width = Args.optionalInt(viewport, "width", 1280);
            int height = Args.optionalInt(viewport, "height", 720);
            contextOptions.setViewportSize(width, height);
        }
        String userAgent = Args.optionalString(args, "userAgent", null);
        if (!Args.isBlank(userAgent)) {
            contextOptions.setUserAgent(userAgent);
        }
        if (!Args.isBlank(Args.optionalString(args, "storageStatePath", null))
                || !Args.isBlank(Args.optionalString(args, "stateName", null))) {
            Path statePath = pathResolver.resolveStatePath(config, args, false);
            contextOptions.setStorageStatePath(statePath);
        }

        BrowserContext browserContext = browser.newContext(contextOptions);
        browserContext.setDefaultTimeout(timeoutMs);
        browserContext.setDefaultNavigationTimeout(timeoutMs);
        Page page = browserContext.newPage();
        page.setDefaultTimeout(timeoutMs);
        page.setDefaultNavigationTimeout(timeoutMs);

        String sessionId = sessions.newSessionId();
        BrowserSession session = new BrowserSession(
                sessionId,
                BrowserSessionManager.ownerKey(context),
                browserName,
                playwright,
                browser,
                browserContext,
                page
        );
        sessions.add(config, session);

        Map<String, Object> result = Results.ok("Browser session created.");
        result.put("sessionId", sessionId);
        result.put("browser", browserName);
        result.put("headless", headless);
        return result;
    }

    Map<String, Object> closeSession(ScriptPluginContext context, Map<String, Object> args) {
        return sessions.close(context, config(context), args);
    }

    Map<String, Object> sessionInfo(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        return sessions.info(session);
    }

    Map<String, Object> sessionList(ScriptPluginContext context) {
        return sessions.list(context, config(context));
    }

    Map<String, Object> gotoPage(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserPluginConfig config = config(context);
        BrowserSession session = requireSession(context, args);
        String url = Args.requiredString(args, "url");
        hostPolicy.assertAllowed(config, url);
        WaitUntilState waitUntil = BrowserEnums.waitUntil(Args.optionalString(args, "waitUntil", null), WaitUntilState.LOAD);
        int timeoutMs = Args.optionalInt(args, "timeoutMs", config.getDefaultTimeoutMs());
        return session.withLock(() -> {
            Page page = session.page();
            page.navigate(url, new Page.NavigateOptions().setWaitUntil(waitUntil).setTimeout(timeoutMs));
            return pageSnapshot(page);
        });
    }

    Map<String, Object> waitForLoadState(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserPluginConfig config = config(context);
        BrowserSession session = requireSession(context, args);
        LoadState state = BrowserEnums.loadState(Args.optionalString(args, "state", null), LoadState.LOAD);
        int timeoutMs = Args.optionalInt(args, "timeoutMs", config.getDefaultTimeoutMs());
        return session.withLock(() -> {
            session.page().waitForLoadState(state, new Page.WaitForLoadStateOptions().setTimeout(timeoutMs));
            Map<String, Object> result = pageSnapshot(session.page());
            result.put("state", state.name().toLowerCase());
            return result;
        });
    }

    Map<String, Object> waitForSelector(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserPluginConfig config = config(context);
        BrowserSession session = requireSession(context, args);
        String selector = Args.requiredString(args, "selector");
        WaitForSelectorState state = BrowserEnums.selectorState(Args.optionalString(args, "state", null), WaitForSelectorState.VISIBLE);
        int timeoutMs = Args.optionalInt(args, "timeoutMs", config.getDefaultTimeoutMs());
        return session.withLock(() -> {
            session.page().locator(selector).waitFor(new Locator.WaitForOptions().setState(state).setTimeout(timeoutMs));
            Map<String, Object> result = Results.ok();
            result.put("selector", selector);
            result.put("state", state.name().toLowerCase());
            return result;
        });
    }

    Map<String, Object> click(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String selector = Args.requiredString(args, "selector");
        return session.withLock(() -> {
            session.page().locator(selector).click();
            return simpleSelectorResult(selector);
        });
    }

    Map<String, Object> fill(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String selector = Args.requiredString(args, "selector");
        String value = Args.requiredString(args, "value");
        return session.withLock(() -> {
            session.page().locator(selector).fill(value);
            return simpleSelectorResult(selector);
        });
    }

    Map<String, Object> press(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String key = Args.requiredString(args, "key");
        String selector = Args.optionalString(args, "selector", null);
        return session.withLock(() -> {
            if (Args.isBlank(selector)) {
                session.page().keyboard().press(key);
            } else {
                session.page().locator(selector).press(key);
            }
            Map<String, Object> result = Results.ok();
            result.put("selector", selector);
            result.put("key", key);
            return result;
        });
    }

    Map<String, Object> textContent(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String selector = Args.requiredString(args, "selector");
        return session.withLock(() -> {
            Map<String, Object> result = simpleSelectorResult(selector);
            result.put("text", session.page().locator(selector).textContent());
            return result;
        });
    }

    Map<String, Object> innerText(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String selector = Args.requiredString(args, "selector");
        return session.withLock(() -> {
            Map<String, Object> result = simpleSelectorResult(selector);
            result.put("text", session.page().locator(selector).innerText());
            return result;
        });
    }

    Map<String, Object> getAttribute(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String selector = Args.requiredString(args, "selector");
        String name = Args.requiredString(args, "name");
        return session.withLock(() -> {
            Map<String, Object> result = simpleSelectorResult(selector);
            result.put("name", name);
            result.put("value", session.page().locator(selector).getAttribute(name));
            return result;
        });
    }

    Map<String, Object> isVisible(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String selector = Args.requiredString(args, "selector");
        return session.withLock(() -> {
            Map<String, Object> result = simpleSelectorResult(selector);
            result.put("visible", session.page().locator(selector).isVisible());
            return result;
        });
    }

    Map<String, Object> locatorCount(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String selector = Args.requiredString(args, "selector");
        return session.withLock(() -> {
            Map<String, Object> result = simpleSelectorResult(selector);
            result.put("count", session.page().locator(selector).count());
            return result;
        });
    }

    Map<String, Object> getCookies(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserPluginConfig config = config(context);
        BrowserSession session = requireSession(context, args);
        boolean currentPageOnly = Args.optionalBoolean(args, "currentPageOnly", true);
        boolean includeValue = Args.optionalBoolean(args, "includeValue", config.isIncludeCookieValueByDefault());
        List<String> urls = Args.optionalStringList(args, "urls");
        return session.withLock(() -> {
            List<Cookie> cookies;
            if (!urls.isEmpty()) {
                cookies = session.context().cookies(urls);
            } else if (currentPageOnly) {
                cookies = session.context().cookies(List.of(session.page().url()));
            } else {
                cookies = session.context().cookies();
            }
            List<Map<String, Object>> items = cookies.stream()
                    .map(cookie -> mapCookie(cookie, includeValue))
                    .toList();
            Map<String, Object> result = Results.ok();
            result.put("url", session.page().url());
            result.put("cookies", items);
            result.put("count", items.size());
            return result;
        });
    }

    Map<String, Object> setCookies(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        List<Map<String, Object>> items = Args.requiredMapList(args, "cookies");
        return session.withLock(() -> {
            List<Cookie> cookies = new ArrayList<>();
            for (Map<String, Object> item : items) {
                cookies.add(toCookie(item));
            }
            session.context().addCookies(cookies);
            Map<String, Object> result = Results.ok();
            result.put("count", cookies.size());
            return result;
        });
    }

    Map<String, Object> clearCookies(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        return session.withLock(() -> {
            session.context().clearCookies();
            return Results.ok("Cookies cleared.");
        });
    }

    Map<String, Object> getLocalStorage(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        return getWebStorage(context, args, "localStorage");
    }

    Map<String, Object> getSessionStorage(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        return getWebStorage(context, args, "sessionStorage");
    }

    Map<String, Object> setLocalStorage(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        Map<String, Object> items = Args.optionalMap(args, "items");
        if (items.isEmpty()) {
            throw new IllegalArgumentException("items is required");
        }
        return session.withLock(() -> {
            session.page().evaluate("items => { for (const [k, v] of Object.entries(items)) window.localStorage.setItem(k, String(v)); }", items);
            Map<String, Object> result = Results.ok();
            result.put("count", items.size());
            return result;
        });
    }

    Map<String, Object> clearStorage(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        boolean localStorage = Args.optionalBoolean(args, "localStorage", true);
        boolean sessionStorage = Args.optionalBoolean(args, "sessionStorage", true);
        return session.withLock(() -> {
            session.page().evaluate("flags => { if (flags.localStorage) window.localStorage.clear(); if (flags.sessionStorage) window.sessionStorage.clear(); }",
                    Map.of("localStorage", localStorage, "sessionStorage", sessionStorage));
            Map<String, Object> result = Results.ok();
            result.put("localStorage", localStorage);
            result.put("sessionStorage", sessionStorage);
            return result;
        });
    }

    Map<String, Object> storageStateSave(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserPluginConfig config = config(context);
        BrowserSession session = requireSession(context, args);
        Path path = pathResolver.resolveStatePath(config, args, true);
        return session.withLock(() -> {
            session.context().storageState(new BrowserContext.StorageStateOptions().setPath(path));
            Map<String, Object> result = Results.ok();
            result.put("path", path.toString());
            return result;
        });
    }

    Map<String, Object> screenshot(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserPluginConfig config = config(context);
        BrowserSession session = requireSession(context, args);
        Path path = pathResolver.resolveArtifactPath(config, args, true);
        boolean fullPage = Args.optionalBoolean(args, "fullPage", true);
        return session.withLock(() -> {
            session.page().screenshot(new Page.ScreenshotOptions().setPath(path).setFullPage(fullPage));
            Map<String, Object> result = Results.ok();
            result.put("path", path.toString());
            result.put("fullPage", fullPage);
            return result;
        });
    }

    private Map<String, Object> getWebStorage(ScriptPluginContext context, Map<String, Object> args, String storageName) throws Exception {
        BrowserSession session = requireSession(context, args);
        return session.withLock(() -> {
            Object value = session.page().evaluate("name => { const storage = window[name]; const out = {}; for (let i = 0; i < storage.length; i++) { const key = storage.key(i); out[key] = storage.getItem(key); } return out; }", storageName);
            Map<String, Object> result = Results.ok();
            result.put("items", value);
            return result;
        });
    }

    private BrowserSession requireSession(ScriptPluginContext context, Map<String, Object> args) {
        return sessions.require(context, config(context), args);
    }

    private BrowserPluginConfig config(ScriptPluginContext context) {
        return context.getPluginConfig(BrowserPluginConfig.class);
    }

    private Browser launchBrowser(Playwright playwright, String browserName, boolean headless) {
        BrowserType.LaunchOptions options = new BrowserType.LaunchOptions().setHeadless(headless);
        return switch (browserName) {
            case "chromium" -> playwright.chromium().launch(options);
            case "firefox" -> playwright.firefox().launch(options);
            case "webkit" -> playwright.webkit().launch(options);
            default -> throw new IllegalArgumentException("Unsupported browser: " + browserName);
        };
    }

    private static Map<String, Object> pageSnapshot(Page page) {
        Map<String, Object> result = Results.ok();
        result.put("url", page.url());
        result.put("title", page.title());
        return result;
    }

    private static Map<String, Object> simpleSelectorResult(String selector) {
        Map<String, Object> result = Results.ok();
        result.put("selector", selector);
        return result;
    }

    private static Map<String, Object> mapCookie(Cookie cookie, boolean includeValue) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("name", cookie.name);
        item.put("value", includeValue ? cookie.value : "***");
        item.put("domain", cookie.domain);
        item.put("path", cookie.path);
        item.put("expires", cookie.expires);
        item.put("httpOnly", cookie.httpOnly);
        item.put("secure", cookie.secure);
        item.put("sameSite", cookie.sameSite == null ? null : cookie.sameSite.name());
        return item;
    }

    private static Cookie toCookie(Map<String, Object> item) {
        Cookie cookie = new Cookie(Args.requiredString(item, "name"), Args.requiredString(item, "value"));
        String url = Args.optionalString(item, "url", null);
        String domain = Args.optionalString(item, "domain", null);
        String path = Args.optionalString(item, "path", null);
        Double expires = Args.optionalDouble(item, "expires");
        SameSiteAttribute sameSite = BrowserEnums.sameSite(Args.optionalString(item, "sameSite", null));

        if (!Args.isBlank(url)) {
            cookie.setUrl(url);
        }
        if (!Args.isBlank(domain)) {
            cookie.setDomain(domain);
        }
        if (!Args.isBlank(path)) {
            cookie.setPath(path);
        }
        if (expires != null) {
            cookie.setExpires(expires);
        }
        cookie.setHttpOnly(Args.optionalBoolean(item, "httpOnly", false));
        cookie.setSecure(Args.optionalBoolean(item, "secure", false));
        if (sameSite != null) {
            cookie.setSameSite(sameSite);
        }
        return cookie;
    }
}
