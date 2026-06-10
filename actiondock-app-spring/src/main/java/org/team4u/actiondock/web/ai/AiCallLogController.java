package org.team4u.actiondock.web.ai;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.ai.api.AiCallLog;
import org.team4u.actiondock.ai.api.AiCallLogRepository;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.List;

@RestController
@RequestMapping("/api/ai/calls")
public class AiCallLogController {

    private final AiCallLogRepository callLogRepository;

    public AiCallLogController(AiCallLogRepository callLogRepository) {
        this.callLogRepository = callLogRepository;
    }

    @GetMapping
    public ApiResponse<List<AiCallLog>> listCalls() {
        return ApiResponse.success(callLogRepository.findAll());
    }
}
