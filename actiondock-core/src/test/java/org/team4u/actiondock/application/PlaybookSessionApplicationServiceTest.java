package org.team4u.actiondock.application;

import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookPhase;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.domain.model.PlaybookSession;
import org.team4u.actiondock.domain.model.PlaybookSessionStatus;
import org.team4u.actiondock.domain.model.PlaybookTraceEvent;
import org.team4u.actiondock.domain.model.PlaybookTraceEventType;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PlaybookRepository;
import org.team4u.actiondock.domain.port.PlaybookSessionRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PlaybookSessionApplicationServiceTest {
    private final InMemoryPlaybookRepository playbookRepository = new InMemoryPlaybookRepository();
    private final InMemoryPlaybookSessionRepository sessionRepository = new InMemoryPlaybookSessionRepository();
    private final JsonCodec jsonCodec = new SimpleJsonCodec();
    private final PlaybookSessionApplicationService service = new PlaybookSessionApplicationService(
            playbookRepository,
            sessionRepository,
            jsonCodec
    );

    @Test
    void startsSessionWithPlaybookSnapshotAndStartedEvent() {
        playbookRepository.save(new Playbook()
                .setId("refund")
                .setName("Refund")
                .setRiskLevel(PlaybookRiskLevel.MEDIUM)
                .setRepositoryIds(List.of("billing"))
                .setStopConditions(List.of("缺少上下文"))
                .setGuideMarkdown("guide")
                .setUpdatedAt(LocalDateTime.of(2026, 6, 5, 10, 0)));

        PlaybookSession session = service.startSession("refund", new PlaybookSession()
                .setUserPrompt("rf_123 退款为什么失败")
                .setIntent("refund")
                .setAgentName("cursor")
                .setAgentRunId("run-1"), Map.of("candidatePlaybookIds", List.of("refund")));

        assertThat(session.getPlaybookId()).isEqualTo("refund");
        assertThat(session.getRiskLevelSnapshot()).isEqualTo(PlaybookRiskLevel.MEDIUM);
        assertThat(session.getRepositoryIds()).containsExactly("billing");
        assertThat(session.getStopConditionsSnapshot()).containsExactly("缺少上下文");
        assertThat(session.getPlaybookSnapshotHash()).isNotBlank();
        assertThat(service.listEvents(session.getId())).singleElement().satisfies(event -> {
            assertThat(event.getType()).isEqualTo(PlaybookTraceEventType.SESSION_STARTED);
            assertThat(event.getSequence()).isEqualTo(1);
        });
    }

    @Test
    void appendsEventsWithSequenceIdempotencyAndRedaction() {
        playbookRepository.save(new Playbook().setId("refund").setName("Refund").setGuideMarkdown("guide"));
        PlaybookSession session = service.startSession("refund", new PlaybookSession(), Map.of());

        PlaybookTraceEvent first = service.appendEvent(session.getId(), new PlaybookTraceEvent()
                .setExternalEventId("step-1")
                .setPhase(PlaybookPhase.BOUND)
                .setType(PlaybookTraceEventType.STOP_CONDITION_CHECKED)
                .setReason("authorization header checked")
                .setPayload(Map.of("apiKey", "secret-value", "safe", "ok")));
        PlaybookTraceEvent retry = service.appendEvent(session.getId(), new PlaybookTraceEvent()
                .setExternalEventId("step-1")
                .setPhase(PlaybookPhase.BOUND)
                .setType(PlaybookTraceEventType.STOP_CONDITION_CHECKED));

        assertThat(retry.getId()).isEqualTo(first.getId());
        assertThat(first.getSequence()).isEqualTo(2);
        assertThat(first.isRedacted()).isTrue();
        assertThat(first.getReason()).isEqualTo("[REDACTED]");
        assertThat(first.getPayload()).containsEntry("apiKey", "[REDACTED]").containsEntry("safe", "ok");
        assertThat(service.getSession(session.getId()).getCurrentPhase()).isEqualTo(PlaybookPhase.BOUND);
    }

    @Test
    void completesAndRejectsFurtherEvents() {
        playbookRepository.save(new Playbook().setId("refund").setName("Refund").setGuideMarkdown("guide"));
        PlaybookSession session = service.startSession("refund", new PlaybookSession(), Map.of());

        PlaybookSession completed = service.completeSession(session.getId(), PlaybookSessionStatus.COMPLETED, "done", null);

        assertThat(completed.getStatus()).isEqualTo(PlaybookSessionStatus.COMPLETED);
        assertThat(completed.getEndedAt()).isNotNull();
        assertThat(service.listEvents(session.getId())).extracting(PlaybookTraceEvent::getType)
                .contains(PlaybookTraceEventType.SESSION_COMPLETED);
        assertThatThrownBy(() -> service.appendEvent(session.getId(), new PlaybookTraceEvent()
                .setPhase(PlaybookPhase.ACT)
                .setType(PlaybookTraceEventType.DIAGNOSIS_EMITTED)))
                .isInstanceOf(ActionDockException.class)
                .hasMessageContaining("已结束");
    }

    private static final class InMemoryPlaybookRepository implements PlaybookRepository {
        private final Map<String, Playbook> items = new LinkedHashMap<>();

        @Override
        public Playbook save(Playbook playbook) {
            items.put(playbook.getId(), playbook);
            return playbook;
        }

        @Override
        public Optional<Playbook> findById(String id) {
            return Optional.ofNullable(items.get(id));
        }

        @Override
        public List<Playbook> findAll() {
            return new ArrayList<>(items.values());
        }

        @Override
        public void deleteById(String id) {
            items.remove(id);
        }
    }

    private static final class InMemoryPlaybookSessionRepository implements PlaybookSessionRepository {
        private final Map<String, PlaybookSession> sessions = new LinkedHashMap<>();
        private final Map<String, PlaybookTraceEvent> events = new LinkedHashMap<>();

        @Override
        public PlaybookSession saveSession(PlaybookSession session) {
            sessions.put(session.getId(), session);
            return session;
        }

        @Override
        public Optional<PlaybookSession> findSessionById(String id) {
            return Optional.ofNullable(sessions.get(id));
        }

        @Override
        public PlaybookTraceEvent saveEvent(PlaybookTraceEvent event) {
            events.put(event.getId(), event);
            return event;
        }

        @Override
        public Optional<PlaybookTraceEvent> findEventBySessionIdAndExternalEventId(String sessionId, String externalEventId) {
            return events.values().stream()
                    .filter(event -> sessionId.equals(event.getSessionId()))
                    .filter(event -> externalEventId.equals(event.getExternalEventId()))
                    .findFirst();
        }

        @Override
        public List<PlaybookTraceEvent> findEventsBySessionId(String sessionId) {
            return events.values().stream()
                    .filter(event -> sessionId.equals(event.getSessionId()))
                    .sorted(Comparator.comparingLong(PlaybookTraceEvent::getSequence))
                    .toList();
        }

        @Override
        public long nextSequence(String sessionId) {
            return findEventsBySessionId(sessionId).stream()
                    .mapToLong(PlaybookTraceEvent::getSequence)
                    .max()
                    .orElse(0) + 1;
        }
    }

    private static final class SimpleJsonCodec implements JsonCodec {
        @Override
        public String write(Object value) {
            return String.valueOf(value);
        }

        @Override
        public <T> T read(String json, Class<T> type) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Object readUntyped(String json) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <T> List<T> readList(String json, Class<T> elementType) {
            return List.of();
        }

        @Override
        public Map<String, Object> readMap(String json) {
            return Map.of();
        }
    }
}
