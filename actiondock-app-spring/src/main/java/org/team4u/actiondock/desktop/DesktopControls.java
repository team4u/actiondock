package org.team4u.actiondock.desktop;

import java.net.URI;

/**
 * Displays desktop controls for an already running ActionDock instance.
 */
@FunctionalInterface
public interface DesktopControls {
    DesktopControl show(URI adminUri, Runnable openAction, Runnable quitAction);
}
