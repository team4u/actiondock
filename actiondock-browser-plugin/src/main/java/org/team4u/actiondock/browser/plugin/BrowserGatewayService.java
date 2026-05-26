package org.team4u.actiondock.browser.plugin;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.ConsoleMessage;
import com.microsoft.playwright.Dialog;
import com.microsoft.playwright.Download;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.Request;
import com.microsoft.playwright.Response;
import com.microsoft.playwright.Route;
import com.microsoft.playwright.APIResponse;
import com.microsoft.playwright.options.Geolocation;
import com.microsoft.playwright.options.LoadState;
import com.microsoft.playwright.options.Cookie;
import com.microsoft.playwright.options.Margin;
import com.microsoft.playwright.options.RequestOptions;
import com.microsoft.playwright.options.WaitForSelectorState;
import com.microsoft.playwright.options.WaitUntilState;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

final class BrowserGatewayService {
    private static final int MAX_WAIT_TIMEOUT_MS = 120000;
    private static final int DEFAULT_OBSERVE_LIMIT = 80;
    private static final String OBSERVE_SCRIPT = """
            ({ limit, maxTextLength }) => {
              const textOf = (value) => typeof value === 'string' ? value.replace(/\\s+/g, ' ').trim() : '';
              const isVisible = (el) => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
              };
              const cssPath = (el) => {
                if (el.id) return '#' + CSS.escape(el.id);
                const parts = [];
                let cur = el;
                while (cur && cur.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
                  let part = cur.localName.toLowerCase();
                  if (cur.classList && cur.classList.length) {
                    part += '.' + Array.from(cur.classList).slice(0, 2).map(CSS.escape).join('.');
                  }
                  const parent = cur.parentElement;
                  if (parent) {
                    const same = Array.from(parent.children).filter(child => child.localName === cur.localName);
                    if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
                  }
                  parts.unshift(part);
                  cur = parent;
                }
                return parts.join(' > ');
              };
              const testIdOf = (el) => el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('testid') || null;
              const labelOf = (el) => {
                if (typeof el.labels !== 'undefined' && el.labels && el.labels.length) {
                  const joined = Array.from(el.labels).map(label => textOf(label.innerText || label.textContent)).filter(Boolean).join(' ');
                  if (joined) return joined;
                }
                const ariaLabelledBy = el.getAttribute('aria-labelledby');
                if (ariaLabelledBy) {
                  const joined = ariaLabelledBy.split(/\\s+/)
                    .map(id => document.getElementById(id))
                    .filter(Boolean)
                    .map(node => textOf(node.innerText || node.textContent))
                    .filter(Boolean)
                    .join(' ');
                  if (joined) return joined;
                }
                const parentLabel = el.closest('label');
                if (parentLabel) {
                  const text = textOf(parentLabel.innerText || parentLabel.textContent);
                  if (text) return text;
                }
                return textOf(el.getAttribute('aria-label'));
              };
              const accessibleNameOf = (el, text, label) =>
                textOf(el.getAttribute('aria-label')) ||
                label ||
                textOf(el.getAttribute('name')) ||
                textOf(el.getAttribute('title')) ||
                text;
              const roleOf = (el) => el.getAttribute('role') || ({
                A: el.hasAttribute('href') ? 'link' : null,
                BUTTON: 'button',
                SELECT: 'combobox',
                TEXTAREA: 'textbox'
              }[el.tagName]) || (el.tagName === 'INPUT' ? ({
                checkbox: 'checkbox',
                radio: 'radio',
                submit: 'button',
                button: 'button',
                search: 'searchbox'
              }[String(el.type || '').toLowerCase()] || 'textbox') : null);
              const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable],label,summary,[tabindex]'))
                .filter(isVisible)
                .slice(0, limit)
                .map((el, index) => {
                  const rect = el.getBoundingClientRect();
                  const text = textOf(el.innerText || el.textContent || el.value || '');
                  const label = labelOf(el);
                  const placeholder = textOf(el.getAttribute('placeholder'));
                  const title = textOf(el.getAttribute('title'));
                  const alt = textOf(el.getAttribute('alt'));
                  const href = textOf(el.getAttribute('href'));
                  const testId = testIdOf(el);
                  const type = textOf(el.getAttribute('type')) || el.tagName.toLowerCase();
                  const item = {
                    ref: `e${index + 1}`,
                    selector: cssPath(el),
                    tag: el.tagName.toLowerCase(),
                    type,
                    role: roleOf(el),
                    name: accessibleNameOf(el, text, label),
                    text: text.slice(0, 240),
                    label: label || null,
                    placeholder: placeholder || null,
                    title: title || null,
                    alt: alt || null,
                    testId: testId || null,
                    href: href || null,
                    visible: true,
                    enabled: !el.disabled,
                    checked: typeof el.checked === 'boolean' ? el.checked : null,
                    value: typeof el.value === 'string' ? el.value : null,
                    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                  };
                  return item;
                });
              const visibleText = (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, maxTextLength);
              const forms = Array.from(document.forms || []).map((form, index) => ({
                index,
                action: form.action,
                method: form.method,
                fields: Array.from(form.elements || []).map(el => ({
                  name: el.name || null,
                  type: el.type || el.tagName.toLowerCase(),
                  value: typeof el.value === 'string' ? el.value : null
                }))
              }));
              return { visibleText, elements: candidates, forms };
            }
            """;

