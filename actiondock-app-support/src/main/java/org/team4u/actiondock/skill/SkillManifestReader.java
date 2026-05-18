package org.team4u.actiondock.skill;

import org.team4u.actiondock.shared.NormalizeUtils;

import org.team4u.actiondock.domain.port.JsonCodec;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Skill 清单读取与校验器，负责解析 SKILL.md frontmatter 和 skill.json，
 * 并生成结构化的校验结果。
 *
 * @author jay.wu
 */
final class SkillManifestReader {

    private static final Pattern FRONTMATTER_PATTERN = Pattern.compile("^---\\s*\\n(.*?)\\n---\\s*(?:\\n|$)", Pattern.DOTALL);
    private static final int MAX_SKILL_MD_SIZE = 100_000;

    private SkillManifestReader() {
    }

    /**
     * 校验 Skill 目录结构并返回验证结果。
     *
     * @param directory       Skill 目录路径
     * @param fallbackId      当 skill.json 不存在时使用的备选 ID
     * @param requireManifest 是否强制要求 skill.json
     * @param jsonCodec       JSON 编解码器
     * @return 校验结果
     */
    static SkillTypes.SkillValidationResult validateSkillDirectory(Path directory,
                                                                            String fallbackId,
                                                                            boolean requireManifest,
                                                                            JsonCodec jsonCodec) {
        Path root = normalizeSkillRoot(directory);
        SkillMdResult skillMdResult = readAndValidateSkillMd(root);
        SkillTypes.SkillManifestFile manifest = readManifest(root, requireManifest, jsonCodec);
        ResolvedFields fields = resolveFields(skillMdResult.frontmatter, manifest, fallbackId);
        List<String> warnings = collectWarnings(skillMdResult.content, skillMdResult.frontmatter, fields.skillId);
        return buildValidationResult(root, fields, manifest, warnings);
    }

    /**
     * 定位 Skill 根目录，自动处理单层子目录包裹的情况。
     */
    static Path locateSkillRoot(Path directory) {
        return normalizeSkillRoot(directory);
    }

