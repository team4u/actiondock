package org.team4u.actiondock.web.playbook;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.application.PlaybookApplicationService;
import org.team4u.actiondock.domain.model.Playbook;
import org.team4u.actiondock.web.common.ApiResponse;
import org.team4u.actiondock.web.common.IntentFilter;

import java.util.List;

@RestController
public class PlaybookController {
    private final PlaybookApplicationService playbookService;

    public PlaybookController(PlaybookApplicationService playbookService) {
        this.playbookService = playbookService;
    }

    @GetMapping("/api/playbooks")
    public ApiResponse<List<Playbook>> listPlaybooks(@RequestParam(required = false) String repositoryId,
                                                     @RequestParam(required = false) String tag,
                                                     @RequestParam(required = false) Boolean enabled,
                                                     @RequestParam(required = false) Boolean managed,
                                                     @RequestParam(required = false) String intent) {
        return ApiResponse.success(IntentFilter.filter(
                playbookService.listPlaybooks(repositoryId, tag, enabled, managed),
                intent,
                Playbook::getId,
                Playbook::getName,
                Playbook::getDescription,
                Playbook::getTags,
                Playbook::getRiskLevel,
                Playbook::getRepositoryIds,
                Playbook::getStopConditions
        ));
    }

    @PostMapping("/api/playbooks")
    public ApiResponse<Playbook> createPlaybook(@RequestBody Playbook playbook) {
        return ApiResponse.success(playbookService.savePlaybook(playbook));
    }

    @GetMapping("/api/playbooks/{id}")
    public ApiResponse<Playbook> getPlaybook(@PathVariable String id) {
        return ApiResponse.success(playbookService.getPlaybook(id));
    }

    @PutMapping("/api/playbooks/{id}")
    public ApiResponse<Playbook> updatePlaybook(@PathVariable String id, @RequestBody Playbook playbook) {
        return ApiResponse.success(playbookService.updatePlaybook(id, playbook));
    }

    @DeleteMapping("/api/playbooks/{id}")
    public ApiResponse<Void> deletePlaybook(@PathVariable String id) {
        playbookService.deletePlaybook(id);
        return ApiResponse.success(null);
    }
}
