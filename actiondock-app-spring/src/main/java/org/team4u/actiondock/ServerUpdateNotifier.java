package org.team4u.actiondock;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.team4u.actiondock.update.ApplicationVersionResolver;
import org.team4u.actiondock.update.UpdateNotificationService;
import org.team4u.actiondock.update.UpdateNotificationService.UpdateNotificationRequest;

import java.nio.file.Path;

@Component
class ServerUpdateNotifier {
    private static final Logger log = LoggerFactory.getLogger(ServerUpdateNotifier.class);
    private static final String CURRENT_VERSION = ApplicationVersionResolver.resolve(
            RuntimeApplication.class,
            "org.team4u",
            "actiondock-app-spring"
    );

    private final UpdateNotificationService updateNotificationService;

    ServerUpdateNotifier(UpdateNotificationService updateNotificationService) {
        this.updateNotificationService = updateNotificationService;
    }

    @EventListener(ApplicationReadyEvent.class)
    void onApplicationReady() {
        Thread.ofVirtual()
                .name("actiondock-server-update-check")
                .start(this::checkAndLog);
    }

    void checkAndLog() {
        updateNotificationService.checkForUpdate(new UpdateNotificationRequest(
                        "server",
                        "@actiondock/server",
                        "ActionDock Server",
                        CURRENT_VERSION,
                        "npm i -g @actiondock/server@latest",
                        Path.of(System.getProperty("user.home")),
                        System.getenv()
                ))
                .map(UpdateNotificationService.UpdateNotification::message)
                .ifPresent(log::warn);
    }
}
