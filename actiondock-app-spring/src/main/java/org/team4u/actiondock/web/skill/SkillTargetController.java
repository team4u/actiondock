package org.team4u.actiondock.web.skill;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.team4u.actiondock.domain.model.SkillTarget;
import org.team4u.actiondock.skill.SkillTargetService;
import org.team4u.actiondock.skill.SkillTypes;
import org.team4u.actiondock.web.common.ApiResponse;

import java.util.List;

@RestController
@RequestMapping("/api/skill-targets")
public class SkillTargetController {
    private final SkillTargetService skillTargetService;

    public SkillTargetController(SkillTargetService skillTargetService) {
        this.skillTargetService = skillTargetService;
    }

    @GetMapping
    public ApiResponse<List<SkillTarget>> list() {
        return ApiResponse.success(skillTargetService.listTargets());
    }

    @PostMapping
    public ApiResponse<SkillTarget> create(@RequestBody SkillTarget request) {
        return ApiResponse.success(skillTargetService.saveTarget(request), "SkillTarget 已创建");
    }

    @PutMapping("/{targetId}")
    public ApiResponse<SkillTarget> update(@PathVariable String targetId, @RequestBody SkillTarget request) {
        request.setId(targetId);
        return ApiResponse.success(skillTargetService.saveTarget(request), "SkillTarget 已更新");
    }

    @DeleteMapping("/{targetId}")
    public ApiResponse<Void> delete(@PathVariable String targetId) {
        skillTargetService.deleteTarget(targetId);
        return ApiResponse.success(null, "SkillTarget 已删除");
    }

    @PostMapping("/{targetId}/scan")
    public ApiResponse<List<SkillTypes.SkillScanItem>> scan(@PathVariable String targetId) {
        return ApiResponse.success(skillTargetService.scanTarget(targetId));
    }

    @GetMapping("/{targetId}/scan/{directoryId}")
    public ApiResponse<SkillTypes.SkillScanDetail> getScanItemDetail(@PathVariable String targetId,
                                                                        @PathVariable String directoryId) {
        return ApiResponse.success(skillTargetService.getScanItemDetail(targetId, directoryId));
    }

    @GetMapping("/{targetId}/scan/{directoryId}/preview")
    public ApiResponse<SkillTypes.SkillFilePreview> previewScanItemFile(@PathVariable String targetId,
                                                                           @PathVariable String directoryId,
                                                                           @RequestParam String path) {
        return ApiResponse.success(skillTargetService.previewScanItemFile(targetId, directoryId, path));
    }

    @DeleteMapping("/{targetId}/scan/{directoryId}")
    public ApiResponse<Void> deleteScanDirectory(@PathVariable String targetId,
                                                  @PathVariable String directoryId) {
        skillTargetService.deleteUnmanagedScanDirectory(targetId, directoryId);
        return ApiResponse.success(null, "目录已删除");
    }

    @PostMapping("/{targetId}/sync-installations")
    public ApiResponse<SkillTypes.SkillSyncResponse> syncInstallations(@PathVariable String targetId,
                                                                         @RequestBody SkillTargetSyncRequest request) {
        return ApiResponse.success(
                skillTargetService.syncSkillsToTarget(targetId, request == null ? List.of() : request.getSkillIds()),
                "Skill 同步完成"
        );
    }
}
