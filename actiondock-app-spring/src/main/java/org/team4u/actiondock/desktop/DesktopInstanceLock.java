package org.team4u.actiondock.desktop;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public final class DesktopInstanceLock implements AutoCloseable {
    private final FileChannel channel;
    private final FileLock lock;

    private DesktopInstanceLock(FileChannel channel, FileLock lock) {
        this.channel = channel;
        this.lock = lock;
    }

    public static DesktopInstanceLock tryAcquire(int port) throws IOException {
        return tryAcquire(port, userRuntimeDir());
    }

    static DesktopInstanceLock tryAcquire(int port, Path runtimeDir) throws IOException {
        Files.createDirectories(runtimeDir);

        Path lockFile = runtimeDir.resolve("desktop-" + port + ".lock");
        FileChannel channel = FileChannel.open(
                lockFile,
                StandardOpenOption.CREATE,
                StandardOpenOption.WRITE
        );

        FileLock lock = null;
        try {
            lock = channel.tryLock();
        } catch (OverlappingFileLockException ex) {
            channel.close();
            return null;
        }

        if (lock == null) {
            channel.close();
            return null;
        }

        return new DesktopInstanceLock(channel, lock);
    }

    private static Path userRuntimeDir() {
        String os = System.getProperty("os.name", "").toLowerCase();
        String userHome = System.getProperty("user.home");

        if (os.contains("win")) {
            String localAppData = System.getenv("LOCALAPPDATA");
            if (localAppData != null && !localAppData.isBlank()) {
                return Path.of(localAppData, "ActionDock");
            }
            return Path.of(userHome, "AppData", "Local", "ActionDock");
        }

        if (os.contains("mac")) {
            return Path.of(userHome, "Library", "Application Support", "ActionDock");
        }

        String xdgRuntimeDir = System.getenv("XDG_RUNTIME_DIR");
        if (xdgRuntimeDir != null && !xdgRuntimeDir.isBlank()) {
            return Path.of(xdgRuntimeDir, "actiondock");
        }

        return Path.of(userHome, ".local", "state", "actiondock");
    }

    @Override
    public void close() throws IOException {
        try {
            lock.release();
        } finally {
            channel.close();
        }
    }
}
