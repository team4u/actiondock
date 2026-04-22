package org.team4u.scriptflow.plugin;

import java.util.ArrayList;
import java.util.List;

public class GroovyPluginCallAnalyzer {
    private static final String INVOKE_PREFIX = "plugins.invoke(";

    public List<PluginCallRef> findCalls(String source) {
        if (source == null || source.isBlank()) {
            return List.of();
        }

        List<PluginCallRef> calls = new ArrayList<>();
        int searchFrom = 0;
        while (true) {
            int invokeStart = source.indexOf(INVOKE_PREFIX, searchFrom);
            if (invokeStart < 0) {
                return calls;
            }

            int argsStart = invokeStart + INVOKE_PREFIX.length();
            int argsEnd = findMatchingParen(source, argsStart - 1);
            List<String> args = splitTopLevelArguments(source.substring(argsStart, argsEnd));
            if (args.size() < 2 || args.size() > 3) {
                throw new IllegalArgumentException("plugins.invoke 需要 2 或 3 个参数");
            }

            calls.add(new PluginCallRef(
                    literalString(args.get(0), "pluginId"),
                    literalString(args.get(1), "action")
            ));
            searchFrom = argsEnd + 1;
        }
    }

    public record PluginCallRef(String pluginId, String action) {
    }

    private int findMatchingParen(String source, int openParenIndex) {
        int depth = 0;
        boolean inString = false;
        char stringQuote = 0;
        boolean escaping = false;
        for (int index = openParenIndex; index < source.length(); index++) {
            char current = source.charAt(index);
            if (inString) {
                if (escaping) {
                    escaping = false;
                    continue;
                }
                if (current == '\\') {
                    escaping = true;
                    continue;
                }
                if (current == stringQuote) {
                    inString = false;
                }
                continue;
            }

            if (current == '\'' || current == '"') {
                inString = true;
                stringQuote = current;
                continue;
            }
            if (current == '(') {
                depth++;
                continue;
            }
            if (current == ')') {
                depth--;
                if (depth == 0) {
                    return index;
                }
            }
        }
        throw new IllegalArgumentException("plugins.invoke 缺少右括号");
    }

    private List<String> splitTopLevelArguments(String content) {
        List<String> values = new ArrayList<>();
        int segmentStart = 0;
        int parenDepth = 0;
        int bracketDepth = 0;
        int braceDepth = 0;
        boolean inString = false;
        char stringQuote = 0;
        boolean escaping = false;

        for (int index = 0; index < content.length(); index++) {
            char current = content.charAt(index);
            if (inString) {
                if (escaping) {
                    escaping = false;
                    continue;
                }
                if (current == '\\') {
                    escaping = true;
                    continue;
                }
                if (current == stringQuote) {
                    inString = false;
                }
                continue;
            }

            if (current == '\'' || current == '"') {
                inString = true;
                stringQuote = current;
                continue;
            }
            if (current == '(') {
                parenDepth++;
                continue;
            }
            if (current == ')') {
                parenDepth--;
                continue;
            }
            if (current == '[') {
                bracketDepth++;
                continue;
            }
            if (current == ']') {
                bracketDepth--;
                continue;
            }
            if (current == '{') {
                braceDepth++;
                continue;
            }
            if (current == '}') {
                braceDepth--;
                continue;
            }
            if (current == ',' && parenDepth == 0 && bracketDepth == 0 && braceDepth == 0) {
                values.add(content.substring(segmentStart, index).trim());
                segmentStart = index + 1;
            }
        }

        String last = content.substring(segmentStart).trim();
        if (!last.isEmpty()) {
            values.add(last);
        }
        return values;
    }

    private String literalString(String rawValue, String label) {
        String trimmed = rawValue == null ? "" : rawValue.trim();
        if (trimmed.length() >= 2) {
            char first = trimmed.charAt(0);
            char last = trimmed.charAt(trimmed.length() - 1);
            if ((first == '\'' || first == '"') && first == last) {
                return trimmed.substring(1, trimmed.length() - 1);
            }
        }
        throw new IllegalArgumentException("plugins.invoke 的 " + label + " 必须是字符串字面量");
    }
}
