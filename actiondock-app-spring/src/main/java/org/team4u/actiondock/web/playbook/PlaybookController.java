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
import org.team4u.actiondock.domain.model.PlaybookGroup;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.List;

@RestController
public class PlaybookController {
    private final PlaybookApplicationService playbookService;

    public PlaybookController(PlaybookApplicationService playbookService) {
        this.playbookService = playbookService;
    }

    @GetMapping("/api/playbook-groups")
    public ApiResponse<List<PlaybookGroupView>> listGroups() {
        return ApiResponse.success(toGroupViews(playbookService.listGroups()));
    }

    @PostMapping("/api/playbook-groups")
    public ApiResponse<PlaybookGroupView> createGroup(@RequestBody PlaybookGroup group) {
        return ApiResponse.success(toGroupView(playbookService.saveGroup(group)));
    }

    @GetMapping("/api/playbook-groups/{id}")
    public ApiResponse<PlaybookGroupView> getGroup(@PathVariable String id) {
        return ApiResponse.success(toGroupView(playbookService.getGroup(id)));
    }

    @PutMapping("/api/playbook-groups/{id}")
    public ApiResponse<PlaybookGroupView> updateGroup(@PathVariable String id, @RequestBody PlaybookGroup group) {
        group.setId(id);
        return ApiResponse.success(toGroupView(playbookService.saveGroup(group)));
    }

    @DeleteMapping("/api/playbook-groups/{id}")
    public ApiResponse<Void> deleteGroup(@PathVariable String id) {
        playbookService.deleteGroup(id);
        return ApiResponse.success(null);
    }

    @GetMapping("/api/playbooks")
    public ApiResponse<List<Playbook>> listPlaybooks(@RequestParam(required = false) String groupId,
                                                     @RequestParam(required = false) String repositoryId,
                                                     @RequestParam(required = false) String tag,
                                                     @RequestParam(required = false) Boolean enabled,
                                                     @RequestParam(required = false) Boolean managed,
                                                     @RequestParam(required = false) String keyword) {
        return ApiResponse.success(playbookService.listPlaybooks(groupId, repositoryId, tag, enabled, managed, keyword));
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

    private List<PlaybookGroupView> toGroupViews(List<PlaybookGroup> groups) {
        return groups.stream().map(this::toGroupView).toList();
    }

    private PlaybookGroupView toGroupView(PlaybookGroup group) {
        long playbookCount = playbookService.listPlaybooks(group.getId(), null, null, null, null, null).size();
        return new PlaybookGroupView(
                group.getId(),
                group.getName(),
                group.getDescription(),
                group.getTags(),
                group.getDefaultRepositoryIds(),
                group.isEnabled(),
                group.isManaged(),
                group.getCreatedAt(),
                group.getUpdatedAt(),
                playbookCount
        );
    }
}
