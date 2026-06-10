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

    private static String normalizeForStorage(String requirements) {
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

        ParseState state = new ParseState();
        String[] lines = normalized.split("\n", -1);
        for (int index = 0; index < lines.length; index += 1) {
            processLine(scriptId, lines[index], index + 1, state);
        }

        return new ParsedPythonRequirements(normalized, state.indexUrl, List.copyOf(state.packageLines));
    }

    private static void processLine(String scriptId, String rawLine, int lineNumber, ParseState state) {
        String line = rawLine.trim();
        if (line.isEmpty() || line.startsWith("#")) {
            return;
        }
        if (line.startsWith("--")) {
            processOption(scriptId, rawLine, lineNumber, line, state);
            return;
        }
        if (line.startsWith("-")) {
            throw unsupported(scriptId, lineNumber, rawLine, "暂不支持该 requirements 语法");
        }
        if (line.startsWith("git+") || line.contains("://") || line.startsWith(".")) {
            throw unsupported(scriptId, lineNumber, rawLine, "暂不支持 URL、本地路径或 VCS 依赖");
        }
        if (line.contains("@ ")) {
            throw unsupported(scriptId, lineNumber, rawLine, "暂不支持 direct URL 依赖");
        }
        state.packageLines.add(line);
    }

    private static void processOption(String scriptId, String rawLine, int lineNumber, String line, ParseState state) {
        if (line.startsWith("--index-url ")) {
            if (state.indexUrl != null) {
                throw new InvalidPythonRequirementsException(
                        "INVALID_PYTHON_REQUIREMENTS", scriptId, lineNumber, rawLine,
                        "仅支持声明一个 --index-url"
                );
            }
            String value = line.substring("--index-url ".length()).trim();
            if (value.isEmpty()) {
                throw new InvalidPythonRequirementsException(
                        "INVALID_PYTHON_REQUIREMENTS", scriptId, lineNumber, rawLine,
                        "--index-url 不能为空"
                );
            }
            state.indexUrl = value;
            return;
        }
        throw unsupported(scriptId, lineNumber, rawLine, "暂不支持该 pip 选项");
    }

    private static final class ParseState {
        String indexUrl;
        final List<String> packageLines = new ArrayList<>();
    }

    static void validateScriptDefinition(ScriptDefinition definition) {
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
