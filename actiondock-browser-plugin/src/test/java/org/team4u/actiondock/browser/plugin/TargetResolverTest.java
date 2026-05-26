package org.team4u.actiondock.browser.plugin;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TargetResolverTest {
    @Test
    void resolvesRefWithoutRecursingOnStoredSnapshotRef() {
        Playwright playwright = mock(Playwright.class);
        Browser browser = mock(Browser.class);
        BrowserContext context = mock(BrowserContext.class);
        Page page = mock(Page.class);
        Locator locator = mock(Locator.class);

        when(page.isClosed()).thenReturn(false);
        when(page.url()).thenReturn("https://example.test");
        when(page.getByRole(org.mockito.Mockito.eq(com.microsoft.playwright.options.AriaRole.TEXTBOX), any(Page.GetByRoleOptions.class))).thenReturn(locator);

        BrowserSession session = new BrowserSession(
                "br_test",
                "owner",
                "chromium",
                playwright,
                browser,
                context,
                page,
                30000
        );
        session.replaceRefs("p1", List.of(Map.of(
                "ref", "e3",
                "selector", "input[name='email']",
                "role", "textbox",
                "name", "Email"
        )));

        Locator resolved = new TargetResolver().locator(session, page, "p1", Map.of("ref", "e3"));

        assertThat(resolved).isSameAs(locator);
    }

    @Test
    void prefersSemanticLocatorForObservedRef() {
        Playwright playwright = mock(Playwright.class);
        Browser browser = mock(Browser.class);
        BrowserContext context = mock(BrowserContext.class);
        Page page = mock(Page.class);
        Locator locator = mock(Locator.class);

        when(page.isClosed()).thenReturn(false);
        when(page.url()).thenReturn("https://example.test");
        when(page.getByLabel(org.mockito.Mockito.eq("Email"), any(Page.GetByLabelOptions.class))).thenReturn(locator);

        BrowserSession session = new BrowserSession(
                "br_test",
                "owner",
                "chromium",
                playwright,
                browser,
                context,
                page,
                30000
        );
        session.replaceRefs("p1", List.of(Map.of(
                "ref", "e3",
                "selector", "input[name='email']",
                "label", "Email",
                "role", "textbox",
                "name", "Email"
        )));

        Locator resolved = new TargetResolver().locator(session, page, "p1", Map.of("ref", "e3"));

        assertThat(resolved).isSameAs(locator);
        verify(page, never()).locator("input[name='email']");
    }

    @Test
    void explicitSelectorOverridesStoredSemanticLocator() {
        Page page = mock(Page.class);
        Locator explicitLocator = mock(Locator.class);

        when(page.locator("form input[name='email']")).thenReturn(explicitLocator);

        Locator resolved = new TargetResolver().locator(null, page, "p1", Map.of(
                "ref", "e3",
                "selector", "form input[name='email']",
                "label", "Email"
        ));

        assertThat(resolved).isSameAs(explicitLocator);
        verify(page, never()).getByLabel(org.mockito.Mockito.eq("Email"), any(Page.GetByLabelOptions.class));
    }

    @Test
    void appliesIndexAfterLocatorResolution() {
        Playwright playwright = mock(Playwright.class);
        Browser browser = mock(Browser.class);
        BrowserContext context = mock(BrowserContext.class);
        Page page = mock(Page.class);
        Locator locator = mock(Locator.class);
        Locator indexed = mock(Locator.class);

        when(page.isClosed()).thenReturn(false);
        when(page.url()).thenReturn("https://example.test");
        when(page.getByTestId("email-input")).thenReturn(locator);
        when(locator.nth(2)).thenReturn(indexed);

        BrowserSession session = new BrowserSession(
                "br_test",
                "owner",
                "chromium",
                playwright,
                browser,
                context,
                page,
                30000
        );
        session.replaceRefs("p1", List.of(Map.of(
                "ref", "e3",
                "testId", "email-input"
        )));

        Locator resolved = new TargetResolver().locator(session, page, "p1", Map.of("ref", "e3", "index", 2));

        assertThat(resolved).isSameAs(indexed);
        InOrder inOrder = org.mockito.Mockito.inOrder(page, locator);
        inOrder.verify(page).getByTestId("email-input");
        inOrder.verify(locator).nth(2);
    }
}
