package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.exception.ActionDockErrorCodes;
import org.team4u.actiondock.domain.exception.ActionDockException;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.domain.model.PlaybookPhase;
import org.team4u.actiondock.domain.model.PlaybookSession;
import org.team4u.actiondock.domain.model.PlaybookSessionStatus;
import org.team4u.actiondock.domain.model.PlaybookTraceEvent;
import org.team4u.actiondock.domain.model.PlaybookTraceEventType;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PlaybookRepository;
import org.team4u.actiondock.domain.port.PlaybookSessionRepository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import java.util.stream.Stream;

public class PlaybookSessionApplicationService {
    private static final List<String> SENSITIVE_KEYS = List.of(
            "token", "secret", "password", "authorization", "cookie", "apikey", "accesskey"
    );

    private final PlaybookRepository playbookRepository;
    private final PlaybookSessionRepository sessionRepository;
    private final JsonCodec jsonCodec;

    public PlaybookSessionApplicationService(PlaybookRepository playbookRepository,
                                             PlaybookSessionRepository sessionRepository,
                                             JsonCodec jsonCodec) {
        this.playbookRepository = playbookRepository;
        this.sessionRepository = sessionRepository;
        this.jsonCodec = jsonCodec;
    }

    public PlaybookSession startSession(String playbookId, PlaybookSession request, Map<String, Object> selectedFrom) {
        Playbook playbook = playbookRepository.findById(ApplicationServiceSupport.normalize(playbookId, "playbookId 不能为空"))
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.PLAYBOOK_NOT_FOUND,
                        "任务手册不存在: " + playbookId,
                        Map.of("playbookId", playbookId)
                ));
        LocalDateTime now = LocalDateTime.now();
        PlaybookSession session = new PlaybookSession()
                .setId(UUID.randomUUID().toString())
                .setPlaybookId(playbook.getId())
                .setPlaybookName(playbook.getName())
                .setPlaybookVersion(playbook.getUpdatedAt() == null ? null : playbook.getUpdatedAt().toString())
                .setPlaybookSnapshotHash(snapshotHash(playbook))
                .setUserPrompt(blankToNull(request == null ? null : request.getUserPrompt()))
                .setIntent(blankToNull(request == null ? null : request.getIntent()))
                .setAgentName(blankToNull(request == null ? null : request.getAgentName()))
                .setAgentRunId(blankToNull(request == null ? null : request.getAgentRunId()))
                .setRepositoryIds(playbook.getRepositoryIds())
                .setRiskLevelSnapshot(playbook.getRiskLevel())
                .setStopConditionsSnapshot(playbook.getStopConditions())
                .setStatus(PlaybookSessionStatus.RUNNING)
                .setCurrentPhase(PlaybookPhase.ROUTE)
                .setParentSessionId(blankToNull(request == null ? null : request.getParentSessionId()))
                .setHandoffFromSessionId(blankToNull(request == null ? null : request.getHandoffFromSessionId()))
                .setHandoffRelation(blankToNull(request == null ? null : request.getHandoffRelation()))
                .setStartedAt(now)
                .setUpdatedAt(now);
        PlaybookSession saved = sessionRepository.saveSession(session);
        Map<String, Object> payload = selectedFrom == null ? new LinkedHashMap<>() : new LinkedHashMap<>(selectedFrom);
        appendEvent(saved.getId(), new PlaybookTraceEvent()
                .setPhase(PlaybookPhase.ROUTE)
                .setType(PlaybookTraceEventType.SESSION_STARTED)
                .setActor("system")
                .setRefType("playbook")
                .setRefId(playbook.getId())
                .setDecision("started")
                .setPayload(payload));
        return getSession(saved.getId());
    }

    public PlaybookTraceEvent appendEvent(String sessionId, PlaybookTraceEvent event) {
        PlaybookSession session = getSession(sessionId);
        if (session.isClosed()) {
            throw ActionDockException.conflict(
                    ActionDockErrorCodes.PLAYBOOK_SESSION_CLOSED,
                    "Playbook Session 已结束，不能继续追加事件",
                    Map.of("sessionId", sessionId, "status", session.getStatus().name())
            );
        }
        String externalEventId = blankToNull(event.getExternalEventId());
        if (externalEventId != null) {
            var existing = sessionRepository.findEventBySessionIdAndExternalEventId(sessionId, externalEventId);
            if (existing.isPresent()) {
                return existing.get();
            }
        }
        LocalDateTime now = LocalDateTime.now();
        PlaybookTraceEvent normalized = normalizeEvent(event)
                .setId(UUID.randomUUID().toString())
                .setSessionId(sessionId)
                .setExternalEventId(externalEventId)
                .setSequence(sessionRepository.nextSequence(sessionId))
                .setCreatedAt(now);
        PlaybookTraceEvent saved = sessionRepository.saveEvent(normalized);
        session.setCurrentPhase(saved.getPhase()).setUpdatedAt(now);
        sessionRepository.saveSession(session);
        return saved;
    }

    public PlaybookSession completeSession(String sessionId,
                                           PlaybookSessionStatus status,
                                           String finalSummary,
                                           String failureReason) {
        PlaybookSession session = getSession(sessionId);
        if (session.isClosed()) {
            return session;
        }
        PlaybookSessionStatus terminalStatus = status == null ? PlaybookSessionStatus.COMPLETED : status;
        if (!isTerminal(terminalStatus)) {
            throw new IllegalArgumentException("status 必须是终态");
        }
        LocalDateTime now = LocalDateTime.now();
        session.setStatus(terminalStatus)
                .setFinalSummary(blankToNull(finalSummary))
                .setFailureReason(blankToNull(failureReason))
                .setUpdatedAt(now)
                .setEndedAt(now);
        PlaybookSession saved = sessionRepository.saveSession(session);
        sessionRepository.saveEvent(normalizeEvent(new PlaybookTraceEvent()
                .setPhase(terminalStatus == PlaybookSessionStatus.HANDED_OFF ? PlaybookPhase.HANDOFF : saved.getCurrentPhase())
                .setType(toLifecycleEventType(terminalStatus))
                .setActor("system")
                .setDecision(terminalStatus.name().toLowerCase(Locale.ROOT))
                .setMessage(saved.getFinalSummary())
                .setReason(saved.getFailureReason()))
                .setId(UUID.randomUUID().toString())
                .setSessionId(sessionId)
                .setSequence(sessionRepository.nextSequence(sessionId))
                .setCreatedAt(now));
        return getSession(sessionId);
    }

    public PlaybookSession getSession(String id) {
        return sessionRepository.findSessionById(ApplicationServiceSupport.normalize(id, "sessionId 不能为空"))
                .orElseThrow(() -> ActionDockException.notFound(
                        ActionDockErrorCodes.PLAYBOOK_SESSION_NOT_FOUND,
                        "Playbook Session 不存在: " + id,
                        Map.of("sessionId", id)
                ));
    }

    public List<PlaybookSession> listSessions(String playbookId,
                                              PlaybookSessionStatus status,
                                              String agentRunId,
                                              String intent) {
        String normalizedPlaybookId = blankToNull(playbookId);
        String normalizedAgentRunId = blankToNull(agentRunId);
        Pattern intentPattern = compileIntentPattern(intent);
        return sessionRepository.findAllSessions().stream()
                .filter(session -> normalizedPlaybookId == null || normalizedPlaybookId.equals(session.getPlaybookId()))
                .filter(session -> status == null || status == session.getStatus())
                .filter(session -> normalizedAgentRunId == null || normalizedAgentRunId.equals(session.getAgentRunId()))
                .filter(session -> intentPattern == null || matchesIntent(intentPattern, session))
                .toList();
    }

    public List<PlaybookTraceEvent> listEvents(String sessionId) {
        getSession(sessionId);
        return sessionRepository.findEventsBySessionId(sessionId);
    }

    private PlaybookTraceEvent normalizeEvent(PlaybookTraceEvent event) {
        if (event == null) {
            throw new IllegalArgumentException("event 不能为空");
        }
        if (event.getPhase() == null) {
            throw new IllegalArgumentException("phase 不能为空");
        }
        if (event.getType() == null) {
            throw new IllegalArgumentException("type 不能为空");
        }
        RedactionResult message = redactString(blankToNull(event.getMessage()), "message");
        RedactionResult reason = redactString(blankToNull(event.getReason()), "reason");
        RedactionResult payload = redactMap(event.getPayload(), "payload");
        List<String> fields = new ArrayList<>();
        fields.addAll(message.fields());
        fields.addAll(reason.fields());
        fields.addAll(payload.fields());
        boolean hit = event.isStopConditionHit() || event.getType() == PlaybookTraceEventType.STOP_CONDITION_HIT;
        return event
                .setActor(Objects.requireNonNullElse(blankToNull(event.getActor()), "agent"))
                .setMessage((String) message.value())
                .setReason((String) reason.value())
                .setRefType(blankToNull(event.getRefType()))
                .setRefId(blankToNull(event.getRefId()))
                .setDecision(blankToNull(event.getDecision()))
                .setStopCondition(blankToNull(event.getStopCondition()))
                .setStopConditionHit(hit)
                .setPayload(castMap(payload.value()))
                .setRedacted(!fields.isEmpty())
                .setRedactedFields(fields.stream().distinct().toList());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> castMap(Object value) {
        return value instanceof Map<?, ?> map ? new LinkedHashMap<>((Map<String, Object>) map) : new LinkedHashMap<>();
    }

    private String snapshotHash(Playbook playbook) {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("id", playbook.getId());
        snapshot.put("name", playbook.getName());
        snapshot.put("description", playbook.getDescription());
        snapshot.put("tags", playbook.getTags());
        snapshot.put("riskLevel", playbook.getRiskLevel());
        snapshot.put("repositoryIds", playbook.getRepositoryIds());
        snapshot.put("knowledgeRefs", playbook.getKnowledgeRefs());
        snapshot.put("scriptRefs", playbook.getScriptRefs());
        snapshot.put("agentSkillRefs", playbook.getAgentSkillRefs());
        snapshot.put("relatedPlaybookRefs", playbook.getRelatedPlaybookRefs());
        snapshot.put("guideMarkdown", playbook.getGuideMarkdown());
        snapshot.put("stopConditions", playbook.getStopConditions());
        return sha256(jsonCodec.write(snapshot));
    }

    private String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    private PlaybookTraceEventType toLifecycleEventType(PlaybookSessionStatus status) {
        return switch (status) {
            case COMPLETED -> PlaybookTraceEventType.SESSION_COMPLETED;
            case FAILED -> PlaybookTraceEventType.SESSION_FAILED;
            default -> PlaybookTraceEventType.SESSION_STOPPED;
        };
    }

    private boolean isTerminal(PlaybookSessionStatus status) {
        return status == PlaybookSessionStatus.STOPPED
                || status == PlaybookSessionStatus.HANDED_OFF
                || status == PlaybookSessionStatus.COMPLETED
                || status == PlaybookSessionStatus.FAILED
                || status == PlaybookSessionStatus.CANCELLED;
    }

    private RedactionResult redactMap(Map<String, Object> value, String path) {
        Map<String, Object> result = new LinkedHashMap<>();
        List<String> fields = new ArrayList<>();
        if (value == null) {
            return new RedactionResult(result, fields);
        }
        for (Map.Entry<String, Object> entry : value.entrySet()) {
            String keyPath = path + "." + entry.getKey();
            if (isSensitiveKey(entry.getKey())) {
                result.put(entry.getKey(), "[REDACTED]");
                fields.add(keyPath);
            } else {
                RedactionResult nested = redactValue(entry.getValue(), keyPath);
                result.put(entry.getKey(), nested.value());
                fields.addAll(nested.fields());
            }
        }
        return new RedactionResult(result, fields);
    }

    private RedactionResult redactValue(Object value, String path) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = new LinkedHashMap<>();
            map.forEach((key, nestedValue) -> copy.put(String.valueOf(key), nestedValue));
            return redactMap(copy, path);
        }
        if (value instanceof List<?> list) {
            List<Object> values = new ArrayList<>();
            List<String> fields = new ArrayList<>();
            for (int index = 0; index < list.size(); index++) {
                RedactionResult nested = redactValue(list.get(index), path + "[" + index + "]");
                values.add(nested.value());
                fields.addAll(nested.fields());
            }
            return new RedactionResult(values, fields);
        }
        return new RedactionResult(value, List.of());
    }

    private RedactionResult redactString(String value, String field) {
        if (value == null) {
            return new RedactionResult(null, List.of());
        }
        String lower = value.toLowerCase(Locale.ROOT);
        if (SENSITIVE_KEYS.stream().anyMatch(lower::contains)) {
            return new RedactionResult("[REDACTED]", List.of(field));
        }
        return new RedactionResult(value, List.of());
    }

    private boolean isSensitiveKey(String key) {
        String lower = key == null ? "" : key.toLowerCase(Locale.ROOT).replace("_", "").replace("-", "");
        return SENSITIVE_KEYS.stream().anyMatch(lower::contains);
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private Pattern compileIntentPattern(String intent) {
        String normalized = blankToNull(intent);
        if (normalized == null) {
            return null;
        }
        try {
            return Pattern.compile(normalized, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
        } catch (PatternSyntaxException exception) {
            throw new IllegalArgumentException("intent 正则表达式不合法: " + exception.getDescription(), exception);
        }
    }

    private boolean matchesIntent(Pattern pattern, PlaybookSession session) {
        return Stream.of(
                        session.getId(),
                        session.getPlaybookId(),
                        session.getPlaybookName(),
                        session.getUserPrompt(),
                        session.getIntent(),
                        session.getAgentName(),
                        session.getAgentRunId(),
                        session.getStatus(),
                        session.getCurrentPhase()
                )
                .filter(Objects::nonNull)
                .map(String::valueOf)
                .anyMatch(value -> pattern.matcher(value).find());
    }

    private record RedactionResult(Object value, List<String> fields) {
    }
}
