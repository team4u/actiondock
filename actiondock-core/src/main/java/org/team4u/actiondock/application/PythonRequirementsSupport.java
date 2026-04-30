package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptType;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Python requirements 文本的规范化与校验工具。
 */
public final class PythonRequirementsSupport {
    private PythonRequirementsSupport() {
    }

    public static String normalizeForStorage(String requirements) {
        if (requirements == null) {
            return null;
        }
        String normalized = requirements.replace("\r\n", "\n").replace('\r', '\n').trim();
        return normalized.isEmpty() ? null : normalized;
    }

    public static ParsedPythonRequirements parse(String scriptId, String requirements) {
        String normalized = normalizeForStorage(requirements);
        if (normalized == null) {
            return new ParsedPythonRequirements(null, null, List.of());
        }

        List<String> packageLines = new ArrayList<>();
        String indexUrl = null;
        String[] lines = normalized.split("\n", -1);
        for (int index = 0; index < lines.length; index += 1) {
            String rawLine = lines[index];
            String line = rawLine.trim();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }

            if (line.startsWith("--")) {
                if (line.startsWith("--index-url ")) {
                    if (indexUrl != null) {
                        throw new InvalidPythonRequirementsException(
                                "INVALID_PYTHON_REQUIREMENTS",
                                scriptId,
                                index + 1,
                                rawLine,
                                "仅支持声明一个 --index-url"
                        );
                    }
                    String value = line.substring("--index-url ".length()).trim();
                    if (value.isEmpty()) {
                        throw new InvalidPythonRequirementsException(
                                "INVALID_PYTHON_REQUIREMENTS",
                                scriptId,
                                index + 1,
                                rawLine,
                                "--index-url 不能为空"
                        );
                    }
                    indexUrl = value;
                    continue;
                }
                throw unsupported(scriptId, index + 1, rawLine, "暂不支持该 pip 选项");
            }

            if (line.startsWith("-")) {
                throw unsupported(scriptId, index + 1, rawLine, "暂不支持该 requirements 语法");
            }
            if (line.startsWith("git+") || line.contains("://") || line.startsWith(".")) {
                throw unsupported(scriptId, index + 1, rawLine, "暂不支持 URL、本地路径或 VCS 依赖");
            }
            if (line.contains("@ ")) {
                throw unsupported(scriptId, index + 1, rawLine, "暂不支持 direct URL 依赖");
            }

            packageLines.add(line);
        }

        return new ParsedPythonRequirements(
                normalized,
                indexUrl,
                List.copyOf(packageLines)
        );
    }

    public static void validateScriptDefinition(ScriptDefinition definition) {
        if (definition == null) {
            return;
        }
        String normalized = normalizeForStorage(definition.getPythonRequirements());
        definition.setPythonRequirements(normalized);

        if (definition.getType() != ScriptType.PYTHON && normalized != null) {
            throw new InvalidPythonRequirementsException(
                    "PYTHON_REQUIREMENTS_UNSUPPORTED",
                    definition.getId(),
                    0,
                    null,
                    "仅 PYTHON 脚本支持声明 pythonRequirements"
            );
        }
        if (definition.getType() == ScriptType.PYTHON) {
            parse(definition.getId(), normalized);
        }
    }

    private static InvalidPythonRequirementsException unsupported(String scriptId,
                                                                 int lineNumber,
                                                                 String lineContent,
                                                                 String reason) {
        return new InvalidPythonRequirementsException(
                "PYTHON_REQUIREMENTS_UNSUPPORTED",
                scriptId,
                lineNumber,
                lineContent,
                reason
        );
    }

    public record ParsedPythonRequirements(
            String normalizedText,
            String indexUrl,
            List<String> packageLines
    ) {
        public boolean isEmpty() {
            return normalizedText == null || normalizedText.isBlank();
        }

        public String cacheKeyMaterial(String executable, String pythonVersion) {
            return (normalizedText == null ? "" : normalizedText)
                    + "\n--index-url=" + (indexUrl == null ? "" : indexUrl)
                    + "\n--python=" + (executable == null ? "" : executable.trim())
                    + "\n--python-version=" + (pythonVersion == null ? "" : pythonVersion.trim().toLowerCase(Locale.ROOT));
        }
    }
}
