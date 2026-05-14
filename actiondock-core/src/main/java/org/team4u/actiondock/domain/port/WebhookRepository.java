package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.WebhookDefinition;

import java.util.List;
import java.util.Optional;

public interface WebhookRepository {
    WebhookDefinition save(WebhookDefinition webhook);

    Optional<WebhookDefinition> findById(String id);

    Optional<WebhookDefinition> findByKey(String key);

    List<WebhookDefinition> findAll();

    void deleteById(String id);
}
