package org.team4u.scriptflow.application;

import org.junit.jupiter.api.Test;
import org.team4u.scriptflow.domain.model.PublishedScriptSnapshot;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptSchedule;
import org.team4u.scriptflow.domain.model.ScriptStatus;
import org.team4u.scriptflow.domain.port.ScheduleExpressionValidator;
import org.team4u.scriptflow.domain.port.ScriptRepository;
import org.team4u.scriptflow.domain.port.ScriptScheduleRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ScheduleApplicationServiceTest {
    private final InMemoryScriptScheduleRepository scriptScheduleRepository = new InMemoryScriptScheduleRepository();
    private final InMemoryScriptRepository scriptRepository = new InMemoryScriptRepository();
    private final ScheduleExpressionValidator validator = expression -> {
        if (!expression.split(" ").equals(expression)) {
            // no-op branch to keep lambda obvious for tests
        }
        if (expression.isBlank()) {
            throw new IllegalArgumentException("invalid cron");
        }
    };
    private final ScheduleApplicationService service =
            new ScheduleApplicationService(scriptScheduleRepository, scriptRepository, validator);

    @Test
    void saveRejectsUnpublishedScript() {
        scriptRepository.save(new ScriptDefinition().setId("script-1").setStatus(ScriptStatus.DRAFT));

        assertThatThrownBy(() -> service.save("script-1", new ScriptSchedule()
                .setName("Nightly")
                .setCronExpression("0 0 * * * *")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Script not published: script-1");
    }

    @Test
    void saveAllowsMultipleSchedulesForSameScript() {
        scriptRepository.save(publishedScript("script-1"));

        ScriptSchedule first = service.save("script-1", new ScriptSchedule()
                .setName("Every 5 minutes")
                .setCronExpression("0 */5 * * * *")
                .setInput(Map.of("mode", "fast")));
        ScriptSchedule second = service.save("script-1", new ScriptSchedule()
                .setName("Every hour")
                .setCronExpression("0 0 * * * *")
                .setInput(Map.of("mode", "full")));

        assertThat(first.getId()).isNotBlank();
        assertThat(second.getId()).isNotBlank();
        assertThat(second.getId()).isNotEqualTo(first.getId());
        assertThat(service.list("script-1")).hasSize(2);
    }

    @Test
    void saveDelegatesCronValidation() {
        scriptRepository.save(publishedScript("script-1"));
        ScheduleApplicationService failingService = new ScheduleApplicationService(
                scriptScheduleRepository,
                scriptRepository,
                expression -> {
                    throw new IllegalArgumentException("bad cron");
                }
        );

        assertThatThrownBy(() -> failingService.save("script-1", new ScriptSchedule()
                .setName("Broken")
                .setCronExpression("bad")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("bad cron");
    }

    @Test
    void enableAndDisableToggleScheduleState() {
        scriptRepository.save(publishedScript("script-1"));
        ScriptSchedule created = service.save("script-1", new ScriptSchedule()
                .setName("Nightly")
                .setCronExpression("0 0 2 * * *")
                .setEnabled(false));

        ScriptSchedule enabled = service.enable("script-1", created.getId());
        ScriptSchedule disabled = service.disable("script-1", created.getId());

        assertThat(enabled.isEnabled()).isTrue();
        assertThat(disabled.isEnabled()).isFalse();
    }

    @Test
    void markTriggeredUpdatesExecutionTracking() {
        scriptRepository.save(publishedScript("script-1"));
        ScriptSchedule created = service.save("script-1", new ScriptSchedule()
                .setName("Nightly")
                .setCronExpression("0 0 2 * * *"));

        LocalDateTime triggeredAt = LocalDateTime.of(2026, 4, 22, 1, 2, 3);
        ScriptSchedule updated = service.markTriggered(created.getId(), "exec-1", triggeredAt);

        assertThat(updated.getLastExecutionId()).isEqualTo("exec-1");
        assertThat(updated.getLastTriggeredAt()).isEqualTo(triggeredAt);
    }

    private ScriptDefinition publishedScript(String id) {
        return new ScriptDefinition()
                .setId(id)
                .setName("Published")
                .setStatus(ScriptStatus.PUBLISHED)
                .setPublishedSnapshot(new PublishedScriptSnapshot()
                        .setName("Published")
                        .setSource("return [:]"));
    }

    private static final class InMemoryScriptRepository implements ScriptRepository {
        private final Map<String, ScriptDefinition> storage = new LinkedHashMap<>();

        @Override
        public ScriptDefinition save(ScriptDefinition definition) {
            storage.put(definition.getId(), definition);
            return definition;
        }

        @Override
        public Optional<ScriptDefinition> findById(String id) {
            return Optional.ofNullable(storage.get(id));
        }

        @Override
        public List<ScriptDefinition> findAll() {
            return new ArrayList<>(storage.values());
        }

        @Override
        public void deleteById(String id) {
            storage.remove(id);
        }
    }

    private static final class InMemoryScriptScheduleRepository implements ScriptScheduleRepository {
        private final Map<String, ScriptSchedule> storage = new LinkedHashMap<>();

        @Override
        public ScriptSchedule save(ScriptSchedule schedule) {
            storage.put(schedule.getId(), copy(schedule));
            return copy(schedule);
        }

        @Override
        public Optional<ScriptSchedule> findById(String id) {
            return Optional.ofNullable(storage.get(id)).map(InMemoryScriptScheduleRepository::copy);
        }

        @Override
        public List<ScriptSchedule> findAll() {
            return storage.values().stream().map(InMemoryScriptScheduleRepository::copy).toList();
        }

        @Override
        public List<ScriptSchedule> findByScriptId(String scriptId) {
            return storage.values().stream()
                    .filter(schedule -> scriptId.equals(schedule.getScriptId()))
                    .map(InMemoryScriptScheduleRepository::copy)
                    .toList();
        }

        @Override
        public List<ScriptSchedule> findEnabled() {
            return storage.values().stream()
                    .filter(ScriptSchedule::isEnabled)
                    .map(InMemoryScriptScheduleRepository::copy)
                    .toList();
        }

        @Override
        public void deleteById(String id) {
            storage.remove(id);
        }

        @Override
        public void deleteByScriptId(String scriptId) {
            storage.entrySet().removeIf(entry -> scriptId.equals(entry.getValue().getScriptId()));
        }

        private static ScriptSchedule copy(ScriptSchedule schedule) {
            return new ScriptSchedule()
                    .setId(schedule.getId())
                    .setScriptId(schedule.getScriptId())
                    .setName(schedule.getName())
                    .setCronExpression(schedule.getCronExpression())
                    .setInput(schedule.getInput())
                    .setEnabled(schedule.isEnabled())
                    .setLastTriggeredAt(schedule.getLastTriggeredAt())
                    .setLastExecutionId(schedule.getLastExecutionId())
                    .setCreatedAt(schedule.getCreatedAt())
                    .setUpdatedAt(schedule.getUpdatedAt());
        }
    }
}
