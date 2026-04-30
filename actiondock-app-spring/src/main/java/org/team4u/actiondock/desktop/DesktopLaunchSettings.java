package org.team4u.actiondock.desktop;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * Minimal Spring-compatible launch settings needed before the application context exists.
 */
public record DesktopLaunchSettings(String host, int port) {
    private static final String DEFAULT_HOST = "127.0.0.1";
    private static final int DEFAULT_PORT = 5177;

    public static DesktopLaunchSettings from(String[] args) {
        return new DesktopLaunchSettings(
                browserHost(firstPresent(
                        option(args, "--server.address="),
                        System.getProperty("server.address"),
                        System.getenv("SERVER_ADDRESS"),
                        DEFAULT_HOST
                )),
                parsePort(firstPresent(
                        option(args, "--server.port="),
                        System.getProperty("server.port"),
                        System.getenv("SERVER_PORT"),
                        String.valueOf(DEFAULT_PORT)
                ))
        );
    }

    public DesktopLaunchSettings withPort(int actualPort) {
        return new DesktopLaunchSettings(host, actualPort);
    }

    public boolean canProbeExistingServer() {
        return port > 0;
    }

    public URI adminRootUri() {
        return uri("/admin");
    }

    public URI adminUri(String path) {
        return uri(path);
    }

    private URI uri(String path) {
        try {
            return new URI("http", null, host, port, path, null, null);
        } catch (URISyntaxException ex) {
            throw new IllegalArgumentException("Invalid desktop URL settings", ex);
        }
    }

    private static String option(String[] args, String prefix) {
        if (args == null) {
            return null;
        }
        for (String arg : args) {
            if (arg != null && arg.startsWith(prefix)) {
                return arg.substring(prefix.length());
            }
        }
        return null;
    }

    private static String firstPresent(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value.trim();
            }
        }
        return null;
    }

    private static int parsePort(String value) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException ex) {
            return DEFAULT_PORT;
        }
    }

    private static String browserHost(String configuredAddress) {
        String address = configuredAddress == null ? DEFAULT_HOST : configuredAddress.trim();
        String normalized = address.toLowerCase(Locale.ROOT);
        if (address.isBlank()
                || "0.0.0.0".equals(normalized)
                || "::".equals(normalized)
                || "[::]".equals(normalized)) {
            return DEFAULT_HOST;
        }
        if (address.startsWith("[") && address.endsWith("]")) {
            return address.substring(1, address.length() - 1);
        }
        return address;
    }
}
