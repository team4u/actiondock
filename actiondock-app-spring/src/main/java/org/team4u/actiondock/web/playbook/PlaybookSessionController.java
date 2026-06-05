package org.team4u.actiondock.web.playbook;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.PlaybookSessionApplicationService;
import org.team4u.actiondock.domain.model.PlaybookSession;
import org.team4u.actiondock.domain.model.PlaybookTraceEvent;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class PlaybookSessionController {
    private final PlaybookSessionApplicationService service;

    public PlaybookSessionController(PlaybookSessionApplicationService service) {
        this.service = service;
    }

    @PostMapping("/api/playbooks/{playbookId}/sessions")
    public ApiResponse<PlaybookSession> startSession(@PathVariable String playbookId,
                                                     @RequestBody(required = false) PlaybookSessionStartRequest request) {
        PlaybookSessionStartRequest safeRequest = request == null ? new PlaybookSessionStartRequest() : request;
        PlaybookSession session = new PlaybookSession()
                .setUserPrompt(safeRequest.getUserPrompt())
                .setIntent(safeRequest.getIntent())
                .setAgentName(safeRequest.getAgentName())
                .setAgentRunId(safeRequest.getAgentRunId())
                .setParentSessionId(safeRequest.getParentSessionId())
                .setHandoffFromSessionId(safeRequest.getHandoffFromSessionId())
                .setHandoffRelation(safeRequest.getHandoffRelation());
        return ApiResponse.success(service.startSession(playbookId, session, selectedFrom(safeRequest)));
    }

    @PostMapping("/api/playbook-sessions/{sessionId}/events")
    public ApiResponse<PlaybookTraceEventAppendResponse> appendEvent(@PathVariable String sessionId,
                                                                     @RequestBody PlaybookTraceEventRequest request) {
        PlaybookTraceEvent event = service.appendEvent(sessionId, toEvent(request));
        return ApiResponse.success(new PlaybookTraceEventAppendResponse(event.getId(), event.getSessionId(), event.getSequence()));
    }

    @GetMapping("/api/playbook-sessions/{sessionId}")
    public ApiResponse<PlaybookSessionDetailView> getSession(@PathVariable String sessionId) {
        return ApiResponse.success(new PlaybookSessionDetailView(
                service.getSession(sessionId),
                service.listEvents(sessionId)
        ));
    }

    @PostMapping("/api/playbook-sessions/{sessionId}/complete")
    public ApiResponse<PlaybookSession> completeSession(@PathVariable String sessionId,
                                                        @RequestBody(required = false) PlaybookSessionCompleteRequest request) {
        PlaybookSessionCompleteRequest safeRequest = request == null ? new PlaybookSessionCompleteRequest() : request;
        return ApiResponse.success(service.completeSession(
                sessionId,
                safeRequest.getStatus(),
                safeRequest.getFinalSummary(),
                safeRequest.getFailureReason()
        ));
    }

    private Map<String, Object> selectedFrom(PlaybookSessionStartRequest request) {
        Map<String, Object> payload = request.getSelectedFrom() == null
                ? new LinkedHashMap<>()
                : new LinkedHashMap<>(request.getSelectedFrom());
        if (request.getCandidatePlaybookIds() != null && !request.getCandidatePlaybookIds().isEmpty()) {
            payload.putIfAbsent("candidatePlaybookIds", request.getCandidatePlaybookIds());
        }
        if (request.getIntent() != null && !request.getIntent().isBlank()) {
            payload.putIfAbsent("intent", request.getIntent());
        }
        return payload;
    }

    private PlaybookTraceEvent toEvent(PlaybookTraceEventRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("event 不能为空");
        }
        return new PlaybookTraceEvent()
                .setExternalEventId(request.getExternalEventId())
                .setPhase(request.getPhase())
                .setType(request.getType())
                .setActor(request.getActor())
                .setMessage(request.getMessage())
                .setRefType(request.getRefType())
                .setRefId(request.getRefId())
                .setDecision(request.getDecision())
                .setReason(request.getReason())
                .setObservedRisk(request.getObservedRisk())
                .setStopConditionHit(Boolean.TRUE.equals(request.getStopConditionHit()))
                .setStopCondition(request.getStopCondition())
                .setPayload(request.getPayload());
    }
}
