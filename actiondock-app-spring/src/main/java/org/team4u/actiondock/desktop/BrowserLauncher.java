package org.team4u.actiondock.desktop;

import java.io.IOException;
import java.net.URI;

/**
 * Opens an externally visible URI for desktop launch flows.
 */
@FunctionalInterface
public interface BrowserLauncher {
    void open(URI uri) throws IOException;
}
