package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.WebhookEntity;

import java.util.List;
import java.util.Optional;

public interface SpringDataWebhookEntityRepository extends JpaRepository<WebhookEntity, String> {
    Optional<WebhookEntity> findByWebhookKey(String webhookKey);

    List<WebhookEntity> findAllByOrderByCreatedAtDesc();
}
