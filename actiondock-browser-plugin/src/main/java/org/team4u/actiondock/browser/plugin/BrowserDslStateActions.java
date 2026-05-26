package org.team4u.actiondock.browser.plugin;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class BrowserDslStateActions {
    private final BrowserGatewayService service;
    private final BrowserDslTabs tabs;

    BrowserDslStateActions(BrowserGatewayService service, BrowserDslTabs tabs) {
        this.service = service;
        this.tabs = tabs;
    }

    Map<String, Object> cookiesList(BrowserDslContext dsl) throws Exception {
        return cookies(dsl, "list");
    }

    Map<String, Object> cookiesSet(BrowserDslContext dsl) throws Exception {
        return cookies(dsl, "set");
    }

    Map<String, Object> cookiesClear(BrowserDslContext dsl) throws Exception {
        return cookies(dsl, "clear");
    }

    private Map<String, Object> cookies(BrowserDslContext dsl, String op) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        Map<String, Object> result = switch (op) {
            case "list", "get" -> {
                String urls = Args.optionalString(dsl.args(), "url", null);
                if (!Args.isBlank(urls)) {
                    call.put("urls", BrowserDslSupport.csv(urls));
                }
                yield service.cookiesGet(dsl.context(), call);
            }
            case "set" -> {
                List<Map<String, Object>> cookies = BrowserDslJson.objectList(dsl.args(), "cookiesJson");
                if (cookies.isEmpty()) {
                    Map<String, Object> cookie = new LinkedHashMap<>();
                    BrowserDslSupport.copyIfPresent(dsl.args(), cookie, "name", "value", "url", "domain", "path",
                            "expires", "httpOnly", "secure", "sameSite", "partitionKey");
                    cookies = List.of(cookie);
                }
                call.put("cookies", cookies);
                yield service.cookiesSet(dsl.context(), call);
            }
            case "clear" -> service.cookiesClear(dsl.context(), call);
            default -> throw new IllegalArgumentException("Unsupported cookies op: " + op);
        };
        result.put("session", dsl.session());
        result.remove("op");
        result.put("action", "cookies" + Character.toUpperCase(op.charAt(0)) + op.substring(1));
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    Map<String, Object> storageState(BrowserDslContext dsl) throws Exception {
        return storage(dsl, "state");
    }

    Map<String, Object> storageGet(BrowserDslContext dsl) throws Exception {
        String area = Args.optionalString(dsl.args(), "area", "local");
        return storage(dsl, area);
    }

    Map<String, Object> storageSet(BrowserDslContext dsl) throws Exception {
        String area = Args.optionalString(dsl.args(), "area", "local");
        return storage(dsl, area);
    }

    Map<String, Object> storageClear(BrowserDslContext dsl) throws Exception {
        String area = Args.optionalString(dsl.args(), "area", "local");
        return storage(dsl, "session".equals(area) ? "clearSession" : "clearLocal");
    }

    private Map<String, Object> storage(BrowserDslContext dsl, String op) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        Map<String, Object> result = switch (op) {
            case "state", "save" -> {
                BrowserDslSupport.copyIfPresent(dsl.args(), call, "stateName", "path", "storageStatePath", "indexedDB");
                yield service.storageState(dsl.context(), call);
            }
            case "local", "session" -> {
                String storage = op;
                String key = Args.optionalString(dsl.args(), "key", null);
                String expression;
                if (Args.has(dsl.args(), "value")) {
                    expression = "({ storage, key, value }) => { window[storage].setItem(key, value); return true; }";
                    call.put("arg", Map.of("storage", storage + "Storage", "key", Args.requiredString(dsl.args(), "key"), "value", String.valueOf(dsl.args().get("value"))));
                } else if (!Args.isBlank(key)) {
                    expression = "({ storage, key }) => window[storage].getItem(key)";
                    call.put("arg", Map.of("storage", storage + "Storage", "key", key));
                } else {
                    expression = "({ storage }) => Object.fromEntries(Object.entries(window[storage]))";
                    call.put("arg", Map.of("storage", storage + "Storage"));
                }
                call.put("scope", "page");
                call.put("expression", expression);
                yield service.evaluate(dsl.context(), call);
            }
            case "clearLocal", "clearSession" -> {
                String storage = op.equals("clearLocal") ? "localStorage" : "sessionStorage";
                call.put("scope", "page");
                call.put("expression", "storage => { window[storage].clear(); return true; }");
                call.put("arg", storage);
                yield service.evaluate(dsl.context(), call);
            }
            default -> throw new IllegalArgumentException("Unsupported storage op: " + op);
        };
        result.put("session", dsl.session());
        result.put("action", storageActionName(op, dsl.args()));
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }

    private static String storageActionName(String op, Map<String, Object> args) {
        return switch (op) {
            case "state", "save" -> "storageState";
            case "local", "session" -> Args.has(args, "value") ? "storageSet" : "storageGet";
            case "clearLocal", "clearSession" -> "storageClear";
            default -> op;
        };
    }
}
