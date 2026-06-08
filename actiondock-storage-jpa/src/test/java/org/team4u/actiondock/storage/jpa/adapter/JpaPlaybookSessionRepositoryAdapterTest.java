package org.team4u.actiondock.storage.jpa.adapter;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.team4u.actiondock.domain.model.PlaybookPhase;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.domain.model.PlaybookSession;
import org.team4u.actiondock.domain.model.PlaybookSessionStatus;
import org.team4u.actiondock.domain.model.PlaybookTraceEvent;
import org.team4u.actiondock.domain.model.PlaybookTraceEventType;
import org.team4u.actiondock.storage.jpa.entity.PlaybookSessionEntity;
import org.team4u.actiondock.storage.jpa.entity.PlaybookTraceEventEntity;
import org.team4u.actiondock.storage.jpa.json.JacksonJsonCodec;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPlaybookSessionRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPlaybookTraceEventRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JpaPlaybookSessionRepositoryAdapterTest {
    @Test
    void roundTripsSessionAndEvent() {
        SpringDataPlaybookSessionRepository sessionRepository = mock(SpringDataPlaybookSessionRepository.class);
        SpringDataPlaybookTraceEventRepository eventRepository = mock(SpringDataPlaybookTraceEventRepository.class);
        AtomicReference<PlaybookSessionEntity> storedSession = new AtomicReference<>();
        AtomicReference<PlaybookTraceEventEntity> storedEvent = new AtomicReference<>();
        when(sessionRepository.save(any())).thenAnswer(invocation -> {
            PlaybookSessionEntity entity = invocation.getArgument(0);
            storedSession.set(entity);
            return entity;
        });
        when(sessionRepository.findById("pbs-1")).thenAnswer(invocation -> Optional.ofNullable(storedSession.get()));
        when(sessionRepository.findAllByOrderByUpdatedAtDescStartedAtDesc()).thenAnswer(invocation -> List.of(storedSession.get()));
        when(eventRepository.save(any())).thenAnswer(invocation -> {
            PlaybookTraceEventEntity entity = invocation.getArgument(0);
            storedEvent.set(entity);
            return entity;
        });
        when(eventRepository.findBySessionIdOrderBySequenceAsc("pbs-1")).thenAnswer(invocation -> List.of(storedEvent.get()));
        when(eventRepository.findMaxSequenceBySessionId("pbs-1")).thenReturn(1L);

        JpaPlaybookSessionRepositoryAdapter adapter = new JpaPlaybookSessionRepositoryAdapter(
                sessionRepository,
                eventRepository,
                new JacksonJsonCodec(new ObjectMapper())
        );
        PlaybookSession session = adapter.saveSession(new PlaybookSession()
                .setId("pbs-1")
                .setPlaybookId("refund")
                .setPlaybookName("Refund")
                .setRepositoryIds(List.of("billing"))
                .setRiskLevelSnapshot(PlaybookRiskLevel.MEDIUM)
                .setStopConditionsSnapshot(List.of("缺少上下文"))
                .setStatus(PlaybookSessionStatus.RUNNING)
                .setCurrentPhase(PlaybookPhase.ROUTE)
                .setStartedAt(LocalDateTime.of(2026, 6, 5, 10, 0)));
        PlaybookTraceEvent event = adapter.saveEvent(new PlaybookTraceEvent()
                .setId("pbe-1")
                .setSessionId("pbs-1")
                .setExternalEventId("step-1")
                .setSequence(1)
                .setPhase(PlaybookPhase.BOUND)
                .setType(PlaybookTraceEventType.STOP_CONDITION_CHECKED)
                .setPayload(Map.of("field", "refundId"))
                .setRedactedFields(List.of("payload.token"))
                .setCreatedAt(LocalDateTime.of(2026, 6, 5, 10, 1)));

        assertThat(storedSession.get().getRepositoryIdsJson()).contains("billing");
        assertThat(session.getStopConditionsSnapshot()).containsExactly("缺少上下文");
        assertThat(storedEvent.get().getPayloadJson()).contains("refundId");
        assertThat(event.getPayload()).containsEntry("field", "refundId");
        assertThat(adapter.findSessionById("pbs-1")).isPresent();
        assertThat(adapter.findAllSessions()).singleElement().satisfies(value ->
                assertThat(value.getId()).isEqualTo("pbs-1"));
        assertThat(adapter.findEventsBySessionId("pbs-1")).singleElement().satisfies(value ->
                assertThat(value.getType()).isEqualTo(PlaybookTraceEventType.STOP_CONDITION_CHECKED));
        assertThat(adapter.nextSequence("pbs-1")).isEqualTo(2);
    }
}
