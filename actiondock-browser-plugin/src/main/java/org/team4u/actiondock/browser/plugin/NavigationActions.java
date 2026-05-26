package org.team4u.actiondock.browser.plugin;

final class NavigationActions implements BrowserActionRegistrar {
    private final BrowserPrimitiveService service;

    NavigationActions(BrowserPrimitiveService service) {
        this.service = service;
    }

    @Override
    public void registerTo(BrowserActionRegistry registry) {
        registry.register("goto", service::gotoPage);
    }
}
