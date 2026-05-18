package org.team4u.actiondock.skill;

import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.shared.NormalizeUtils;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Skill 归档管理器，负责 ZIP 归档的构建、解压、摘要计算、清单写入和安装标记管理。
 *
 * @author jay.wu
 */
public final class SkillArchiveManager {

    /** Skill 包清单文件名。 */
    public static final String SKILL_PACKAGE_FILE = "skill.json";

    static final long MAX_ARCHIVE_SIZE = 25L * 1024L * 1024L;

    private SkillArchiveManager() {
    }

    public static byte[] requireValidArchive(byte[] content) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("Skill 压缩包不能为空");
        }
        if (content.length > MAX_ARCHIVE_SIZE) {
            throw new IllegalArgumentException("Skill 压缩包过大，超过 " + (MAX_ARCHIVE_SIZE / 1024 / 1024) + "MB");
        }
        return content;
    }

    public static byte[] buildArchive(Path directory,
                                      SkillTypes.SkillValidationResult validation,
                                      String manifestVersion,
                                      JsonCodec jsonCodec) {
        Path root = SkillFileUtils.normalizeSkillRoot(directory);
        String version = NormalizeUtils.normalize(manifestVersion, SkillFileUtils.ERR_VERSION_REQUIRED);
        String digest = computePublishDigest(root, validation, version, jsonCodec);
        byte[] manifestBytes = buildManifestBytes(validation, version, digest, jsonCodec);
        String rootPrefix = validation.skillId() + "/";
        try (ByteArrayOutputStream output = new ByteArrayOutputStream();
             ZipOutputStream zip = new ZipOutputStream(output, StandardCharsets.UTF_8)) {
            zip.putNextEntry(new ZipEntry(rootPrefix + SKILL_PACKAGE_FILE));
            zip.write(manifestBytes);
            zip.closeEntry();
            writeArchiveEntries(zip, root, rootPrefix);
            zip.finish();
            return output.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("打包 Skill 归档失败", exception);
        }
    }

    public static String computePublishDigest(Path directory,
                                              SkillTypes.SkillValidationResult validation,
                                              String manifestVersion,
                                              JsonCodec jsonCodec) {
        Path root = SkillFileUtils.normalizeSkillRoot(directory);
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            boolean manifestSeen = hashDirectoryFiles(digest, root, validation, manifestVersion, jsonCodec);
            if (!manifestSeen) {
                hashManifestEntry(digest, validation, manifestVersion, jsonCodec);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException | IOException exception) {
            throw new IllegalStateException("计算 Skill 发布摘要失败", exception);
        }
    }

    public static void unzipArchive(byte[] content, Path directory) {
        requireValidArchive(content);
        unzipToDirectory(content, directory);
    }

    public static String writeManifest(Path directory,
                                     SkillTypes.SkillValidationResult validation,
                                     String manifestVersion,
                                     JsonCodec jsonCodec) {
        String version = NormalizeUtils.normalize(manifestVersion, SkillFileUtils.ERR_VERSION_REQUIRED);
        String digest = computePublishDigest(directory, validation, version, jsonCodec);
        try {
            Files.write(directory.resolve(SKILL_PACKAGE_FILE), buildManifestBytes(validation, version, digest, jsonCodec));
        } catch (IOException exception) {
            throw new IllegalStateException("写入 Skill 清单失败", exception);
        }
        return digest;
    }

    public static void writeInstallMarker(Path directory,
                                          String installationId,
                                          String repositoryId,
                                          SkillTypes.SkillValidationResult validation,
                                          JsonCodec jsonCodec) throws IOException {
        Map<String, Object> marker = new LinkedHashMap<>();
        marker.put("installationId", installationId);
        marker.put("repositoryId", repositoryId);
        marker.put("skillId", validation.skillId());
        marker.put("version", validation.version());
        marker.put("digest", validation.digest());
        marker.put("installedAt", LocalDateTime.now().toString());
        Files.writeString(directory.resolve(SkillFileUtils.INSTALL_MARKER_FILE), jsonCodec.write(marker), StandardCharsets.UTF_8);
    }

    public static Map<String, Object> readInstallMarker(Path directory, JsonCodec jsonCodec) {
        Path markerPath = directory.resolve(SkillFileUtils.INSTALL_MARKER_FILE);
        if (Files.notExists(markerPath)) {
            return null;
        }
        return jsonCodec.read(SkillFileUtils.readString(markerPath), LinkedHashMap.class);
    }

    static void unzipToDirectory(byte[] content, Path directory) {
        unzipToDirectory(content, directory, MAX_ARCHIVE_SIZE, "Skill 压缩包");
    }

    static void unzipToDirectory(byte[] content, Path directory, long maxSize, String contextName) {
        try {
            Files.createDirectories(directory);
            try (InputStream inputStream = new ByteArrayInputStream(content);
                 ZipInputStream zipInputStream = new ZipInputStream(inputStream, StandardCharsets.UTF_8)) {
                extractZipEntries(zipInputStream, directory, maxSize, contextName);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("解压 " + contextName + "失败", exception);
        }
    }

    static String normalizeArchiveFallbackId(String fileName) {
        String normalized = NormalizeUtils.normalizeNullable(fileName);
        if (normalized == null) {
            return null;
        }
        if (normalized.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")) {
            normalized = normalized.substring(0, normalized.length() - 4);
        }
        return NormalizeUtils.normalizeNullable(normalized);
    }

    private static byte[] buildManifestBytes(SkillTypes.SkillValidationResult validation,
                                     String version,
                                     String digest,
                                     JsonCodec jsonCodec) {
        return jsonCodec.write(new SkillTypes.SkillManifestFile(
                1,
                validation.skillId(),
                validation.displayName(),
                NormalizeUtils.normalize(version, SkillFileUtils.ERR_VERSION_REQUIRED),
                validation.description(),
                validation.owner(),
                NormalizeUtils.nullSafeList(validation.tags()),
                validation.riskLevel(),
                NormalizeUtils.normalizeOrDefault(validation.entrypointPath(), SkillFileUtils.SKILL_MANIFEST_FILE),
                digest
        )).getBytes(StandardCharsets.UTF_8);
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    private static void writeArchiveEntries(ZipOutputStream zip, Path root, String rootPrefix) throws IOException {
        try (var stream = Files.walk(root)) {
            for (Path file : stream.filter(Files::isRegularFile).sorted().toList()) {
                SkillFileUtils.assertNotSymbolicLink(file);
                String relative = SkillFileUtils.relativePath(root, file);
                if (SkillFileUtils.INSTALL_MARKER_FILE.equals(relative) || SKILL_PACKAGE_FILE.equals(relative)) {
                    continue;
                }
                zip.putNextEntry(new ZipEntry(rootPrefix + relative));
                zip.write(Files.readAllBytes(file));
                zip.closeEntry();
            }
        }
    }

    private static boolean hashDirectoryFiles(MessageDigest digest, Path root,
                                              SkillTypes.SkillValidationResult validation,
                                              String manifestVersion,
                                              JsonCodec jsonCodec) throws IOException {
        boolean manifestSeen = false;
        for (Path file : collectDigestFiles(root)) {
            SkillFileUtils.assertNotSymbolicLink(file);
            String relative = SkillFileUtils.relativePath(root, file);
            digest.update(relative.getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            if (SKILL_PACKAGE_FILE.equals(relative)) {
                manifestSeen = true;
                digest.update(buildManifestBytes(validation, manifestVersion, null, jsonCodec));
            } else {
                digest.update(Files.readAllBytes(file));
            }
            digest.update((byte) 0);
        }
        return manifestSeen;
    }

    private static void hashManifestEntry(MessageDigest digest,
                                          SkillTypes.SkillValidationResult validation,
                                          String manifestVersion,
                                          JsonCodec jsonCodec) {
        digest.update(SKILL_PACKAGE_FILE.getBytes(StandardCharsets.UTF_8));
        digest.update((byte) 0);
        digest.update(buildManifestBytes(validation, manifestVersion, null, jsonCodec));
        digest.update((byte) 0);
    }

    private static void extractZipEntries(ZipInputStream zipInputStream, Path directory, long maxSize, String contextName) throws IOException {
        ZipEntry entry;
        long totalBytes = 0L;
        byte[] buffer = new byte[8192];
        while ((entry = zipInputStream.getNextEntry()) != null) {
            if (NormalizeUtils.isBlank(entry.getName())) {
                continue;
            }
            String entryName = entry.getName().replace('\\', '/');
            if (entryName.startsWith("/") || entryName.contains("../") || entryName.contains("..\\")) {
                throw new IllegalArgumentException(contextName + "包含非法路径: " + entry.getName());
            }
            Path target = directory.resolve(entryName).normalize();
            if (!target.toAbsolutePath().startsWith(directory.toAbsolutePath())) {
                throw new IllegalArgumentException(contextName + "越界写入被拒绝: " + entry.getName());
            }
            if (entry.isDirectory()) {
                Files.createDirectories(target);
                continue;
            }
            Files.createDirectories(target.getParent());
            try (OutputStream outputStream = Files.newOutputStream(target)) {
                int read;
                while ((read = zipInputStream.read(buffer)) != -1) {
                    totalBytes += read;
                    if (totalBytes > maxSize) {
                        throw new IllegalArgumentException(contextName + "解压后过大");
                    }
                    outputStream.write(buffer, 0, read);
                }
            }
        }
    }

    private static List<Path> collectDigestFiles(Path directory) throws IOException {
        try (var stream = Files.walk(directory)) {
            return stream.filter(Files::isRegularFile)
                    .filter(path -> !SkillFileUtils.INSTALL_MARKER_FILE.equals(path.getFileName().toString()))
                    .sorted()
                    .toList();
        }
    }
}
