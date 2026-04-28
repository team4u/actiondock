package org.team4u.actiondock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.update.UpdateNotificationService;

@Configuration
class UpdateNotificationConfiguration {
    @Bean
    UpdateNotificationService updateNotificationService() {
        return new UpdateNotificationService();
    }
}
