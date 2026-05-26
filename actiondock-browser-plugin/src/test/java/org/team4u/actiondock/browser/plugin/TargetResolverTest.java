package org.team4u.actiondock.browser.plugin;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
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
        when(page.locator("input[name='email']")).thenReturn(locator);

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
}
