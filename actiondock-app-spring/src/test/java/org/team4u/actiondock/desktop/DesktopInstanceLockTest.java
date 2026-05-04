package org.team4u.actiondock.desktop;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class DesktopInstanceLockTest {
    @TempDir
    Path runtimeDir;

    @Test
    void preventsSecondLockForSamePortUntilReleased() throws Exception {
        try (DesktopInstanceLock first = DesktopInstanceLock.tryAcquire(5177, runtimeDir)) {
            assertThat(first).isNotNull();
            assertThat(DesktopInstanceLock.tryAcquire(5177, runtimeDir)).isNull();
        }

        try (DesktopInstanceLock second = DesktopInstanceLock.tryAcquire(5177, runtimeDir)) {
            assertThat(second).isNotNull();
        }
    }
}
