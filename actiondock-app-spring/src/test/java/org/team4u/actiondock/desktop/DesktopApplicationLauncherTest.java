package org.team4u.actiondock.desktop;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.ConfigurableApplicationContext;

import java.net.URI;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class DesktopApplicationLauncherTest {
    @TempDir
    Path runtimeDir;

    @Test
    void guiLaunchReusesExistingServerWithoutStartingSpring() {
        List<URI> openedUris = Collections.synchronizedList(new ArrayList<>());
        List<URI> controlUris = Collections.synchronizedList(new ArrayList<>());
        DesktopApplicationLauncher launcher = new TestLauncher(
                new ExistingServerProbe(),
                openedUris::add,
                (adminUri, openAction, quitAction) -> {
                    controlUris.add(adminUri);
                    return DesktopControl.NOOP;
                },
                runtimeDir
        );

        launcher.launch(new String[]{"--server.port=6188"});

        assertThat(openedUris).containsExactly(URI.create("http://127.0.0.1:6188/admin/app/scripts"));
        assertThat(controlUris).containsExactly(URI.create("http://127.0.0.1:6188/admin/app/scripts"));
    }

    @Test
    void secondDesktopLaunchOnlyOpensBrowser() throws Exception {
        List<URI> openedUris = Collections.synchronizedList(new ArrayList<>());
        List<URI> controlUris = Collections.synchronizedList(new ArrayList<>());
        CountDownLatch controlShown = new CountDownLatch(1);
        CountDownLatch releaseFirstLaunch = new CountDownLatch(1);
        DesktopApplicationLauncher first = new TestLauncher(
                new ExistingServerProbe(),
                openedUris::add,
                (adminUri, openAction, quitAction) -> {
                    controlUris.add(adminUri);
                    controlShown.countDown();
                    return () -> {
                        try {
                            releaseFirstLaunch.await(2, TimeUnit.SECONDS);
                        } catch (InterruptedException ex) {
                            Thread.currentThread().interrupt();
                        }
                    };
                },
                runtimeDir
        );
        DesktopApplicationLauncher second = new TestLauncher(
                new ExistingServerProbe(),
                openedUris::add,
                (adminUri, openAction, quitAction) -> {
                    controlUris.add(adminUri);
                    return DesktopControl.NOOP;
                },
                runtimeDir
        );

        Thread firstLaunch = new Thread(() -> first.launch(new String[]{"--server.port=6189"}));
        firstLaunch.start();
        assertThat(controlShown.await(2, TimeUnit.SECONDS)).isTrue();

        second.launch(new String[]{"--server.port=6189"});
        releaseFirstLaunch.countDown();
        firstLaunch.join(2_000);

        assertThat(openedUris).containsExactly(
                URI.create("http://127.0.0.1:6189/admin/app/scripts"),
                URI.create("http://127.0.0.1:6189/admin/app/scripts")
        );
        assertThat(controlUris).containsExactly(URI.create("http://127.0.0.1:6189/admin/app/scripts"));
    }

    private static class TestLauncher extends DesktopApplicationLauncher {
        private final Path runtimeDir;

        TestLauncher(
                LocalServerProbe serverProbe,
                BrowserLauncher browserLauncher,
                DesktopControls desktopControls,
                Path runtimeDir
        ) {
            super(DesktopApplicationLauncherTest.class, serverProbe, browserLauncher, desktopControls);
            this.runtimeDir = runtimeDir;
        }

        @Override
        ConfigurableApplicationContext startSpringApplication(String[] args) {
            throw new AssertionError("Spring should not start when an existing server is available");
        }

        @Override
        DesktopInstanceLock acquireDesktopInstanceLock(int port) throws java.io.IOException {
            return DesktopInstanceLock.tryAcquire(port, runtimeDir);
        }
    }

    private static class ExistingServerProbe extends LocalServerProbe {
        @Override
        public boolean isActionDockRunning(URI adminRootUri) {
            return true;
        }
    }
}
