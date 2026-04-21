package org.team4u.scriptflow.storage.jpa.adapter;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.storage.jpa.entity.ExecutionEntity;
import org.team4u.scriptflow.storage.jpa.json.JacksonJsonCodec;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataExecutionEntityRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JpaExecutionRepositoryAdapterTest {
    @Test
    void saveAndFindByScriptIdRoundTripExecutionRecords() {
        SpringDataExecutionEntityRepository repository = mock(SpringDataExecutionEntityRepository.class);
        AtomicReference<ExecutionEntity> stored = new AtomicReference<>();
        when(repository.save(any())).thenAnswer(invocation -> {
            ExecutionEntity entity = invocation.getArgument(0);
            stored.set(entity);
            return entity;
        });
        when(repository.findById("exec-1")).thenAnswer(invocation -> Optional.ofNullable(stored.get()));
        when(repository.findByScriptIdOrderByCreatedAtDesc("script-1")).thenAnswer(invocation -> List.of(stored.get()));

        JpaExecutionRepositoryAdapter adapter = new JpaExecutionRepositoryAdapter(repository, new JacksonJsonCodec(new ObjectMapper()));
        ExecutionRecord record = new ExecutionRecord()
                .setId("exec-1")
                .setScriptId("script-1")
                .setStatus(ExecutionStatus.SUCCESS)
                .setSubmitMode(SubmitMode.ASYNC)
                .setInput(Map.of("name", "Alice"))
                .setOutput(Map.of("message", "Hello"))
                .setCreatedAt(LocalDateTime.of(2024, 1, 2, 3, 4))
                .setStartedAt(LocalDateTime.of(2024, 1, 2, 3, 5))
                .setFinishedAt(LocalDateTime.of(2024, 1, 2, 3, 6));

        ExecutionRecord saved = adapter.save(record);
        ExecutionRecord found = adapter.findById("exec-1").orElseThrow();
        List<ExecutionRecord> records = adapter.findByScriptId("script-1");

        assertThat(stored.get().getStatus()).isEqualTo("SUCCESS");
        assertThat(stored.get().getSubmitMode()).isEqualTo("ASYNC");
        assertThat(stored.get().getInputJson()).contains("\"name\":\"Alice\"");
        assertThat(stored.get().getOutputJson()).contains("\"message\":\"Hello\"");
        assertThat(saved.getOutput()).containsEntry("message", "Hello");
        assertThat(found.getSubmitMode()).isEqualTo(SubmitMode.ASYNC);
        assertThat(records).singleElement().satisfies(value ->
                assertThat(value.getStatus()).isEqualTo(ExecutionStatus.SUCCESS));
    }
}
