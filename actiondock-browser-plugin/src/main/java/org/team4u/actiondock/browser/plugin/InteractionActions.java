package org.team4u.actiondock.browser.plugin;

final class InteractionActions implements BrowserActionRegistrar {
    private final BrowserPrimitiveService service;

    InteractionActions(BrowserPrimitiveService service) {
        this.service = service;
    }

    @Override
    public void registerTo(BrowserActionRegistry registry) {
        registry.register("click", service::click)
                .register("fill", service::fill)
                .register("press", service::press);
    }
}
