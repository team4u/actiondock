package org.team4u.actiondock.web;

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
import org.team4u.actiondock.domain.model.SkillInstallation;
import org.team4u.actiondock.skill.SkillService;

import java.io.IOException;
import java.util.List;

@RestController
@RequestMapping("/api/skills")
public class SkillController {
    private final SkillService skillService;

    public SkillController(SkillService skillService) {
        this.skillService = skillService;
    }

    @GetMapping
    public ApiResponse<List<SkillInstallation>> list() {
        return ApiResponse.success(skillService.listInstallations());
    }

    @GetMapping("/{installationId}")
    public ApiResponse<SkillInstallation> get(@PathVariable String installationId) {
        return ApiResponse.success(skillService.getInstallation(installationId));
    }

    @GetMapping("/{installationId}/detail")
    public ApiResponse<SkillService.SkillDetail> detail(@PathVariable String installationId) {
        return ApiResponse.success(skillService.getInstallationDetail(installationId));
    }

    @GetMapping("/{installationId}/archive")
    public ResponseEntity<byte[]> archive(@PathVariable String installationId) {
        SkillService.SkillArchive archive = skillService.exportInstallationArchive(installationId);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + archive.fileName() + "\"")
                .body(archive.content());
    }

    @GetMapping("/{installationId}/preview")
    public ApiResponse<SkillService.SkillFilePreview> preview(@PathVariable String installationId,
                                                              @RequestParam String path) {
        return ApiResponse.success(skillService.previewInstallationFile(installationId, path));
    }

    @PostMapping("/import")
    public ApiResponse<SkillInstallation> importZip(@RequestParam("targetId") String targetId,
                                                    @RequestParam("file") MultipartFile file) throws IOException {
        return ApiResponse.success(
                skillService.installFromZip(targetId, file.getOriginalFilename(), file.getBytes()),
                "Skill 安装成功"
        );
    }

    @PostMapping("/validate")
    public ApiResponse<SkillService.SkillValidationResult> validate(@RequestParam("file") MultipartFile file) throws IOException {
        return ApiResponse.success(skillService.validateImport(file.getOriginalFilename(), file.getBytes()));
    }

    @PostMapping("/package")
    public ApiResponse<SkillService.SkillPackageResult> packageDirectory(@RequestBody SkillDirectoryRequest request) {
        return ApiResponse.success(skillService.packageDirectory(request.getDirectory()));
    }

    @PostMapping("/install-directory")
    public ApiResponse<SkillInstallation> installDirectory(@RequestBody SkillDirectoryInstallRequest request) {
        return ApiResponse.success(
                skillService.installFromDirectory(request.getTargetId(), request.getDirectory()),
                "Skill 安装成功"
        );
    }

    @PostMapping("/draft-install")
    public ApiResponse<SkillInstallation> installDraft(@RequestBody SkillDraftInstallRequest request) {
        return ApiResponse.success(
                skillService.installDraft(
                        request.getTargetId(),
                        new SkillService.SkillDraftRequest(
                                request.getRepositoryId(),
                                request.getSkillId(),
                                request.getDisplayName(),
                                request.getVersion(),
                                request.getOwner(),
                                request.getDescription(),
                                request.getTags(),
                                request.getRiskLevel(),
                                request.getContent()
                        )
                ),
                "Skill 安装成功"
        );
    }

    @PostMapping(value = "/draft-install-archive", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<SkillInstallation> installDraftArchive(@RequestParam("targetId") String targetId,
                                                              @RequestParam(value = "repositoryId", required = false) String repositoryId,
                                                              @RequestParam("archive") MultipartFile archive) throws IOException {
        return ApiResponse.success(
                skillService.installArchive(targetId, repositoryId, archive.getOriginalFilename(), archive.getBytes()),
                "Skill 安装成功"
        );
    }

    @PostMapping("/{installationId}/update")
    public ApiResponse<SkillInstallation> update(@PathVariable String installationId,
                                                 @RequestBody SkillDirectoryRequest request) {
        return ApiResponse.success(
                skillService.updateInstallation(installationId, request.getDirectory()),
                "Skill 更新成功"
        );
    }

    @PostMapping("/{installationId}/disable")
    public ApiResponse<SkillInstallation> disable(@PathVariable String installationId) {
        return ApiResponse.success(
                skillService.disableInstallation(installationId),
                "Skill 已停用"
        );
    }

    @PostMapping("/{installationId}/restore")
    public ApiResponse<SkillInstallation> restore(@PathVariable String installationId) {
        return ApiResponse.success(
                skillService.restoreInstallation(installationId),
                "Skill 已恢复"
        );
    }

    @DeleteMapping("/{installationId}")
    public ApiResponse<Void> uninstall(@PathVariable String installationId) {
        skillService.uninstall(installationId);
        return ApiResponse.success(null, "Skill 已卸载");
    }
}
