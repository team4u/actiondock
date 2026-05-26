package org.team4u.actiondock.browser.plugin;

final class ArtifactActions implements BrowserActionRegistrar {
    private final BrowserPrimitiveService service;

    ArtifactActions(BrowserPrimitiveService service) {
        this.service = service;
    }

    @Override
    public void registerTo(BrowserActionRegistry registry) {
        registry.register("screenshot", service::screenshot);
    }
}