    private final BrowserSessionManager sessions;
    private final BrowserPathResolver pathResolver;
    private final TargetResolver targetResolver = new TargetResolver();

    BrowserGatewayService(BrowserSessionManager sessions, BrowserPathResolver pathResolver) {
        this.sessions = sessions;
        this.pathResolver = pathResolver;
    }

    Map<String, Object> createSession(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserPluginConfig config = config(context);
        BrowserConfigValidator.validate(config);
        String browserName = BrowserConfigValidator.normalizeBrowser(Args.optionalString(args, "browser", config.getDefaultBrowser()));
        boolean headless = Args.optionalBoolean(args, "headless", config.isHeadless());
        int timeoutMs = Args.optionalInt(args, "timeoutMs", config.getDefaultTimeoutMs());

        Playwright playwright = Playwright.create();
        Browser browser = launchBrowser(playwright, browserName, headless);
        Browser.NewContextOptions contextOptions = new Browser.NewContextOptions().setAcceptDownloads(true);
        applyContextOptions(contextOptions, config, args);

        BrowserContext browserContext = browser.newContext(contextOptions);
        browserContext.setDefaultTimeout(timeoutMs);
        browserContext.setDefaultNavigationTimeout(timeoutMs);
        Page page = browserContext.newPage();

        String sessionId = sessions.newSessionId();
        BrowserSession session = new BrowserSession(
                sessionId,
                BrowserSessionManager.ownerKey(context),
                browserName,
                playwright,
                browser,
                browserContext,
                page,
                timeoutMs
        );
        sessions.add(config, session);

        Map<String, Object> result = Results.ok("Browser session created.");
        result.put("sessionId", sessionId);
        result.put("browser", browserName);
        result.put("headless", headless);
        result.put("pageId", session.activePageId());
        return result;
    }

    Map<String, Object> closeSession(ScriptPluginContext context, Map<String, Object> args) {
        return sessions.close(context, config(context), args);
    }

    Map<String, Object> sessionInfo(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        return sessions.info(requireSession(context, args));
    }

    Map<String, Object> sessionList(ScriptPluginContext context) {
        return sessions.list(context, config(context));
    }

    Map<String, Object> snapshot(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String pageId = Args.optionalString(args, "pageId", null);
        int limit = Args.optionalInt(args, "limit", DEFAULT_OBSERVE_LIMIT);
        int maxTextLength = Args.optionalInt(args, "maxTextLength", 6000);
        return session.withLock(() -> {
            Page page = session.page(pageId);
            String resolvedPageId = resolvedPageId(session, pageId);
            Map<String, Object> observed = castMap(page.evaluate(OBSERVE_SCRIPT, Map.of(
                    "limit", Math.max(1, limit),
                    "maxTextLength", Math.max(0, maxTextLength)
            )));
            List<Map<String, Object>> elements = castMapList(observed.get("elements"));
            session.replaceRefs(resolvedPageId, elements);

            Map<String, Object> result = pageResult(session, resolvedPageId, page);
            result.put("ariaSnapshot", safeAriaSnapshot(page));
            result.put("visibleText", observed.get("visibleText"));
            result.put("elements", elements);
            result.put("suggestedActions", suggestedActions(elements));
            result.put("forms", observed.getOrDefault("forms", List.of()));
            result.put("frames", frames(page));
            result.put("events", session.events(resolvedPageId, List.of(), 0, false));
            return result;
        });
    }

