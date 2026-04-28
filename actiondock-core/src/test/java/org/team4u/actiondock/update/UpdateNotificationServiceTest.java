package org.team4u.actiondock.update;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class UpdateNotificationServiceTest {
    @TempDir
    Path tempHome;

    @Test
    void returnsNotificationAndCachesLatestVersion() {
        AtomicInteger fetchCount = new AtomicInteger();
        UpdateNotificationService service = new UpdateNotificationService(
                new ObjectMapper().findAndRegisterModules(),
                fixedClock("2026-04-28T12:00:00Z"),
                Duration.ofHours(24),
                packageName -> {
                    fetchCount.incrementAndGet();
                    return Optional.of("0.2.10");
                }
        );

        Optional<UpdateNotificationService.UpdateNotification> notification = service.checkForUpdate(request("0.2.9", Map.of()));

        assertThat(notification).isPresent();
        assertThat(notification.orElseThrow().message()).contains("0.2.10").contains("0.2.9");
        assertThat(fetchCount.get()).isEqualTo(1);
        assertThat(tempHome.resolve(".actiondock/update-check/cli.json")).exists();
    }

    @Test
    void reusesCachedLatestVersionWithinIntervalWithoutRefetching() {
        AtomicInteger fetchCount = new AtomicInteger();
        UpdateNotificationService initialService = new UpdateNotificationService(
                new ObjectMapper().findAndRegisterModules(),
                fixedClock("2026-04-28T12:00:00Z"),
                Duration.ofHours(24),
                packageName -> {
                    fetchCount.incrementAndGet();
                    return Optional.of("1.0.0");
                }
        );
        initialService.checkForUpdate(request("1.0.0-beta.1", Map.of()));

        UpdateNotificationService cachedService = new UpdateNotificationService(
                new ObjectMapper().findAndRegisterModules(),
                fixedClock("2026-04-28T13:00:00Z"),
                Duration.ofHours(24),
                packageName -> {
                    fetchCount.incrementAndGet();
                    return Optional.of("1.0.1");
                }
        );
        Optional<UpdateNotificationService.UpdateNotification> notification = cachedService.checkForUpdate(request("1.0.0-beta.1", Map.of()));

        assertThat(notification).isPresent();
        assertThat(notification.orElseThrow().latestVersion()).isEqualTo("1.0.0");
        assertThat(fetchCount.get()).isEqualTo(1);
    }

    @Test
    void disableEnvVarSkipsCheck() {
        AtomicInteger fetchCount = new AtomicInteger();
        UpdateNotificationService service = new UpdateNotificationService(
                new ObjectMapper().findAndRegisterModules(),
                fixedClock("2026-04-28T12:00:00Z"),
                Duration.ofHours(24),
                packageName -> {
                    fetchCount.incrementAndGet();
                    return Optional.of("0.2.10");
                }
        );

        Optional<UpdateNotificationService.UpdateNotification> notification = service.checkForUpdate(
                request("0.2.9", Map.of(UpdateNotificationService.DISABLE_ENV, "1"))
        );

        assertThat(notification).isEmpty();
        assertThat(fetchCount.get()).isZero();
    }

    private UpdateNotificationService.UpdateNotificationRequest request(String currentVersion, Map<String, String> environment) {
        return new UpdateNotificationService.UpdateNotificationRequest(
                "cli",
                "actiondock-cli",
                "ActionDock CLI",
                currentVersion,
                "npm i -g actiondock-cli@latest",
                tempHome,
                environment
        );
    }

    private Clock fixedClock(String instant) {
        return Clock.fixed(Instant.parse(instant), ZoneOffset.UTC);
    }
}
