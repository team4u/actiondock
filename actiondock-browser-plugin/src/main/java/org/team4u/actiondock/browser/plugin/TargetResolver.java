package org.team4u.actiondock.browser.plugin;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;

import java.util.Locale;
import java.util.Map;

final class TargetResolver {
    Locator locator(BrowserSession session, Page page, String pageId, Map<String, Object> target) {
        if (target == null || target.isEmpty()) {
            throw new IllegalArgumentException("target is required for this operation");
        }
        String ref = Args.optionalString(target, "ref", null);
        if (!Args.isBlank(ref)) {
            return locator(session, page, pageId, session.ref(pageId, ref));
        }

        Locator locator = baseLocator(page, target);
        int index = Args.optionalInt(target, "index", 0);
        return index > 0 ? locator.nth(index) : locator;
    }

    private Locator baseLocator(Page page, Map<String, Object> target) {
        String selector = Args.optionalString(target, "selector", null);
        if (!Args.isBlank(selector)) {
            return page.locator(selector);
        }
        String role = Args.optionalString(target, "role", null);
        if (!Args.isBlank(role)) {
            Page.GetByRoleOptions options = new Page.GetByRoleOptions();
            String name = Args.optionalString(target, "name", Args.optionalString(target, "text", null));
            if (!Args.isBlank(name)) {
                options.setName(name);
            }
            if (target.containsKey("exact")) {
                options.setExact(Args.optionalBoolean(target, "exact", false));
            }
            return page.getByRole(role(role), options);
        }
        String text = Args.optionalString(target, "text", null);
        if (!Args.isBlank(text)) {
            return page.getByText(text, new Page.GetByTextOptions().setExact(Args.optionalBoolean(target, "exact", false)));
        }
        String label = Args.optionalString(target, "label", null);
        if (!Args.isBlank(label)) {
            return page.getByLabel(label, new Page.GetByLabelOptions().setExact(Args.optionalBoolean(target, "exact", false)));
        }
        String placeholder = Args.optionalString(target, "placeholder", null);
        if (!Args.isBlank(placeholder)) {
            return page.getByPlaceholder(placeholder, new Page.GetByPlaceholderOptions().setExact(Args.optionalBoolean(target, "exact", false)));
        }
        String alt = Args.optionalString(target, "alt", Args.optionalString(target, "altText", null));
        if (!Args.isBlank(alt)) {
            return page.getByAltText(alt, new Page.GetByAltTextOptions().setExact(Args.optionalBoolean(target, "exact", false)));
        }
        String title = Args.optionalString(target, "title", null);
        if (!Args.isBlank(title)) {
            return page.getByTitle(title, new Page.GetByTitleOptions().setExact(Args.optionalBoolean(target, "exact", false)));
        }
        String testId = Args.optionalString(target, "testId", null);
        if (!Args.isBlank(testId)) {
            return page.getByTestId(testId);
        }
        throw new IllegalArgumentException("target must include ref, selector, role, text, label, placeholder, altText, title, or testId");
    }

    private static AriaRole role(String value) {
        String normalized = value.trim()
                .replace("-", "")
                .replace("_", "")
                .toUpperCase(Locale.ROOT);
        for (AriaRole role : AriaRole.values()) {
            if (role.name().replace("_", "").equals(normalized)) {
                return role;
            }
        }
        throw new IllegalArgumentException("Unsupported ARIA role: " + value);
    }
}