    Map<String, Object> execute(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String op = Args.requiredString(args, "op").trim();
        String pageId = Args.optionalString(args, "pageId", null);
        Map<String, Object> target = Args.optionalMap(args, "target");
        Map<String, Object> values = Args.optionalMap(args, "args");
        Map<String, Object> options = Args.optionalMap(args, "options");

        return session.withLock(() -> {
            Page page = session.page(pageId);
            String resolvedPageId = resolvedPageId(session, pageId);
            Object data = switch (op) {
                case "goto" -> {
                    String url = Args.requiredString(values, "url");
                    WaitUntilState waitUntil = BrowserEnums.waitUntil(Args.optionalString(options, "waitUntil", null), WaitUntilState.LOAD);
                    int timeoutMs = Args.optionalInt(options, "timeoutMs", config(context).getDefaultTimeoutMs());
                    Response response = page.navigate(url, new Page.NavigateOptions().setWaitUntil(waitUntil).setTimeout(timeoutMs));
                    yield response == null ? Map.of() : responseMap(response);
                }
                case "reload" -> {
                    Response response = page.reload();
                    yield response == null ? Map.of() : responseMap(response);
                }
                case "back", "goBack" -> {
                    Response response = page.goBack();
                    yield response == null ? Map.of() : responseMap(response);
                }
                case "forward", "goForward" -> {
                    Response response = page.goForward();
                    yield response == null ? Map.of() : responseMap(response);
                }
                case "click" -> {
                    target(session, page, resolvedPageId, target).click();
                    yield Map.of();
                }
                case "dblclick" -> {
                    target(session, page, resolvedPageId, target).dblclick();
                    yield Map.of();
                }
                case "hover" -> {
                    target(session, page, resolvedPageId, target).hover();
                    yield Map.of();
                }
                case "fill" -> {
                    target(session, page, resolvedPageId, target).fill(Args.requiredString(values, "value"));
                    yield Map.of();
                }
                case "type" -> {
                    target(session, page, resolvedPageId, target).type(Args.requiredString(values, "text"));
                    yield Map.of();
                }
                case "clear" -> {
                    target(session, page, resolvedPageId, target).clear();
                    yield Map.of();
                }
                case "press" -> {
                    String key = Args.requiredString(values, "key");
                    if (target.isEmpty()) {
                        page.keyboard().press(key);
                    } else {
                        target(session, page, resolvedPageId, target).press(key);
                    }
                    yield Map.of("key", key);
                }
                case "check" -> {
                    target(session, page, resolvedPageId, target).check();
                    yield Map.of("checked", target(session, page, resolvedPageId, target).isChecked());
                }
                case "uncheck" -> {
                    target(session, page, resolvedPageId, target).uncheck();
                    yield Map.of("checked", target(session, page, resolvedPageId, target).isChecked());
                }
                case "selectOption" -> {
                    List<String> valuesList = Args.optionalStringList(values, "values");
                    if (valuesList.isEmpty()) {
                        valuesList = List.of(Args.requiredString(values, "value"));
                    }
                    yield Map.of("values", target(session, page, resolvedPageId, target).selectOption(valuesList.toArray(String[]::new)));
                }
                case "setInputFiles" -> {
                    List<String> paths = Args.optionalStringList(values, "paths");
                    if (paths.isEmpty()) {
                        paths = List.of(Args.requiredString(values, "path"));
                    }
                    Path[] files = new Path[paths.size()];
                    for (int i = 0; i < paths.size(); i++) {
                        files[i] = pathResolver.resolveInputFilePath(paths.get(i));
                    }
                    target(session, page, resolvedPageId, target).setInputFiles(files);
                    yield Map.of("paths", paths);
                }
                case "focus" -> {
                    target(session, page, resolvedPageId, target).focus();
                    yield Map.of();
                }
                case "blur" -> {
                    target(session, page, resolvedPageId, target).blur();
                    yield Map.of();
                }
                case "scrollIntoView" -> {
                    target(session, page, resolvedPageId, target).scrollIntoViewIfNeeded();
                    yield Map.of();
                }
                case "tap" -> {
                    target(session, page, resolvedPageId, target).tap();
                    yield Map.of();
                }
                case "dragTo" -> {
                    Locator source = target(session, page, resolvedPageId, target);
                    Locator destination = target(session, page, resolvedPageId, Args.optionalMap(values, "target"));
                    source.dragTo(destination);
                    yield Map.of();
                }
                case "setContent" -> {
                    page.setContent(Args.requiredString(values, "html"));
                    yield Map.of();
                }
                case "addScriptTag" -> {
                    Page.AddScriptTagOptions scriptOptions = new Page.AddScriptTagOptions();
                    String content = Args.optionalString(values, "content", null);
                    String url = Args.optionalString(values, "url", null);
                    String path = Args.optionalString(values, "path", null);
                    if (!Args.isBlank(content)) scriptOptions.setContent(content);
                    if (!Args.isBlank(url)) scriptOptions.setUrl(url);
                    if (!Args.isBlank(path)) scriptOptions.setPath(pathResolver.resolveInputFilePath(path));
                    page.addScriptTag(scriptOptions);
                    yield Map.of();
                }
                case "addStyleTag" -> {
                    Page.AddStyleTagOptions styleOptions = new Page.AddStyleTagOptions();
                    String content = Args.optionalString(values, "content", null);
                    String url = Args.optionalString(values, "url", null);
                    String path = Args.optionalString(values, "path", null);
                    if (!Args.isBlank(content)) styleOptions.setContent(content);
                    if (!Args.isBlank(url)) styleOptions.setUrl(url);
                    if (!Args.isBlank(path)) styleOptions.setPath(pathResolver.resolveInputFilePath(path));
                    page.addStyleTag(styleOptions);
                    yield Map.of();
                }
                case "screenshot" -> screenshot(config(context), page, null, values);
                case "locatorScreenshot" -> screenshot(config(context), page, target(session, page, resolvedPageId, target), values);
                case "pdf" -> pdf(config(context), page, values);
                case "dialogAccept" -> {
                    String dialogId = Args.requiredString(values, "dialogId");
                    Dialog dialog = session.takeDialog(dialogId);
                    dialog.accept(Args.optionalString(values, "promptText", ""));
                    yield Map.of("dialogId", dialogId);
                }
                case "dialogDismiss" -> {
                    String dialogId = Args.requiredString(values, "dialogId");
                    session.takeDialog(dialogId).dismiss();
                    yield Map.of("dialogId", dialogId);
                }
                default -> throw new IllegalArgumentException("Unsupported act op: " + op);
            };

            Map<String, Object> result = pageResult(session, resolvedPageId, page);
            result.put("op", op);
            result.put("data", data);
            return result;
        });
    }

