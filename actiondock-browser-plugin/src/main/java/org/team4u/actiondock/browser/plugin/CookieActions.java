package org.team4u.actiondock.browser.plugin;

final class CookieActions implements BrowserActionRegistrar {
    private final BrowserPrimitiveService service;

    CookieActions(BrowserPrimitiveService service) {
        this.service = service;
    }

    @Override
    public void registerTo(BrowserActionRegistry registry) {
        registry.register("getCookies", service::getCookies)
                .register("setCookies", service::setCookies)
                .register("clearCookies", service::clearCookies);
    }
}
