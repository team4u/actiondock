package org.team4u.actiondock.desktop;

/**
 * Represents a desktop control surface such as a tray icon or fallback window.
 */
public interface DesktopControl {
    DesktopControl NOOP = () -> {
    };

    void awaitExit();
}
