package org.team4u.actiondock.browser.plugin;

import java.util.Map;

final class BrowserDslEvalActions {
    private final BrowserGatewayService service;
    private final BrowserDslTargets targets;
    private final BrowserDslTabs tabs;

    BrowserDslEvalActions(BrowserGatewayService service, BrowserDslTargets targets, BrowserDslTabs tabs) {
        this.service = service;
        this.targets = targets;
        this.tabs = tabs;
    }

    Map<String, Object> eval(BrowserDslContext dsl) throws Exception {
        Map<String, Object> call = dsl.callArgs();
        call.put("scope", Args.optionalString(dsl.args(), "scope", Args.has(dsl.args(), "target") ? "locator" : "page"));
        if (Args.has(dsl.args(), "target")) {
            call.put("target", targets.requireTarget(dsl.args()));
        }
        call.put("expression", Args.requiredString(dsl.args(), "expression"));
        Object arg = BrowserDslJson.value(dsl.args(), "argJson");
        if (arg != null) {
            call.put("arg", arg);
        }
        Map<String, Object> result = service.evaluate(dsl.context(), call);
        result.put("session", dsl.session());
        return tabs.transformResult(dsl.context(), dsl.session(), result);
    }
}
