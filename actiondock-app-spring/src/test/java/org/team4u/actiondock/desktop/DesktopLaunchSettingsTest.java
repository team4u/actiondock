package org.team4u.actiondock.desktop;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DesktopLaunchSettingsTest {
    @Test
    void usesDefaultLocalAddressAndPort() {
        DesktopLaunchSettings settings = DesktopLaunchSettings.from(new String[0]);

        assertThat(settings.host()).isEqualTo("127.0.0.1");
        assertThat(settings.port()).isEqualTo(5177);
        assertThat(settings.adminUri("/admin/app/scripts").toString())
                .isEqualTo("http://127.0.0.1:5177/admin/app/scripts");
        assertThat(settings.canProbeExistingServer()).isTrue();
    }

    @Test
    void mapsWildcardAddressToLoopbackForBrowserUrl() {
        DesktopLaunchSettings settings = DesktopLaunchSettings.from(new String[]{
                "--server.address=0.0.0.0",
                "--server.port=6188"
        });

        assertThat(settings.host()).isEqualTo("127.0.0.1");
        assertThat(settings.port()).isEqualTo(6188);
        assertThat(settings.adminRootUri().toString()).isEqualTo("http://127.0.0.1:6188/admin");
    }

    @Test
    void skipsExistingServerProbeForDynamicPort() {
        DesktopLaunchSettings settings = DesktopLaunchSettings.from(new String[]{"--server.port=0"});

        assertThat(settings.port()).isZero();
        assertThat(settings.canProbeExistingServer()).isFalse();
    }
}
