package org.team4u.actiondock.browser.plugin;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BrowserDslSessionStateTest {
    @Test
    void requiresExplicitSessionName() {
        BrowserDslSessions sessions = new BrowserDslSessions(mock(BrowserGatewayService.class));

        assertThatThrownBy(() -> sessions.sessionName(Map.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("session is required");
    }

    @Test
    void generatesPublicSessionNameForOpenWhenOmitted() {
        BrowserDslSessions sessions = new BrowserDslSessions(mock(BrowserGatewayService.class));

        String generated = sessions.sessionNameForOpen(new ScriptPluginContext(), Map.of());

        assertThat(generated).startsWith("s_").hasSize(12);
    }

    @Test
    void usesExplicitSessionNameForOpenWhenProvided() {
        BrowserDslSessions sessions = new BrowserDslSessions(mock(BrowserGatewayService.class));

        assertThat(sessions.sessionNameForOpen(new ScriptPluginContext(), Map.of("session", " admin ")))
                .isEqualTo("admin");
    }

    @Test
    void resolvesNamedSessionAcrossDslInstances() throws Exception {
        ScriptPluginContext context = new ScriptPluginContext();
        BrowserGatewayService service = mock(BrowserGatewayService.class);
        when(service.sessionInfo(context, Map.of("sessionId", "br_shared")))
                .thenReturn(Map.of("ok", true, "sessionId", "br_shared"));

        BrowserDslSessions writer = new BrowserDslSessions(service);
        BrowserDslSessions reader = new BrowserDslSessions(service);

        writer.remember(context, "run-shared", "br_shared");

        assertThat(reader.resolveRequired(context, Map.of("session", "run-shared"))).isEqualTo("br_shared");
    }

    @Test
    void resolvesTabAliasesAcrossDslInstances() {
        ScriptPluginContext context = new ScriptPluginContext();
        BrowserDslTabs writer = new BrowserDslTabs();
        BrowserDslTabs reader = new BrowserDslTabs();

        String publicTab = writer.publicTab(context, "run-tabs", "page-1");
        writer.label(context, "run-tabs", "docs", "page-1");

        assertThat(reader.pageId(context, "run-tabs", Map.of("tab", publicTab))).isEqualTo("page-1");
        assertThat(reader.pageId(context, "run-tabs", Map.of("tab", "docs"))).isEqualTo("page-1");
    }

    @Test
    void forgetsTabAliasesForClosedSession() {
        ScriptPluginContext context = new ScriptPluginContext();
        BrowserDslTabs tabs = new BrowserDslTabs();

        String publicTab = tabs.publicTab(context, "run-close", "page-1");
        tabs.label(context, "run-close", "docs", "page-1");
        tabs.forgetSession(context, "run-close");

        assertThatThrownBy(() -> tabs.pageId(context, "run-close", Map.of("tab", publicTab)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Browser tab not found");
        assertThatThrownBy(() -> tabs.pageId(context, "run-close", Map.of("tab", "docs")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Browser tab not found");
    }

    @Test
    void transformsPageListToPublicTabs() {
        ScriptPluginContext context = new ScriptPluginContext();
        BrowserDslTabs tabs = new BrowserDslTabs();

        Map<String, Object> transformed = tabs.transformResult(context, "run-list", new java.util.LinkedHashMap<>(Map.of(
                "ok", true,
                "activePageId", "p2",
                "pages", List.of(
                        Map.of("pageId", "p1", "active", false, "closed", false, "url", "https://one.test", "title", "One"),
                        Map.of("pageId", "p2", "active", true, "closed", false, "url", "https://two.test", "title", "Two")
                )
        )));

        assertThat(transformed)
                .containsEntry("activeTab", "t2")
                .doesNotContainKeys("activePageId", "pages");
        List<?> tabItems = (List<?>) transformed.get("tabs");
        assertThat(tabItems).hasSize(2);
        tabItems.forEach(item -> {
            Map<?, ?> tab = (Map<?, ?>) item;
            assertThat(tab.get("tab")).isNotNull();
            assertThat(tab.containsKey("pageId")).isFalse();
        });
    }

    @Test
    void reportsStaleSnapshotIdForStoredRef() {
        com.microsoft.playwright.Page page = mock(com.microsoft.playwright.Page.class);
        when(page.isClosed()).thenReturn(false);
        when(page.url()).thenReturn("https://example.test");
        BrowserSession session = new BrowserSession(
                "br_test",
                "owner",
                "chromium",
                mock(com.microsoft.playwright.Playwright.class),
                mock(com.microsoft.playwright.Browser.class),
                mock(com.microsoft.playwright.BrowserContext.class),
                page,
                30000
        );
        session.replaceRefs("p1", java.util.List.of(Map.of("ref", "e1", "selector", "#submit")), Map.of("visibleText", "before"));
        session.invalidateRefs("p1");
        session.replaceRefs("p1", java.util.List.of(Map.of("ref", "e1", "selector", "#submit2")), Map.of("visibleText", "after"));

        assertThatThrownBy(() -> session.ref("p1", "e1", "sn1"))
                .isInstanceOf(BrowserRefStaleException.class)
                .hasMessageContaining("stale");
    }
}
