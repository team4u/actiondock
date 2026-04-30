package org.team4u.actiondock.desktop;

import java.awt.Desktop;
import java.awt.GraphicsEnvironment;
import java.io.IOException;
import java.net.URI;
import java.util.Locale;

/**
 * Opens URLs in the platform default browser.
 */
public class SystemBrowserLauncher implements BrowserLauncher {
    @Override
    public void open(URI uri) throws IOException {
        if (!GraphicsEnvironment.isHeadless()
                && Desktop.isDesktopSupported()
                && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
            Desktop.getDesktop().browse(uri);
            return;
        }

        openWithPlatformCommand(uri);
    }

    private void openWithPlatformCommand(URI uri) throws IOException {
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        String value = uri.toString();
        if (os.contains("mac")) {
            new ProcessBuilder("open", value).start();
            return;
        }
        if (os.contains("win")) {
            new ProcessBuilder("rundll32", "url.dll,FileProtocolHandler", value).start();
            return;
        }
        new ProcessBuilder("xdg-open", value).start();
    }
}