    /**
     * 解析 SKILL.md 的 YAML frontmatter，提取 name 和 description。
     */
    static Frontmatter parseFrontmatter(String content) {
        Matcher matcher = FRONTMATTER_PATTERN.matcher(content == null ? "" : content);
        if (!matcher.find()) {
            throw new IllegalArgumentException("SKILL.md 缺少 frontmatter");
        }
        String raw = matcher.group(1);
        String name = null;
        String description = null;
        for (String line : raw.split("\\r?\\n")) {
            int index = line.indexOf(':');
            if (index <= 0) {
                continue;
            }
            String key = line.substring(0, index).trim();
            String value = line.substring(index + 1).trim();
            if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length() - 1);
            }
            if ("name".equals(key)) {
                name = NormalizeUtils.normalizeNullable(value);
            } else if ("description".equals(key)) {
                description = NormalizeUtils.normalizeNullable(value);
            }
        }
        if (NormalizeUtils.isBlank(name)) {
            throw new IllegalArgumentException("SKILL.md frontmatter 缺少 name");
        }
        if (NormalizeUtils.isBlank(description)) {
            throw new IllegalArgumentException("SKILL.md frontmatter 缺少 description");
        }
        return new Frontmatter(name, description);
    }

    static Path normalizeSkillRoot(Path directory) {
        Path root = NormalizeUtils.normalizePath(directory);
        if (root == null || Files.notExists(root)) {
            throw new IllegalArgumentException("Skill 目录不存在");
        }
        if (Files.isRegularFile(root)) {
            throw new IllegalArgumentException("Skill 目录必须是文件夹");
        }
        Path direct = root.resolve(SkillFileUtils.SKILL_MANIFEST_FILE);
        if (Files.exists(direct)) {
            return root;
        }
        try (var stream = Files.list(root)) {
            List<Path> candidates = stream
                    .filter(path -> Files.isDirectory(path) && Files.exists(path.resolve(SkillFileUtils.SKILL_MANIFEST_FILE)))
                    .toList();
            if (candidates.size() == 1) {
                return candidates.get(0);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("读取 Skill 目录失败", exception);
        }
        throw new IllegalArgumentException("Skill 目录中未找到 SKILL.md");
    }

    static String digestDirectory(Path directory) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            List<Path> files;
            try (var stream = Files.walk(directory)) {
                files = stream.filter(path -> Files.isRegularFile(path)
                                && !SkillFileUtils.INSTALL_MARKER_FILE.equals(path.getFileName().toString()))
                        .sorted()
                        .toList();
            }
            for (Path file : files) {
                SkillFileUtils.assertNotSymbolicLink(file);
                digest.update(SkillFileUtils.relativePath(directory, file).getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
                digest.update(Files.readAllBytes(file));
                digest.update((byte) 0);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException | IOException exception) {
            throw new IllegalStateException("计算 Skill 摘要失败", exception);
        }
    }

    private static SkillMdResult readAndValidateSkillMd(Path root) {
        Path skillMdPath = root.resolve(SkillFileUtils.SKILL_MANIFEST_FILE);
        if (Files.notExists(skillMdPath)) {
            throw new IllegalArgumentException("Skill 缺少 SKILL.md");
        }
        String content = SkillFileUtils.readString(skillMdPath);
        Frontmatter frontmatter = parseFrontmatter(content);
        return new SkillMdResult(content, frontmatter);
    }

    private static SkillTypes.SkillManifestFile readManifest(Path root, boolean requireManifest, JsonCodec jsonCodec) {
        Path manifestPath = root.resolve(SkillArchiveManager.SKILL_PACKAGE_FILE);
        SkillTypes.SkillManifestFile manifest = Files.exists(manifestPath)
                ? jsonCodec.read(SkillFileUtils.readString(manifestPath), SkillTypes.SkillManifestFile.class)
                : null;
        if (requireManifest && manifest == null) {
            throw new IllegalArgumentException("Skill 缺少 skill.json");
        }
        return manifest;
    }

    private static ResolvedFields resolveFields(Frontmatter frontmatter,
                                                 SkillTypes.SkillManifestFile manifest,
                                                 String fallbackId) {
        if (manifest != null) {
            return new ResolvedFields(
                    NormalizeUtils.normalize(manifest.skillId(), "skillId 不能为空"),
                    NormalizeUtils.normalize(manifest.displayName(), "displayName 不能为空"),
                    NormalizeUtils.normalize(manifest.version(), SkillFileUtils.ERR_VERSION_REQUIRED),
                    NormalizeUtils.normalize(manifest.description(), "description 不能为空")
            );
        }
        String skillId = NormalizeUtils.normalizeOrDefault(
                NormalizeUtils.normalizeNullable(fallbackId), NormalizeUtils.slugify(frontmatter.name()));
        return new ResolvedFields(
                skillId,
                NormalizeUtils.normalizeOrDefault(frontmatter.name(), skillId),
                "1.0.0",
                NormalizeUtils.normalize(frontmatter.description(), "frontmatter description 不能为空")
        );
    }

    private static List<String> collectWarnings(String content, Frontmatter frontmatter, String skillId) {
        List<String> warnings = new ArrayList<>();
        if (frontmatter.name() != null && !Objects.equals(NormalizeUtils.slugify(frontmatter.name()), skillId)) {
            warnings.add("frontmatter name 规范化后与 skillId 不一致");
        }
        if (content.length() > MAX_SKILL_MD_SIZE) {
            warnings.add("SKILL.md 较大，建议拆分 references");
        }
        return warnings;
    }

    private static SkillTypes.SkillValidationResult buildValidationResult(Path root,
                                                                          ResolvedFields fields,
                                                                          SkillTypes.SkillManifestFile manifest,
                                                                          List<String> warnings) {
        return new SkillTypes.SkillValidationResult(
                fields.skillId,
                fields.displayName,
                fields.version,
                fields.description,
                manifest == null ? null : manifest.owner(),
                manifest == null ? List.of() : NormalizeUtils.nullSafeList(manifest.tags()),
                manifest == null ? null : manifest.riskLevel(),
                manifest == null ? SkillFileUtils.SKILL_MANIFEST_FILE
                        : NormalizeUtils.normalizeOrDefault(manifest.entrypointPath(), SkillFileUtils.SKILL_MANIFEST_FILE),
                digestDirectory(root),
                warnings,
                manifest != null
        );
    }

    /**
     * SKILL.md frontmatter 解析结果。
     *
     * @param name        Skill 名称
     * @param description Skill 描述
     */
    record Frontmatter(String name, String description) {
    }

    private record SkillMdResult(String content, Frontmatter frontmatter) {
    }

    private record ResolvedFields(String skillId, String displayName, String version, String description) {
    }
}
