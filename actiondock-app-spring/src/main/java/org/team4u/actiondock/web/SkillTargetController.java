package org.team4u.actiondock.web;

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
import org.team4u.actiondock.skill.SkillService;

import java.util.List;

@RestController
@RequestMapping("/api/skill-targets")
public class SkillTargetController {
    private final SkillService skillService;

    public SkillTargetController(SkillService skillService) {
        this.skillService = skillService;
    }

    @GetMapping
    public ApiResponse<List<SkillTarget>> list() {
        return ApiResponse.success(skillService.listTargets());
    }

    @PostMapping
    public ApiResponse<SkillTarget> create(@RequestBody SkillTarget request) {
        return ApiResponse.success(skillService.saveTarget(request), "SkillTarget 已创建");
    }

    @PutMapping("/{targetId}")
    public ApiResponse<SkillTarget> update(@PathVariable String targetId, @RequestBody SkillTarget request) {
        request.setId(targetId);
        return ApiResponse.success(skillService.saveTarget(request), "SkillTarget 已更新");
    }

    @DeleteMapping("/{targetId}")
    public ApiResponse<Void> delete(@PathVariable String targetId) {
        skillService.deleteTarget(targetId);
        return ApiResponse.success(null, "SkillTarget 已删除");
    }

    @PostMapping("/{targetId}/scan")
    public ApiResponse<List<SkillService.SkillScanItem>> scan(@PathVariable String targetId) {
        return ApiResponse.success(skillService.scanTarget(targetId));
    }

    @GetMapping("/{targetId}/scan/{directoryId}")
    public ApiResponse<SkillService.SkillScanDetail> getScanItemDetail(@PathVariable String targetId,
                                                                        @PathVariable String directoryId) {
        return ApiResponse.success(skillService.getScanItemDetail(targetId, directoryId));
    }

    @GetMapping("/{targetId}/scan/{directoryId}/preview")
    public ApiResponse<SkillService.SkillFilePreview> previewScanItemFile(@PathVariable String targetId,
                                                                           @PathVariable String directoryId,
                                                                           @RequestParam String path) {
        return ApiResponse.success(skillService.previewScanItemFile(targetId, directoryId, path));
    }

    @DeleteMapping("/{targetId}/scan/{directoryId}")
    public ApiResponse<Void> deleteScanDirectory(@PathVariable String targetId,
                                                  @PathVariable String directoryId) {
        skillService.deleteUnmanagedScanDirectory(targetId, directoryId);
        return ApiResponse.success(null, "目录已删除");
    }
}
