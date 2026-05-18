package org.team4u.actiondock.storage.jpa.repo;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.team4u.actiondock.storage.jpa.entity.ExecutionEntity;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest(properties = "spring.jpa.hibernate.ddl-auto=create-drop")
class SpringDataExecutionEntityRepositoryTest {
    @Autowired
    private SpringDataExecutionEntityRepository repository;

    @Test
    void findByScriptIdOrderByCreatedAtDescFiltersAndSortsDescending() {
        repository.save(entity("exec-1", "script-1", LocalDateTime.of(2024, 1, 2, 3, 4)));
        repository.save(entity("exec-2", "script-1", LocalDateTime.of(2024, 1, 2, 3, 5)));
        repository.save(entity("exec-3", "script-2", LocalDateTime.of(2024, 1, 2, 3, 6)));

        List<ExecutionEntity> records = repository.findByScriptIdOrderByCreatedAtDesc("script-1");

        assertThat(records).extracting(ExecutionEntity::getId).containsExactly("exec-2", "exec-1");
    }

    @Test
    void deleteAllByScriptIdRemovesMatchingRecordsOnly() {
        repository.save(entity("exec-1", "script-1", LocalDateTime.of(2024, 1, 2, 3, 4)));
        repository.save(entity("exec-2", "script-1", LocalDateTime.of(2024, 1, 2, 3, 5)));
        repository.save(entity("exec-3", "script-2", LocalDateTime.of(2024, 1, 2, 3, 6)));

        int deleted = repository.deleteAllByScriptId("script-1");

        assertThat(deleted).isEqualTo(2);
        assertThat(repository.findAll()).extracting(ExecutionEntity::getId).containsExactly("exec-3");
    }

    private static ExecutionEntity entity(String id, String scriptId, LocalDateTime createdAt) {
        ExecutionEntity entity = new ExecutionEntity();
        entity.setId(id);
        entity.setScriptId(scriptId);
        entity.setStatus("SUCCESS");
        entity.setSubmitMode("SYNC");
        entity.setCreatedAt(createdAt);
        return entity;
    }

    @SpringBootConfiguration
    @EnableAutoConfiguration
    @EntityScan("org.team4u.actiondock.storage.jpa.entity")
    @EnableJpaRepositories("org.team4u.actiondock.storage.jpa.repo")
    static class TestApplication {
    }
}