    Map<String, Object> evaluate(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String pageId = Args.optionalString(args, "pageId", null);
        String scope = Args.optionalString(args, "scope", "page");
        String expression = Args.requiredString(args, "expression");
        Object argument = args == null ? null : args.get("arg");
        Map<String, Object> target = Args.optionalMap(args, "target");

        return session.withLock(() -> {
            Page page = session.page(pageId);
            String resolvedPageId = resolvedPageId(session, pageId);
            Object value = switch (scope) {
                case "page" -> page.evaluate(expression, argument);
                case "locator" -> target(session, page, resolvedPageId, target).evaluate(expression, argument);
                case "all" -> target(session, page, resolvedPageId, target).evaluateAll(expression, argument);
                default -> throw new IllegalArgumentException("Unsupported evaluate scope: " + scope);
            };
            Map<String, Object> result = pageResult(session, resolvedPageId, page);
            result.put("scope", scope);
            result.put("value", value);
            return result;
        });
    }

    Map<String, Object> wait(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String pageId = Args.optionalString(args, "pageId", null);
        String kind = Args.requiredString(args, "for");
        int timeoutMs = Args.optionalInt(args, "timeoutMs", config(context).getDefaultTimeoutMs());
        if (timeoutMs <= 0 || timeoutMs > MAX_WAIT_TIMEOUT_MS) {
            throw new IllegalArgumentException("timeoutMs must be between 1 and " + MAX_WAIT_TIMEOUT_MS);
        }

        return session.withLock(() -> {
            Page page = session.page(pageId);
            String resolvedPageId = resolvedPageId(session, pageId);
            Object data = switch (kind) {
                case "loadState" -> {
                    LoadState state = BrowserEnums.loadState(Args.optionalString(args, "state", null), LoadState.LOAD);
                    page.waitForLoadState(state, new Page.WaitForLoadStateOptions().setTimeout(timeoutMs));
                    yield Map.of("state", state.name().toLowerCase());
                }
                case "selector" -> {
                    Locator locator = target(session, page, resolvedPageId, Args.optionalMap(args, "target"));
                    WaitForSelectorState state = BrowserEnums.selectorState(Args.optionalString(args, "state", null), WaitForSelectorState.VISIBLE);
                    locator.waitFor(new Locator.WaitForOptions().setState(state).setTimeout(timeoutMs));
                    yield Map.of("state", state.name().toLowerCase());
                }
                case "url" -> {
                    String url = Args.requiredString(args, "url");
                    page.waitForURL(url, new Page.WaitForURLOptions().setTimeout(timeoutMs));
                    yield Map.of("url", page.url());
                }
                case "function" -> {
                    Object value = page.waitForFunction(Args.requiredString(args, "expression"), args.get("arg"),
                            new Page.WaitForFunctionOptions().setTimeout(timeoutMs));
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("handle", value == null ? null : value.toString());
                    yield item;
                }
                case "request" -> requestMap(page.waitForRequest(Args.requiredString(args, "url"), new Page.WaitForRequestOptions().setTimeout(timeoutMs), () -> {
                }));
                case "response" -> responseMap(page.waitForResponse(Args.requiredString(args, "url"), new Page.WaitForResponseOptions().setTimeout(timeoutMs), () -> {
                }));
                case "console" -> consoleMap(page.waitForConsoleMessage(new Page.WaitForConsoleMessageOptions().setTimeout(timeoutMs), () -> {
                }));
                case "popup" -> {
                    Page popup = page.waitForPopup(new Page.WaitForPopupOptions().setTimeout(timeoutMs), () -> {
                    });
                    String popupPageId = session.registerPage(popup);
                    yield Map.of("pageId", popupPageId, "url", popup.url(), "title", popup.title());
                }
                case "download" -> {
                    Download download = page.waitForDownload(new Page.WaitForDownloadOptions().setTimeout(timeoutMs), () -> {
                    });
                    String downloadId = session.rememberDownload(resolvedPageId, download);
                    yield Map.of("downloadId", downloadId, "url", download.url(), "suggestedFilename", download.suggestedFilename());
                }
                case "timeout" -> {
                    page.waitForTimeout(timeoutMs);
                    yield Map.of("timeoutMs", timeoutMs);
                }
                default -> throw new IllegalArgumentException("Unsupported wait kind: " + kind);
            };
            Map<String, Object> result = pageResult(session, resolvedPageId, page);
            result.put("for", kind);
            result.put("data", data);
            return result;
        });
    }

