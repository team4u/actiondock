package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.PlaybookPhase;
import org.team4u.actiondock.domain.model.PlaybookRiskLevel;
import org.team4u.actiondock.domain.model.PlaybookSession;
import org.team4u.actiondock.domain.model.PlaybookSessionStatus;
import org.team4u.actiondock.domain.model.PlaybookTraceEvent;
import org.team4u.actiondock.domain.model.PlaybookTraceEventType;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PlaybookSessionRepository;
import org.team4u.actiondock.storage.jpa.entity.PlaybookSessionEntity;
import org.team4u.actiondock.storage.jpa.entity.PlaybookTraceEventEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPlaybookSessionRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPlaybookTraceEventRepository;

import java.util.List;
import java.util.Optional;

@Component
public class JpaPlaybookSessionRepositoryAdapter implements PlaybookSessionRepository {
    private final SpringDataPlaybookSessionRepository sessionRepository;
    private final SpringDataPlaybookTraceEventRepository eventRepository;
    private final JsonCodec jsonCodec;

    public JpaPlaybookSessionRepositoryAdapter(SpringDataPlaybookSessionRepository sessionRepository,
                                               SpringDataPlaybookTraceEventRepository eventRepository,
                                               JsonCodec jsonCodec) {
        this.sessionRepository = sessionRepository;
        this.eventRepository = eventRepository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public PlaybookSession saveSession(PlaybookSession session) {
        return toDomain(sessionRepository.save(toEntity(session)));
    }

    @Override
    public Optional<PlaybookSession> findSessionById(String id) {
        return sessionRepository.findById(id).map(this::toDomain);
    }

    @Override
    public PlaybookTraceEvent saveEvent(PlaybookTraceEvent event) {
        try {
            return toDomain(eventRepository.save(toEntity(event)));
        } catch (DataIntegrityViolationException exception) {
            if (event.getExternalEventId() != null) {
                Optional<PlaybookTraceEvent> existing = findEventBySessionIdAndExternalEventId(
                        event.getSessionId(),
                        event.getExternalEventId()
                );
                if (existing.isPresent()) {
                    return existing.get();
                }
            }
            throw exception;
        }
    }

    @Override
    public Optional<PlaybookTraceEvent> findEventBySessionIdAndExternalEventId(String sessionId, String externalEventId) {
        return eventRepository.findBySessionIdAndExternalEventId(sessionId, externalEventId).map(this::toDomain);
    }

    @Override
    public List<PlaybookTraceEvent> findEventsBySessionId(String sessionId) {
        return eventRepository.findBySessionIdOrderBySequenceAsc(sessionId).stream().map(this::toDomain).toList();
    }

    @Override
    public long nextSequence(String sessionId) {
        return eventRepository.findMaxSequenceBySessionId(sessionId) + 1;
    }

    private PlaybookSessionEntity toEntity(PlaybookSession session) {
        PlaybookSessionEntity entity = new PlaybookSessionEntity();
        entity.setId(session.getId());
        entity.setPlaybookId(session.getPlaybookId());
        entity.setPlaybookName(session.getPlaybookName());
        entity.setPlaybookVersion(session.getPlaybookVersion());
        entity.setPlaybookSnapshotHash(session.getPlaybookSnapshotHash());
        entity.setUserPrompt(session.getUserPrompt());
        entity.setIntent(session.getIntent());
        entity.setAgentName(session.getAgentName());
        entity.setAgentRunId(session.getAgentRunId());
        entity.setRepositoryIdsJson(jsonCodec.write(session.getRepositoryIds()));
        entity.setRiskLevelSnapshot(session.getRiskLevelSnapshot() == null ? null : session.getRiskLevelSnapshot().name());
        entity.setStopConditionsSnapshotJson(jsonCodec.write(session.getStopConditionsSnapshot()));
        entity.setStatus(session.getStatus().name());
        entity.setCurrentPhase(session.getCurrentPhase().name());
        entity.setParentSessionId(session.getParentSessionId());
        entity.setHandoffFromSessionId(session.getHandoffFromSessionId());
        entity.setHandoffRelation(session.getHandoffRelation());
        entity.setStartedAt(session.getStartedAt());
        entity.setUpdatedAt(session.getUpdatedAt());
        entity.setEndedAt(session.getEndedAt());
        entity.setFinalSummary(session.getFinalSummary());
        entity.setFailureReason(session.getFailureReason());
        return entity;
    }

    private PlaybookSession toDomain(PlaybookSessionEntity entity) {
        return new PlaybookSession()
                .setId(entity.getId())
                .setPlaybookId(entity.getPlaybookId())
                .setPlaybookName(entity.getPlaybookName())
                .setPlaybookVersion(entity.getPlaybookVersion())
                .setPlaybookSnapshotHash(entity.getPlaybookSnapshotHash())
                .setUserPrompt(entity.getUserPrompt())
                .setIntent(entity.getIntent())
                .setAgentName(entity.getAgentName())
                .setAgentRunId(entity.getAgentRunId())
                .setRepositoryIds(jsonCodec.readList(entity.getRepositoryIdsJson(), String.class))
                .setRiskLevelSnapshot(entity.getRiskLevelSnapshot() == null ? null : PlaybookRiskLevel.valueOf(entity.getRiskLevelSnapshot()))
                .setStopConditionsSnapshot(jsonCodec.readList(entity.getStopConditionsSnapshotJson(), String.class))
                .setStatus(PlaybookSessionStatus.valueOf(entity.getStatus()))
                .setCurrentPhase(PlaybookPhase.valueOf(entity.getCurrentPhase()))
                .setParentSessionId(entity.getParentSessionId())
                .setHandoffFromSessionId(entity.getHandoffFromSessionId())
                .setHandoffRelation(entity.getHandoffRelation())
                .setStartedAt(entity.getStartedAt())
                .setUpdatedAt(entity.getUpdatedAt())
                .setEndedAt(entity.getEndedAt())
                .setFinalSummary(entity.getFinalSummary())
                .setFailureReason(entity.getFailureReason());
    }

    private PlaybookTraceEventEntity toEntity(PlaybookTraceEvent event) {
        PlaybookTraceEventEntity entity = new PlaybookTraceEventEntity();
        entity.setId(event.getId());
        entity.setSessionId(event.getSessionId());
        entity.setExternalEventId(event.getExternalEventId());
        entity.setSequence(event.getSequence());
        entity.setPhase(event.getPhase().name());
        entity.setType(event.getType().name());
        entity.setActor(event.getActor());
        entity.setMessage(event.getMessage());
        entity.setRefType(event.getRefType());
        entity.setRefId(event.getRefId());
        entity.setDecision(event.getDecision());
        entity.setReason(event.getReason());
        entity.setObservedRisk(event.getObservedRisk() == null ? null : event.getObservedRisk().name());
        entity.setStopConditionHit(event.isStopConditionHit());
        entity.setStopCondition(event.getStopCondition());
        entity.setPayloadJson(jsonCodec.write(event.getPayload()));
        entity.setRedacted(event.isRedacted());
        entity.setRedactedFieldsJson(jsonCodec.write(event.getRedactedFields()));
        entity.setCreatedAt(event.getCreatedAt());
        return entity;
    }

    private PlaybookTraceEvent toDomain(PlaybookTraceEventEntity entity) {
        return new PlaybookTraceEvent()
                .setId(entity.getId())
                .setSessionId(entity.getSessionId())
                .setExternalEventId(entity.getExternalEventId())
                .setSequence(entity.getSequence())
                .setPhase(PlaybookPhase.valueOf(entity.getPhase()))
                .setType(PlaybookTraceEventType.valueOf(entity.getType()))
                .setActor(entity.getActor())
                .setMessage(entity.getMessage())
                .setRefType(entity.getRefType())
                .setRefId(entity.getRefId())
                .setDecision(entity.getDecision())
                .setReason(entity.getReason())
                .setObservedRisk(entity.getObservedRisk() == null ? null : PlaybookRiskLevel.valueOf(entity.getObservedRisk()))
                .setStopConditionHit(entity.isStopConditionHit())
                .setStopCondition(entity.getStopCondition())
                .setPayload(jsonCodec.readMap(entity.getPayloadJson()))
                .setRedacted(entity.isRedacted())
                .setRedactedFields(jsonCodec.readList(entity.getRedactedFieldsJson(), String.class))
                .setCreatedAt(entity.getCreatedAt());
    }
}
