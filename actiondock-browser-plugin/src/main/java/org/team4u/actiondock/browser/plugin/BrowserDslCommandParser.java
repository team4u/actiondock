package org.team4u.actiondock.browser.plugin;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class BrowserDslCommandParser {
    List<BrowserDslCommand> parse(String commands) {
        if (Args.isBlank(commands)) {
            throw new IllegalArgumentException("commands is required");
        }
        List<BrowserDslCommand> result = new ArrayList<>();
        for (String line : commands.split("\\R")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                continue;
            }
            result.add(parseLine(trimmed));
        }
        return result;
    }

    private BrowserDslCommand parseLine(String line) {
        List<String> tokens = tokenize(line);
        if (tokens.isEmpty()) {
            throw new IllegalArgumentException("Empty batch command");
        }
        String action = tokens.getFirst();
        Map<String, Object> args = new LinkedHashMap<>();
        switch (action) {
            case "open", "goto", "navigate" -> {
                action = "open";
                if (tokens.size() > 1) {
                    args.put("url", tokens.get(1));
                }
            }
            case "snapshot" -> {
                if (tokens.size() > 1) {
                    args.put("limit", Integer.parseInt(tokens.get(1)));
                }
            }
            case "click", "dblclick", "fill", "type", "hover", "focus", "check", "uncheck", "clear", "scrollIntoView" -> {
                if (tokens.size() > 1) args.put("target", tokens.get(1));
                if (tokens.size() > 2) args.put(valueKey(action), tokens.get(2));
            }
            case "wait" -> {
                String kind = tokens.size() > 1 ? tokens.get(1) : "ForTimeout";
                action = "waitFor" + Character.toUpperCase(kind.charAt(0)) + kind.substring(1);
                if (tokens.size() > 2) args.put(waitValueKey(action), tokens.get(2));
            }
            case "tab", "session", "cookies", "storage", "network", "dialog" -> {
                String sub = tokens.size() > 1 ? tokens.get(1) : "list";
                action = action + Character.toUpperCase(sub.charAt(0)) + sub.substring(1);
                if (tokens.size() > 2) args.put(defaultKey(action), tokens.get(2));
            }
            case "screenshot", "pdf" -> {
                if (tokens.size() > 1) args.put("path", tokens.get(1));
            }
            case "get", "is" -> {
                String what = tokens.size() > 1 ? tokens.get(1) : "Text";
                action = action + Character.toUpperCase(what.charAt(0)) + what.substring(1);
                if (tokens.size() > 2) args.put("target", tokens.get(2));
            }
            default -> throw new IllegalArgumentException("Unsupported batch command: " + action);
        }
        return new BrowserDslCommand(action, args);
    }

    private static String valueKey(String op) {
        if ("fill".equals(op) || "type".equals(op)) {
            return "text";
        }
        if ("press".equals(op)) {
            return "key";
        }
        return "value";
    }

    private static String waitValueKey(String action) {
        if ("waitForUrl".equals(action)) return "url";
        if ("waitForText".equals(action)) return "text";
        if ("waitForElement".equals(action)) return "target";
        if ("waitForTimeout".equals(action)) return "timeoutMs";
        return "value";
    }

    private static String defaultKey(String action) {
        if (action.startsWith("tabSwitch") || action.startsWith("tabClose") || action.startsWith("tabBring")) return "tab";
        if (action.startsWith("tabNew")) return "url";
        if (action.startsWith("dialogAccept") || action.startsWith("dialogDismiss")) return "id";
        if (action.startsWith("network")) return "url";
        if (action.startsWith("cookiesSet")) return "name";
        return "value";
    }

    private static List<String> tokenize(String line) {
        List<String> tokens = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean quoted = false;
        char quote = 0;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (quoted) {
                if (c == quote) {
                    quoted = false;
                } else {
                    current.append(c);
                }
            } else if (c == '\'' || c == '"') {
                quoted = true;
                quote = c;
            } else if (Character.isWhitespace(c)) {
                if (!current.isEmpty()) {
                    tokens.add(current.toString());
                    current.setLength(0);
                }
            } else {
                current.append(c);
            }
        }
        if (!current.isEmpty()) {
            tokens.add(current.toString());
        }
        return tokens;
    }
}
