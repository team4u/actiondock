package org.team4u.actiondock.browser.plugin;

final class ReadActions implements BrowserActionRegistrar {
    private final BrowserPrimitiveService service;

    ReadActions(BrowserPrimitiveService service) {
        this.service = service;
    }

    @Override
    public void registerTo(BrowserActionRegistry registry) {
        registry.register("textContent", service::textContent)
                .register("innerText", service::innerText)
                .register("getAttribute", service::getAttribute)
                .register("isVisible", service::isVisible)
                .register("locatorCount", service::locatorCount);
    }
}
