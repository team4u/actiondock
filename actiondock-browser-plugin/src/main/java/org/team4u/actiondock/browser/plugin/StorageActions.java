package org.team4u.actiondock.browser.plugin;

final class StorageActions implements BrowserActionRegistrar {
    private final BrowserPrimitiveService service;

    StorageActions(BrowserPrimitiveService service) {
        this.service = service;
    }

    @Override
    public void registerTo(BrowserActionRegistry registry) {
        registry.register("getLocalStorage", service::getLocalStorage)
                .register("setLocalStorage", service::setLocalStorage)
                .register("getSessionStorage", service::getSessionStorage)
                .register("clearStorage", service::clearStorage)
                .register("storageStateSave", service::storageStateSave);
    }
}
