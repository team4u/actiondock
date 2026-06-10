package org.team4u.actiondock.storage.jpa.adapter;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.storage.jpa.entity.ScriptScheduleEntity;
import org.team4u.actiondock.storage.jpa.json.JacksonJsonCodec;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptScheduleEntityRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class JpaScriptScheduleRepositoryAdapterTest {
    @Test
    void saveAndListRoundTripSchedules() {
        SpringDataScriptScheduleEntityRepository repository = mock(SpringDataScriptScheduleEntityRepository.class);
        AtomicReference<ScriptScheduleEntity> stored = new AtomicReference<>();
        when(repository.save(any())).thenAnswer(invocation -> {
            ScriptScheduleEntity entity = invocation.getArgument(0);
            stored.set(entity);
            return entity;
        });
        when(repository.findById("schedule-1")).thenAnswer(invocation -> Optional.ofNullable(stored.get()));
        when(repository.findAllByOrderByCreatedAtDesc()).thenAnswer(invocation -> List.of(stored.get()));
        when(repository.findByScriptIdOrderByCreatedAtDesc("script-1")).thenAnswer(invocation -> List.of(stored.get()));
        when(repository.findByEnabledTrueOrderByCreatedAtAsc()).thenAnswer(invocation -> List.of(stored.get()));

        JpaScriptScheduleRepositoryAdapter adapter =
                new JpaScriptScheduleRepositoryAdapter(repository, new JacksonJsonCodec(new ObjectMapper()));
        ScriptSchedule schedule = new ScriptSchedule()
                .setId("schedule-1")
                .setScriptId("script-1")
                .setName("Nightly")
                .setCronExpression("0 0 2 * * *")
                .setInput(Map.of("mode", "full"))
                .setEnabled(true)
                .setLastExecutionId("exec-1")
                .setCreatedAt(LocalDateTime.of(2026, 4, 22, 1, 2))
                .setUpdatedAt(LocalDateTime.of(2026, 4, 22, 1, 3));

        ScriptSchedule saved = adapter.save(schedule);

        assertThat(saved.getCronExpression()).isEqualTo("0 0 2 * * *");
        assertThat(saved.getInput()).containsEntry("mode", "full");
        assertThat(adapter.findById("schedule-1")).isPresent();
        assertThat(adapter.findAll()).hasSize(1);
        assertThat(adapter.findByScriptId("script-1")).hasSize(1);
        assertThat(adapter.findEnabled()).hasSize(1);
    }

    @Test
    void deleteDelegatesToRepository() {
        SpringDataScriptScheduleEntityRepository repository = mock(SpringDataScriptScheduleEntityRepository.class);
        JpaScriptScheduleRepositoryAdapter adapter =
                new JpaScriptScheduleRepositoryAdapter(repository, new JacksonJsonCodec(new ObjectMapper()));

        adapter.deleteById("schedule-1");
        adapter.deleteByScriptId("script-1");

        verify(repository).deleteById("schedule-1");
        verify(repository).deleteAllByScriptId("script-1");
    }
}
