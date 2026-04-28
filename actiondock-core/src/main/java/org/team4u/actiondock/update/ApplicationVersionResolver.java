package org.team4u.actiondock.update;

import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;
import java.util.Properties;

/**
 * 从 Maven 产物元数据中解析应用版本。
 */
public final class ApplicationVersionResolver {
    private ApplicationVersionResolver() {
    }

    public static String resolve(Class<?> anchorClass, String groupId, String artifactId) {
        Objects.requireNonNull(anchorClass, "anchorClass");
        Objects.requireNonNull(groupId, "groupId");
        Objects.requireNonNull(artifactId, "artifactId");

        String resource = "/META-INF/maven/" + groupId + "/" + artifactId + "/pom.properties";
        try (InputStream inputStream = anchorClass.getResourceAsStream(resource)) {
            if (inputStream != null) {
                Properties properties = new Properties();
                properties.load(inputStream);
                String version = properties.getProperty("version");
                if (version != null && !version.isBlank()) {
                    return version.trim();
                }
            }
        } catch (IOException ignored) {
            // Ignore and continue to package metadata fallback.
        }

        Package targetPackage = anchorClass.getPackage();
        if (targetPackage != null) {
            String implementationVersion = targetPackage.getImplementationVersion();
            if (implementationVersion != null && !implementationVersion.isBlank()) {
                return implementationVersion.trim();
            }
        }
        return "";
    }
}