    Map<String, Object> tabs(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String op = Args.requiredString(args, "op");
        return session.withLock(() -> {
            Object data = switch (op) {
                case "list" -> session.pagesInfo();
                case "new" -> {
                    String pageId = session.newPage();
                    String url = Args.optionalString(args, "url", null);
                    Page page = session.page(pageId);
                    if (!Args.isBlank(url)) {
                        page.navigate(url);
                    }
                    session.switchPage(pageId);
                    yield Map.of("pageId", pageId, "url", page.url(), "title", page.title());
                }
                case "switch" -> {
                    String pageId = Args.requiredString(args, "pageId");
                    session.switchPage(pageId);
                    Page page = session.page(pageId);
                    yield Map.of("pageId", pageId, "url", page.url(), "title", page.title());
                }
                case "close" -> {
                    String pageId = Args.requiredString(args, "pageId");
                    session.closePage(pageId);
                    yield Map.of("pageId", pageId, "closed", true);
                }
                case "bringToFront" -> {
                    String pageId = Args.optionalString(args, "pageId", session.activePageId());
                    Page page = session.page(pageId);
                    page.bringToFront();
                    session.switchPage(pageId);
                    yield Map.of("pageId", pageId, "url", page.url(), "title", page.title());
                }
                default -> throw new IllegalArgumentException("Unsupported pages op: " + op);
            };
            Map<String, Object> result = Results.ok();
            result.put("sessionId", session.sessionId());
            result.put("activePageId", session.activePageId());
            result.put("op", op);
            result.put("data", data);
            return result;
        });
    }

    Map<String, Object> events(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        return session.withLock(() -> {
            String pageId = Args.optionalString(args, "pageId", null);
            List<String> types = Args.optionalStringList(args, "types");
            int sinceId = Args.optionalInt(args, "sinceId", 0);
            boolean clear = Args.optionalBoolean(args, "clear", false);
            List<Map<String, Object>> events = session.events(pageId, types, sinceId, clear);
            Map<String, Object> result = Results.ok();
            result.put("sessionId", session.sessionId());
            result.put("pageId", pageId);
            result.put("events", events);
            result.put("count", events.size());
            result.put("cleared", clear);
            return result;
        });
    }

    Map<String, Object> cookiesGet(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        return session.withLock(() -> {
            List<String> urls = Args.optionalStringList(args, "urls");
            List<Cookie> cookies = urls.isEmpty() ? session.context().cookies() : session.context().cookies(urls);
            Map<String, Object> result = Results.ok();
            result.put("sessionId", session.sessionId());
            result.put("cookies", cookies.stream().map(BrowserGatewayService::cookieMap).toList());
            return result;
        });
    }

    Map<String, Object> cookiesSet(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        List<Map<String, Object>> values = Args.requiredMapList(args, "cookies");
        return session.withLock(() -> {
            session.context().addCookies(values.stream().map(BrowserGatewayService::cookie).toList());
            Map<String, Object> result = Results.ok();
            result.put("sessionId", session.sessionId());
            result.put("count", values.size());
            return result;
        });
    }

    Map<String, Object> cookiesClear(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        return session.withLock(() -> {
            session.context().clearCookies();
            Map<String, Object> result = Results.ok();
            result.put("sessionId", session.sessionId());
            result.put("cleared", true);
            return result;
        });
    }

    Map<String, Object> storageState(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        BrowserPluginConfig config = config(context);
        return session.withLock(() -> {
            BrowserContext.StorageStateOptions options = new BrowserContext.StorageStateOptions();
            if (Args.has(args, "stateName") || Args.has(args, "path") || Args.has(args, "storageStatePath")) {
                options.setPath(pathResolver.resolveStatePath(config, args, true));
            }
            if (Args.has(args, "indexedDB")) {
                options.setIndexedDB(Args.optionalBoolean(args, "indexedDB", false));
            }
            String state = session.context().storageState(options);
            Map<String, Object> result = Results.ok();
            result.put("sessionId", session.sessionId());
            result.put("state", state);
            result.put("path", options.path == null ? null : options.path.toString());
            return result;
        });
    }

    Map<String, Object> networkRoute(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String url = Args.requiredString(args, "url");
        String action = Args.optionalString(args, "routeAction", "abort");
        return session.withLock(() -> {
            AutoCloseable route = session.context().route(url, item -> handleRoute(item, args, action));
            String routeId = session.rememberRoute(route);
            Map<String, Object> result = Results.ok();
            result.put("sessionId", session.sessionId());
            result.put("routeId", routeId);
            result.put("url", url);
            result.put("routeAction", action);
            return result;
        });
    }

    Map<String, Object> networkUnroute(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        return session.withLock(() -> {
            if (Args.has(args, "routeId")) {
                session.takeRoute(Args.requiredString(args, "routeId")).close();
            } else if (Args.has(args, "url")) {
                session.context().unroute(Args.requiredString(args, "url"));
            } else {
                session.context().unrouteAll();
            }
            Map<String, Object> result = Results.ok();
            result.put("sessionId", session.sessionId());
            result.put("removed", true);
            return result;
        });
    }

    Map<String, Object> networkSetOffline(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        return session.withLock(() -> {
            boolean offline = Args.optionalBoolean(args, "offline", true);
            session.context().setOffline(offline);
            Map<String, Object> result = Results.ok();
            result.put("sessionId", session.sessionId());
            result.put("offline", offline);
            return result;
        });
    }

