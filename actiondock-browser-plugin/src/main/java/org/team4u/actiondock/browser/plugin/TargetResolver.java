package org.team4u.actiondock.browser.plugin;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

final class TargetResolver {
    Locator locator(BrowserSession session, Page page, String pageId, Map<String, Object> target) {
        if (target == null || target.isEmpty()) {
            throw new IllegalArgumentException("target is required for this operation");
        }
        String explicitSelector = Args.optionalString(target, "selector", null);
        if (!Args.isBlank(explicitSelector)) {
            return indexed(page.locator(explicitSelector), target);
        }
        if (!Args.isBlank(Args.optionalString(target, "ref", null))) {
            Map<String, Object> resolvedTarget = resolveTarget(session, pageId, target);
            return indexed(refLocator(page, resolvedTarget), resolvedTarget);
        }
        return indexed(baseLocator(page, target), target);
    }

    private Map<String, Object> resolveTarget(BrowserSession session, String pageId, Map<String, Object> target) {
        String ref = Args.optionalString(target, "ref", null);
        if (Args.isBlank(ref)) {
            return target;
        }

        Map<String, Object> resolvedTarget = new LinkedHashMap<>(session.ref(pageId, ref, Args.optionalString(target, "snapshotId", null)));
        resolvedTarget.remove("ref");
        resolvedTarget.remove("snapshotId");
        target.forEach((key, value) -> {
            if (!"ref".equals(key)) {
                resolvedTarget.put(key, value);
            }
        });
        return resolvedTarget;
    }

    private Locator baseLocator(Page page, Map<String, Object> target) {
        String selector = Args.optionalString(target, "selector", null);
        if (!Args.isBlank(selector)) {
            return page.locator(selector);
        }
        String testId = Args.optionalString(target, "testId", null);
        if (!Args.isBlank(testId)) {
            return page.getByTestId(testId);
        }
        String label = Args.optionalString(target, "label", null);
        if (!Args.isBlank(label)) {
            return page.getByLabel(label, new Page.GetByLabelOptions().setExact(Args.optionalBoolean(target, "exact", false)));
        }
        String placeholder = Args.optionalString(target, "placeholder", null);
        if (!Args.isBlank(placeholder)) {
            return page.getByPlaceholder(placeholder, new Page.GetByPlaceholderOptions().setExact(Args.optionalBoolean(target, "exact", false)));
        }
        String role = Args.optionalString(target, "role", null);
        if (!Args.isBlank(role)) {
            Page.GetByRoleOptions options = new Page.GetByRoleOptions();
            String name = Args.optionalString(
                    target,
                    "name",
                    Args.optionalString(
                            target,
                            "label",
                            Args.optionalString(target, "placeholder", Args.optionalString(target, "text", null))
                    )
            );
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
        String alt = Args.optionalString(target, "alt", Args.optionalString(target, "altText", null));
        if (!Args.isBlank(alt)) {
            return page.getByAltText(alt, new Page.GetByAltTextOptions().setExact(Args.optionalBoolean(target, "exact", false)));
        }
        String title = Args.optionalString(target, "title", null);
        if (!Args.isBlank(title)) {
            return page.getByTitle(title, new Page.GetByTitleOptions().setExact(Args.optionalBoolean(target, "exact", false)));
        }
        throw new IllegalArgumentException("target must include ref, selector, role, text, label, placeholder, altText, title, or testId");
    }

    private Locator refLocator(Page page, Map<String, Object> target) {
        String selector = Args.optionalString(target, "selector", null);
        Locator locator = usableOrNull(Args.isBlank(selector) ? null : page.locator(selector));
        if (locator != null) return locator;

        String testId = Args.optionalString(target, "testId", null);
        locator = usableOrNull(Args.isBlank(testId) ? null : page.getByTestId(testId));
        if (locator != null) return locator;

        String label = Args.optionalString(target, "label", null);
        locator = usableOrNull(Args.isBlank(label) ? null : page.getByLabel(label, new Page.GetByLabelOptions().setExact(Args.optionalBoolean(target, "exact", false))));
        if (locator != null) return locator;

        String placeholder = Args.optionalString(target, "placeholder", null);
        locator = usableOrNull(Args.isBlank(placeholder) ? null : page.getByPlaceholder(placeholder, new Page.GetByPlaceholderOptions().setExact(Args.optionalBoolean(target, "exact", false))));
        if (locator != null) return locator;

        String title = Args.optionalString(target, "title", null);
        locator = usableOrNull(Args.isBlank(title) ? null : page.getByTitle(title, new Page.GetByTitleOptions().setExact(Args.optionalBoolean(target, "exact", false))));
        if (locator != null) return locator;

        String role = Args.optionalString(target, "role", null);
        String name = Args.optionalString(target, "name", null);
        if (!Args.isBlank(role) && !Args.isBlank(name)) {
            Page.GetByRoleOptions options = new Page.GetByRoleOptions().setName(name);
            if (target.containsKey("exact")) {
                options.setExact(Args.optionalBoolean(target, "exact", false));
            }
            locator = usableOrNull(page.getByRole(role(role), options));
            if (locator != null) return locator;
        }

        String text = Args.optionalString(target, "text", null);
        locator = usableOrNull(Args.isBlank(text) ? null : page.getByText(text, new Page.GetByTextOptions().setExact(Args.optionalBoolean(target, "exact", false))));
        if (locator != null) return locator;

        return baseLocator(page, target);
    }

    private static Locator usableOrNull(Locator locator) {
        if (locator == null) {
            return null;
        }
        try {
            return locator.count() > 0 ? locator : null;
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private static Locator indexed(Locator locator, Map<String, Object> target) {
        int index = Args.optionalInt(target, "index", 0);
        return index > 0 ? locator.nth(index) : locator;
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
