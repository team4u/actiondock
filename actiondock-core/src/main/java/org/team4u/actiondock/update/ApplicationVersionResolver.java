package org.team4u.actiondock.update;

import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;
import java.util.Properties;

/**
 * 从 Maven 产物元数据中解析应用版本。
 */
public final class ApplicationVersionResolver {
    private static final System.Logger log = System.getLogger(ApplicationVersionResolver.class.getName());
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
        } catch (IOException exception) {
            log.log(System.Logger.Level.DEBUG, "读取 pom.properties 失败，回退到 Package 元数据: {0}", exception.getMessage());
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
