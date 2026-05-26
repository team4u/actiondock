package org.team4u.actiondock.browser.plugin;

final class SessionActions implements BrowserActionRegistrar {
    private final BrowserPrimitiveService service;

    SessionActions(BrowserPrimitiveService service) {
        this.service = service;
    }

    @Override
    public void registerTo(BrowserActionRegistry registry) {
        registry.register("sessionCreate", service::createSession)
                .register("sessionClose", service::closeSession)
                .register("sessionInfo", service::sessionInfo)
                .register("sessionList", (context, args) -> service.sessionList(context));
    }
}