    Map<String, Object> networkSetExtraHTTPHeaders(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        return session.withLock(() -> {
            Map<String, String> headers = stringMap(Args.optionalMap(args, "headers"));
            session.context().setExtraHTTPHeaders(headers);
            Map<String, Object> result = Results.ok();
            result.put("sessionId", session.sessionId());
            result.put("headers", headers);
            return result;
        });
    }

    Map<String, Object> httpRequest(ScriptPluginContext context, Map<String, Object> args) throws Exception {
        BrowserSession session = requireSession(context, args);
        String url = Args.requiredString(args, "url");
        String method = Args.optionalString(args, "method", "GET").toUpperCase();
        return session.withLock(() -> {
            RequestOptions options = RequestOptions.create().setMethod(method);
            applyRequestOptions(options, args);
            APIResponse response = session.context().request().fetch(url, options);
            Map<String, Object> result = Results.ok();
            result.put("sessionId", session.sessionId());
            result.put("response", apiResponseMap(response, Args.optionalInt(args, "maxBodyLength", 4000)));
            return result;
        });
    }

    private Locator target(BrowserSession session, Page page, String pageId, Map<String, Object> target) {
        return targetResolver.locator(session, page, pageId, target);
    }


    private void applyContextOptions(Browser.NewContextOptions options, BrowserPluginConfig config, Map<String, Object> args) throws Exception {
        Map<String, Object> viewport = Args.optionalMap(args, "viewport");
        if (!viewport.isEmpty()) {
            options.setViewportSize(Args.optionalInt(viewport, "width", 1280), Args.optionalInt(viewport, "height", 720));
        }
        String userAgent = Args.optionalString(args, "userAgent", null);
        if (!Args.isBlank(userAgent)) {
            options.setUserAgent(userAgent);
        }
        String locale = Args.optionalString(args, "locale", null);
        if (!Args.isBlank(locale)) {
            options.setLocale(locale);
        }
        String timezoneId = Args.optionalString(args, "timezoneId", null);
        if (!Args.isBlank(timezoneId)) {
            options.setTimezoneId(timezoneId);
        }
        if (args.containsKey("ignoreHTTPSErrors")) {
            options.setIgnoreHTTPSErrors(Args.optionalBoolean(args, "ignoreHTTPSErrors", false));
        }
        if (args.containsKey("javaScriptEnabled")) {
            options.setJavaScriptEnabled(Args.optionalBoolean(args, "javaScriptEnabled", true));
        }
        if (args.containsKey("isMobile")) {
            options.setIsMobile(Args.optionalBoolean(args, "isMobile", false));
        }
        if (args.containsKey("hasTouch")) {
            options.setHasTouch(Args.optionalBoolean(args, "hasTouch", false));
        }
        Map<String, Object> geolocation = Args.optionalMap(args, "geolocation");
        if (!geolocation.isEmpty()) {
            Geolocation value = new Geolocation(
                    Args.optionalDouble(geolocation, "latitude"),
                    Args.optionalDouble(geolocation, "longitude")
            );
            Double accuracy = Args.optionalDouble(geolocation, "accuracy");
            if (accuracy != null) {
                value.setAccuracy(accuracy);
            }
            options.setGeolocation(value);
        }
        Map<String, Object> headers = Args.optionalMap(args, "extraHTTPHeaders");
        if (!headers.isEmpty()) {
            Map<String, String> stringHeaders = new LinkedHashMap<>();
            headers.forEach((key, value) -> stringHeaders.put(key, value == null ? "" : String.valueOf(value)));
            options.setExtraHTTPHeaders(stringHeaders);
        }
        List<String> permissions = Args.optionalStringList(args, "permissions");
        if (!permissions.isEmpty()) {
            options.setPermissions(permissions);
        }
        Map<String, Object> httpCredentials = Args.optionalMap(args, "httpCredentials");
        if (!httpCredentials.isEmpty()) {
            options.setHttpCredentials(
                    Args.requiredString(httpCredentials, "username"),
                    Args.requiredString(httpCredentials, "password")
            );
        }
        if (!Args.isBlank(Args.optionalString(args, "storageStatePath", null))
                || !Args.isBlank(Args.optionalString(args, "stateName", null))) {
            options.setStorageStatePath(pathResolver.resolveStatePath(config, args, false));
        }
    }

    private Object screenshot(BrowserPluginConfig config, Page page, Locator locator, Map<String, Object> values) throws Exception {
        Path path = pathResolver.resolveArtifactPath(config, values, true);
        if (locator == null) {
            page.screenshot(new Page.ScreenshotOptions()
                    .setPath(path)
                    .setFullPage(Args.optionalBoolean(values, "fullPage", true)));
        } else {
            locator.screenshot(new Locator.ScreenshotOptions().setPath(path));
        }
        return Map.of("path", path.toString());
    }

