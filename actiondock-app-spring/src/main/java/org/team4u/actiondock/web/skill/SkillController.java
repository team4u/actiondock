package org.team4u.actiondock.web.skill;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.team4u.actiondock.skill.GithubSkillCollectionService;
import org.team4u.actiondock.skill.SkillService;
import org.team4u.actiondock.skill.SkillTypes;
import org.team4u.actiondock.web.common.ApiResponse;

import java.io.IOException;
import java.util.List;

@RestController
@RequestMapping("/api/skills")
public class SkillController {
    private final SkillService skillService;
    private final GithubSkillCollectionService githubSkillCollectionService;

    public SkillController(SkillService skillService,
                           GithubSkillCollectionService githubSkillCollectionService) {
        this.skillService = skillService;
        this.githubSkillCollectionService = githubSkillCollectionService;
    }

    @GetMapping
    public ApiResponse<List<SkillTypes.SkillListItem>> list() {
        return ApiResponse.success(skillService.listSkills());
    }

    @GetMapping("/{skillId}")
    public ApiResponse<SkillTypes.SkillListItem> get(@PathVariable String skillId) {
        return ApiResponse.success(skillService.getSkill(skillId));
    }

    @GetMapping("/{skillId}/detail")
    public ApiResponse<SkillTypes.SkillDetail> detail(@PathVariable String skillId) {
        return ApiResponse.success(skillService.getSkillDetail(skillId));
    }

    @GetMapping("/{skillId}/archive")
    public ResponseEntity<byte[]> archive(@PathVariable String skillId) {
        SkillTypes.SkillArchive archive = skillService.exportSkillArchive(skillId);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + archive.fileName() + "\"")
                .body(archive.content());
    }

    @GetMapping("/{skillId}/preview")
    public ApiResponse<SkillTypes.SkillFilePreview> preview(@PathVariable String skillId,
                                                              @RequestParam String path) {
        return ApiResponse.success(skillService.previewSkillFile(skillId, path));
    }

    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<SkillTypes.SkillListItem> importZip(@RequestParam("targetIds") List<String> targetIds,
                                                    @RequestParam("file") MultipartFile file) throws IOException {
        return ApiResponse.success(
                skillService.installFromZip(targetIds, file.getOriginalFilename(), file.getBytes()),
                "Skill 安装成功"
        );
    }

    @PostMapping("/validate")
    public ApiResponse<SkillTypes.SkillValidationResult> validate(@RequestParam("file") MultipartFile file) throws IOException {
        return ApiResponse.success(skillService.validateImport(file.getOriginalFilename(), file.getBytes()));
    }

    @PostMapping("/package")
    public ApiResponse<SkillTypes.SkillPackageResult> packageDirectory(@RequestBody SkillDirectoryRequest request) {
        return ApiResponse.success(skillService.packageDirectory(request.getDirectory()));
    }

    @PostMapping("/install-directory")
    public ApiResponse<SkillTypes.SkillListItem> installDirectory(@RequestBody SkillDirectoryInstallRequest request) {
        return ApiResponse.success(
                skillService.installFromDirectory(request.getTargetIds(), request.getDirectory()),
                "Skill 安装成功"
        );
    }

    @PostMapping("/github/scan")
    public ApiResponse<GithubSkillCollectionService.GithubSkillScanResponse> scanGithubCollection(@RequestBody GithubSkillScanRequest request) {
        return ApiResponse.success(githubSkillCollectionService.scan(request.getUrl()));
    }

    @PostMapping("/github/install")
    public ApiResponse<GithubSkillCollectionService.GithubSkillInstallResponse> installGithubCollection(@RequestBody GithubSkillInstallRequest request) {
        return ApiResponse.success(
                githubSkillCollectionService.install(request.getUrl(), request.getTargetIds(), request.getSkillPaths()),
                "GitHub Skill 安装完成"
        );
    }

    @PostMapping(value = "/install-archive", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<SkillTypes.SkillListItem> installArchive(@RequestParam("targetIds") List<String> targetIds,
                                                              @RequestParam(value = "repositoryId", required = false) String repositoryId,
                                                              @RequestParam("archive") MultipartFile archive) throws IOException {
        return ApiResponse.success(
                skillService.installArchive(targetIds, repositoryId, archive.getOriginalFilename(), archive.getBytes()),
                "Skill 安装成功"
        );
    }

    @PostMapping("/{skillId}/update")
    public ApiResponse<SkillTypes.SkillListItem> update(@PathVariable String skillId,
                                                 @RequestBody SkillDirectoryRequest request) {
        return ApiResponse.success(
                skillService.updateSkill(skillId, request.getDirectory()),
                "Skill 更新成功"
        );
    }

    @PostMapping("/{skillId}/version")
    public ApiResponse<SkillTypes.SkillListItem> updateVersion(@PathVariable String skillId,
                                                                 @RequestBody SkillVersionUpdateRequest request) {
        return ApiResponse.success(
                skillService.updateSkillVersion(skillId, request.getVersion()),
                "Skill 版本已更新"
        );
    }

    @PostMapping("/{skillId}/disable")
    public ApiResponse<SkillTypes.SkillListItem> disable(@PathVariable String skillId) {
        return ApiResponse.success(
                skillService.disableSkill(skillId),
                "Skill 已停用"
        );
    }

    @PostMapping("/{skillId}/restore")
    public ApiResponse<SkillTypes.SkillListItem> restore(@PathVariable String skillId) {
        return ApiResponse.success(
                skillService.restoreSkill(skillId),
                "Skill 已恢复"
        );
    }

    @DeleteMapping("/{skillId}")
    public ApiResponse<Void> uninstall(@PathVariable String skillId) {
        skillService.uninstallSkill(skillId);
        return ApiResponse.success(null, "Skill 已卸载");
    }

    @DeleteMapping("/{skillId}/targets/{targetId}")
    public ApiResponse<Void> removeTarget(@PathVariable String skillId, @PathVariable String targetId) {
        skillService.removeSkillFromTarget(skillId, targetId);
        return ApiResponse.success(null, "Skill 已从目标移除");
    }
}
