package org.team4u.actiondock.browser.plugin;

final class BrowserActionBlockedException extends IllegalStateException {
    private final String action;
    private final String category;

    BrowserActionBlockedException(String action, String category, String message) {
        super(message);
        this.action = action;
        this.category = category;
    }

    String action() {
        return action;
    }

    String category() {
        return category;
    }
}
