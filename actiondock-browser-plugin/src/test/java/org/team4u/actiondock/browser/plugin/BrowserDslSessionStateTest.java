package org.team4u.actiondock.browser.plugin;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.plugin.api.ScriptPluginContext;

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
}
