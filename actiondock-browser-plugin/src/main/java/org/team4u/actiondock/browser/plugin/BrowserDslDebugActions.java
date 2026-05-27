package org.team4u.actiondock.browser.plugin;

import java.util.Map;

final class BrowserDslDebugActions {
    private final BrowserGatewayService service;
    private final BrowserDslTabs tabs;

    BrowserDslDebugActions(BrowserGatewayService service, BrowserDslTabs tabs) {
        this.service = service;
        this.tabs = tabs;
    }

    Map<String, Object> consoleList(BrowserDslContext dsl) throws Exception {
        return debug(dsl, "consoleList", service.consoleList(dsl.context(), dsl.callArgs()));
    }

    Map<String, Object> errorList(BrowserDslContext dsl) throws Exception {
        return debug(dsl, "errorList", service.errorList(dsl.context(), dsl.callArgs()));
    }

    Map<String, Object> requestList(BrowserDslContext dsl) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        BrowserDslSupport.copyIfPresent(dsl.args(), call, "text", "method", "status", "resourceType", "sinceId", "clear");
        return debug(dsl, "requestList", service.requestList(dsl.context(), call));
    }

    Map<String, Object> requestGet(BrowserDslContext dsl) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        call.put("requestId", Args.requiredString(dsl.args(), "requestId"));
        return debug(dsl, "requestGet", service.requestGet(dsl.context(), call));
    }

    Map<String, Object> traceStart(BrowserDslContext dsl) throws Exception {
        return debug(dsl, "traceStart", service.traceStart(dsl.context(), dsl.callArgs()));
    }

    Map<String, Object> traceStop(BrowserDslContext dsl) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        BrowserDslSupport.copyIfPresent(dsl.args(), call, "name", "path");
        return debug(dsl, "traceStop", service.traceStop(dsl.context(), call));
    }

    Map<String, Object> harStart(BrowserDslContext dsl) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        BrowserDslSupport.copyIfPresent(dsl.args(), call, "name", "path");
        return debug(dsl, "harStart", service.harStart(dsl.context(), call));
    }

    Map<String, Object> harStop(BrowserDslContext dsl) throws Exception {
        return debug(dsl, "harStop", service.harStop(dsl.context(), dsl.callArgs()));
    }

    Map<String, Object> snapshotDiff(BrowserDslContext dsl) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        BrowserDslSupport.copyIfPresent(dsl.args(), call, "limit", "maxTextLength", "interactiveOnly", "compact", "depth", "includeUrls", "baselineSnapshotId", "baselinePath");
        if (Args.has(dsl.args(), "scopeTarget")) {
            BrowserDslTargets targets = new BrowserDslTargets();
            call.put("scopeTarget", targets.fromTarget(Map.of("target", Args.requiredString(dsl.args(), "scopeTarget"))));
        }
        return debug(dsl, "snapshotDiff", service.snapshotDiff(dsl.context(), call));
    }

    Map<String, Object> screenshotDiff(BrowserDslContext dsl) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        BrowserDslSupport.copyIfPresent(dsl.args(), call, "baselinePath", "path", "threshold");
        return debug(dsl, "screenshotDiff", service.screenshotDiff(dsl.context(), call));
    }

    private Map<String, Object> debug(BrowserDslContext dsl, String action, Map<String, Object> result) {
        result.put("session", dsl.session());
        result.remove("op");
        result.put("action", action);
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }
}