    private Object pdf(BrowserPluginConfig config, Page page, Map<String, Object> values) throws Exception {
        Path path = pathResolver.resolvePdfPath(config, values, true);
        Page.PdfOptions options = new Page.PdfOptions().setPath(path);
        String format = Args.optionalString(values, "format", null);
        if (!Args.isBlank(format)) {
            options.setFormat(format);
        }
        if (values.containsKey("printBackground")) {
            options.setPrintBackground(Args.optionalBoolean(values, "printBackground", false));
        }
        if (values.containsKey("landscape")) options.setLandscape(Args.optionalBoolean(values, "landscape", false));
        Double scale = Args.optionalDouble(values, "scale");
        if (scale != null) options.setScale(scale);
        String pageRanges = Args.optionalString(values, "pageRanges", null);
        if (!Args.isBlank(pageRanges)) options.setPageRanges(pageRanges);
        String width = Args.optionalString(values, "width", null);
        if (!Args.isBlank(width)) options.setWidth(width);
        String height = Args.optionalString(values, "height", null);
        if (!Args.isBlank(height)) options.setHeight(height);
        if (values.containsKey("displayHeaderFooter")) options.setDisplayHeaderFooter(Args.optionalBoolean(values, "displayHeaderFooter", false));
        String headerTemplate = Args.optionalString(values, "headerTemplate", null);
        if (!Args.isBlank(headerTemplate)) options.setHeaderTemplate(headerTemplate);
        String footerTemplate = Args.optionalString(values, "footerTemplate", null);
        if (!Args.isBlank(footerTemplate)) options.setFooterTemplate(footerTemplate);
        if (values.containsKey("preferCSSPageSize")) options.setPreferCSSPageSize(Args.optionalBoolean(values, "preferCSSPageSize", false));
        if (values.containsKey("outline")) options.setOutline(Args.optionalBoolean(values, "outline", false));
        if (values.containsKey("tagged")) options.setTagged(Args.optionalBoolean(values, "tagged", false));
        Map<String, Object> marginValues = Args.optionalMap(values, "margin");
        if (!marginValues.isEmpty()) {
            Margin margin = new Margin();
            String top = Args.optionalString(marginValues, "top", null);
            if (!Args.isBlank(top)) margin.setTop(top);
            String right = Args.optionalString(marginValues, "right", null);
            if (!Args.isBlank(right)) margin.setRight(right);
            String bottom = Args.optionalString(marginValues, "bottom", null);
            if (!Args.isBlank(bottom)) margin.setBottom(bottom);
            String left = Args.optionalString(marginValues, "left", null);
            if (!Args.isBlank(left)) margin.setLeft(left);
            options.setMargin(margin);
        }
        page.pdf(options);
        return Map.of("path", path.toString());
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

    private static String resolvedPageId(BrowserSession session, String pageId) {
        return Args.isBlank(pageId) ? session.activePageId() : pageId;
    }

    private static Map<String, Object> pageResult(BrowserSession session, String pageId, Page page) {
        Map<String, Object> result = Results.ok();
        result.put("sessionId", session.sessionId());
        result.put("pageId", pageId);
        result.put("url", page.url());
        result.put("title", page.title());
        return result;
    }

    private static String safeAriaSnapshot(Page page) {
        try {
            return page.ariaSnapshot();
        } catch (RuntimeException exception) {
            return "";
        }
    }

    private static List<Map<String, Object>> frames(Page page) {
        List<Map<String, Object>> frames = new ArrayList<>();
        for (var frame : page.frames()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("name", frame.name());
            item.put("url", frame.url());
            frames.add(item);
        }
        return frames;
    }

    private static List<Map<String, Object>> suggestedActions(List<Map<String, Object>> elements) {
        List<Map<String, Object>> suggestions = new ArrayList<>();
        for (Map<String, Object> element : elements) {
            String ref = String.valueOf(element.get("ref"));
            String role = String.valueOf(element.getOrDefault("role", ""));
            String tag = String.valueOf(element.getOrDefault("tag", ""));
            Object checked = element.get("checked");
            if (Boolean.TRUE.equals(checked) || Boolean.FALSE.equals(checked) || "checkbox".equals(role) || "radio".equals(role)) {
                suggestions.add(Map.of("action", "act", "op", Boolean.TRUE.equals(checked) ? "uncheck" : "check", "target", "@" + ref));
            } else if ("textbox".equals(role) || "searchbox".equals(role) || "textarea".equals(tag) || "input".equals(tag)) {
                suggestions.add(Map.of("action", "act", "op", "fill", "target", "@" + ref, "text", ""));
            } else if ("combobox".equals(role) || "select".equals(tag)) {
                suggestions.add(Map.of("action", "act", "op", "select", "target", "@" + ref, "value", ""));
            } else {
                suggestions.add(Map.of("action", "act", "op", "click", "target", "@" + ref));
            }
            if (suggestions.size() >= 20) {
                break;
            }
        }
        return suggestions;
    }

    private static Map<String, Object> requestMap(Request request) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("url", request.url());
        item.put("method", request.method());
        item.put("resourceType", request.resourceType());
        item.put("navigation", request.isNavigationRequest());
        item.put("failure", request.failure());
        return item;
    }

