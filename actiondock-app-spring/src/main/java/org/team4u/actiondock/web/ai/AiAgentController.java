package org.team4u.actiondock.web.ai;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.ai.api.AiAgentProfile;
import org.team4u.actiondock.ai.core.AiAgentProfileService;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.List;

@RestController
@RequestMapping("/api/ai/agents")
public class AiAgentController {

    private final AiAgentProfileService agentProfileService;

    public AiAgentController(AiAgentProfileService agentProfileService) {
        this.agentProfileService = agentProfileService;
    }

    @GetMapping
    public ApiResponse<List<AiAgentProfile>> listAgents(@org.springframework.web.bind.annotation.RequestParam(defaultValue = "false") boolean includeManaged) {
        return ApiResponse.success(agentProfileService.list(includeManaged));
    }

    @PostMapping
    public ApiResponse<AiAgentProfile> createAgent(@RequestBody AiAgentProfile profile) {
        return ApiResponse.success(agentProfileService.save(profile));
    }

    @GetMapping("/{id}")
    public ApiResponse<AiAgentProfile> getAgent(@PathVariable String id) {
        return ApiResponse.success(agentProfileService.get(id));
    }

    @PutMapping("/{id}")
    public ApiResponse<AiAgentProfile> updateAgent(@PathVariable String id, @RequestBody AiAgentProfile profile) {
        profile.setId(id);
        return ApiResponse.success(agentProfileService.save(profile));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> deleteAgent(@PathVariable String id) {
        agentProfileService.delete(id);
        return ApiResponse.success(null);
    }
}
