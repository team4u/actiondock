package org.team4u.actiondock.storage.jpa.repo;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.team4u.actiondock.storage.jpa.entity.AiAgentRunEntity;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest(properties = "spring.jpa.hibernate.ddl-auto=create-drop")
class SpringDataAiAgentRunRepositoryTest {
    @Autowired
    private SpringDataAiAgentRunRepository repository;

    @Test
    void findAllByOrderByStartedAtDescReturnsNewestRunsFirst() {
        repository.save(entity("run-1", LocalDateTime.of(2024, 1, 2, 3, 4)));
        repository.save(entity("run-2", LocalDateTime.of(2024, 1, 2, 3, 5)));
        repository.save(entity("run-3", LocalDateTime.of(2024, 1, 2, 3, 3)));

        List<AiAgentRunEntity> runs = repository.findAllByOrderByStartedAtDesc();

        assertThat(runs).extracting(AiAgentRunEntity::getId).containsExactly("run-2", "run-1", "run-3");
    }

    private static AiAgentRunEntity entity(String id, LocalDateTime startedAt) {
        AiAgentRunEntity entity = new AiAgentRunEntity();
        entity.setId(id);
        entity.setStartedAt(startedAt);
        entity.setStatus("RUNNING");
        return entity;
    }

    @SpringBootConfiguration
    @EnableAutoConfiguration
    @EntityScan("org.team4u.actiondock.storage.jpa.entity")
    @EnableJpaRepositories("org.team4u.actiondock.storage.jpa.repo")
    static class TestApplication {
    }
}