    private static Map<String, Object> apiResponseMap(APIResponse response, int maxBodyLength) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("url", response.url());
        item.put("status", response.status());
        item.put("statusText", response.statusText());
        item.put("ok", response.ok());
        item.put("headers", response.headers());
        String text = response.text();
        item.put("body", text == null ? null : text.substring(0, Math.min(Math.max(maxBodyLength, 0), text.length())));
        return item;
    }

    private static Map<String, Object> cookieMap(Cookie cookie) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("name", cookie.name);
        item.put("value", cookie.value);
        item.put("domain", cookie.domain);
        item.put("path", cookie.path);
        item.put("url", cookie.url);
        item.put("expires", cookie.expires);
        item.put("httpOnly", cookie.httpOnly);
        item.put("secure", cookie.secure);
        item.put("sameSite", cookie.sameSite == null ? null : cookie.sameSite.name().toLowerCase());
        return item;
    }

    private static Cookie cookie(Map<String, Object> value) {
        Cookie cookie = new Cookie(Args.requiredString(value, "name"), Args.requiredString(value, "value"));
        String url = Args.optionalString(value, "url", null);
        if (!Args.isBlank(url)) cookie.setUrl(url);
        String domain = Args.optionalString(value, "domain", null);
        if (!Args.isBlank(domain)) cookie.setDomain(domain);
        String path = Args.optionalString(value, "path", null);
        if (!Args.isBlank(path)) cookie.setPath(path);
        Double expires = Args.optionalDouble(value, "expires");
        if (expires != null) cookie.setExpires(expires);
        if (value.containsKey("httpOnly")) cookie.setHttpOnly(Args.optionalBoolean(value, "httpOnly", false));
        if (value.containsKey("secure")) cookie.setSecure(Args.optionalBoolean(value, "secure", false));
        String sameSite = Args.optionalString(value, "sameSite", null);
        if (!Args.isBlank(sameSite)) cookie.setSameSite(BrowserEnums.sameSite(sameSite));
        String partitionKey = Args.optionalString(value, "partitionKey", null);
        if (!Args.isBlank(partitionKey)) cookie.setPartitionKey(partitionKey);
        return cookie;
    }

    private static Map<String, String> stringMap(Map<String, Object> values) {
        Map<String, String> result = new LinkedHashMap<>();
        values.forEach((key, value) -> result.put(key, value == null ? "" : String.valueOf(value)));
        return result;
    }

    private static void applyRequestOptions(RequestOptions options, Map<String, Object> args) {
        Map<String, Object> headers = Args.optionalMap(args, "headers");
        headers.forEach((key, value) -> options.setHeader(key, value == null ? "" : String.valueOf(value)));
        Map<String, Object> query = Args.optionalMap(args, "query");
        query.forEach((key, value) -> options.setQueryParam(key, value == null ? "" : String.valueOf(value)));
        if (Args.has(args, "data")) {
            options.setData(args.get("data"));
        }
        if (Args.has(args, "timeoutMs")) {
            options.setTimeout(Args.optionalInt(args, "timeoutMs", 30000));
        }
        if (Args.has(args, "failOnStatusCode")) {
            options.setFailOnStatusCode(Args.optionalBoolean(args, "failOnStatusCode", false));
        }
    }

    private static void handleRoute(Route route, Map<String, Object> args, String action) {
        switch (action) {
            case "abort" -> route.abort(Args.optionalString(args, "errorCode", "failed"));
            case "continue", "resume" -> {
                Route.ResumeOptions options = new Route.ResumeOptions();
                Map<String, Object> headers = Args.optionalMap(args, "headers");
                if (!headers.isEmpty()) options.setHeaders(stringMap(headers));
                String method = Args.optionalString(args, "method", null);
                if (!Args.isBlank(method)) options.setMethod(method);
                String url = Args.optionalString(args, "replacementUrl", null);
                if (!Args.isBlank(url)) options.setUrl(url);
                if (Args.has(args, "postData")) options.setPostData(String.valueOf(args.get("postData")));
                route.resume(options);
            }
            case "fulfill" -> {
                Route.FulfillOptions options = new Route.FulfillOptions();
                options.setStatus(Args.optionalInt(args, "status", 200));
                String body = Args.optionalString(args, "body", "");
                options.setBody(body);
                String contentType = Args.optionalString(args, "contentType", null);
                if (!Args.isBlank(contentType)) options.setContentType(contentType);
                Map<String, Object> headers = Args.optionalMap(args, "headers");
                if (!headers.isEmpty()) options.setHeaders(stringMap(headers));
                route.fulfill(options);
            }
            default -> throw new IllegalArgumentException("Unsupported routeAction: " + action);
        }
    }

    private static Map<String, Object> responseMap(Response response) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("url", response.url());
        item.put("status", response.status());
        item.put("statusText", response.statusText());
        item.put("ok", response.ok());
        return item;
    }

    private static Map<String, Object> consoleMap(ConsoleMessage message) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("messageType", message.type());
        item.put("text", message.text());
        item.put("location", message.location());
        return item;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((key, item) -> result.put(String.valueOf(key), item));
            return result;
        }
        return Map.of();
    }

    private static List<Map<String, Object>> castMapList(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object item : list) {
            result.add(castMap(item));
        }
        return result;
    }
}
