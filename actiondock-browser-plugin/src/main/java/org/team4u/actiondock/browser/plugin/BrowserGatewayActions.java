package org.team4u.actiondock.browser.plugin;

final class BrowserGatewayActions implements BrowserActionRegistrar {
    private final BrowserGatewayService service;

    BrowserGatewayActions(BrowserGatewayService service) {
        this.service = service;
    }

    @Override
    public void registerTo(BrowserActionRegistry registry) {
        registry.register("sessionCreate", service::createSession)
                .register("sessionClose", service::closeSession)
                .register("sessionInfo", service::sessionInfo)
                .register("sessionList", (context, args) -> service.sessionList(context))
                .register("observe", service::observe)
                .register("act", service::act)
                .register("evaluate", service::evaluate)
                .register("wait", service::waitFor)
                .register("pages", service::pages)
                .register("events", service::events);
    }
}
