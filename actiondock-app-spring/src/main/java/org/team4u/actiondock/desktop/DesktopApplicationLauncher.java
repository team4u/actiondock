package org.team4u.actiondock.desktop;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.web.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;

import java.io.IOException;
import java.net.URI;
import java.util.Objects;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Desktop launcher used by jDeploy GUI mode.
 */
public class DesktopApplicationLauncher {
    private static final Logger LOGGER = Logger.getLogger(DesktopApplicationLauncher.class.getName());
    private static final String GUI_MODE = "gui";
    private static final String ADMIN_PATH = "/admin/app/scripts";

    private final Class<?> applicationClass;
    private final LocalServerProbe serverProbe;
    private final BrowserLauncher browserLauncher;
    private final DesktopControls desktopControls;

    public DesktopApplicationLauncher(Class<?> applicationClass) {
        this(applicationClass, new LocalServerProbe(), new SystemBrowserLauncher(), null);
    }

    DesktopApplicationLauncher(
            Class<?> applicationClass,
            LocalServerProbe serverProbe,
            BrowserLauncher browserLauncher,
            DesktopControls desktopControls
    ) {
        this.applicationClass = Objects.requireNonNull(applicationClass, "applicationClass");
        this.serverProbe = Objects.requireNonNull(serverProbe, "serverProbe");
        this.browserLauncher = Objects.requireNonNull(browserLauncher, "browserLauncher");
        this.desktopControls = desktopControls == null
                ? new AwtDesktopControls()
                : desktopControls;
    }

    public static boolean isGuiMode() {
        return GUI_MODE.equals(System.getProperty("jdeploy.mode", ""));
    }

    public void launch(String[] args) {
        System.setProperty("java.awt.headless", "false");

        DesktopLaunchSettings settings = DesktopLaunchSettings.from(args);
        if (settings.canProbeExistingServer() && serverProbe.isActionDockRunning(settings.adminRootUri())) {
            URI adminUri = settings.adminUri(ADMIN_PATH);
            openBrowser(adminUri);
            DesktopControl control = showDesktopControls(adminUri, () -> exit(0));
            control.awaitExit();
            return;
        }

        ConfigurableApplicationContext context = startSpringApplication(args);
        URI adminUri = settings.withPort(resolveActualPort(context, settings.port())).adminUri(ADMIN_PATH);
        openBrowser(adminUri);
        showDesktopControls(adminUri, () -> {
            context.close();
            exit(0);
        });
    }

    ConfigurableApplicationContext startSpringApplication(String[] args) {
        SpringApplication application = new SpringApplication(applicationClass);
        application.setHeadless(false);
        return application.run(args);
    }

    private DesktopControl showDesktopControls(URI adminUri, Runnable quitAction) {
        return desktopControls.show(adminUri, () -> openBrowser(adminUri), quitAction);
    }

    private void openBrowser(URI adminUri) {
        try {
            browserLauncher.open(adminUri);
        } catch (IOException ex) {
            LOGGER.log(Level.WARNING, "Unable to open browser for " + adminUri, ex);
        }
    }

    private int resolveActualPort(ConfigurableApplicationContext context, int configuredPort) {
        if (context instanceof WebServerApplicationContext webContext) {
            return webContext.getWebServer().getPort();
        }
        return configuredPort;
    }

    private void exit(int status) {
        System.exit(status);
    }
}
