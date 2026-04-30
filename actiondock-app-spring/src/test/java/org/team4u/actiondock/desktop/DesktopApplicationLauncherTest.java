package org.team4u.actiondock.desktop;

import org.junit.jupiter.api.Test;
import org.springframework.context.ConfigurableApplicationContext;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class DesktopApplicationLauncherTest {
    @Test
    void guiLaunchReusesExistingServerWithoutStartingSpring() {
        List<URI> openedUris = new ArrayList<>();
        List<URI> controlUris = new ArrayList<>();
        DesktopApplicationLauncher launcher = new TestLauncher(
                new ExistingServerProbe(),
                openedUris::add,
                (adminUri, openAction, quitAction) -> {
                    controlUris.add(adminUri);
                    return DesktopControl.NOOP;
                }
        );

        launcher.launch(new String[]{"--server.port=6188"});

        assertThat(openedUris).containsExactly(URI.create("http://127.0.0.1:6188/admin/app/scripts"));
        assertThat(controlUris).containsExactly(URI.create("http://127.0.0.1:6188/admin/app/scripts"));
    }

    private static class TestLauncher extends DesktopApplicationLauncher {
        TestLauncher(
                LocalServerProbe serverProbe,
                BrowserLauncher browserLauncher,
                DesktopControls desktopControls
        ) {
            super(DesktopApplicationLauncherTest.class, serverProbe, browserLauncher, desktopControls);
        }

        @Override
        ConfigurableApplicationContext startSpringApplication(String[] args) {
            throw new AssertionError("Spring should not start when an existing server is available");
        }
    }

    private static class ExistingServerProbe extends LocalServerProbe {
        @Override
        public boolean isActionDockRunning(URI adminRootUri) {
            return true;
        }
    }
}
