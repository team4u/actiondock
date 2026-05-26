package org.team4u.actiondock.browser.plugin;

final class WaitActions implements BrowserActionRegistrar {
    private final BrowserPrimitiveService service;

    WaitActions(BrowserPrimitiveService service) {
        this.service = service;
    }

    @Override
    public void registerTo(BrowserActionRegistry registry) {
        registry.register("waitForLoadState", service::waitForLoadState)
                .register("waitForSelector", service::waitForSelector);
    }
}
