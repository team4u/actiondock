package org.team4u.actiondock.cli;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import picocli.CommandLine;

import java.util.Collection;
import java.util.List;

/**
 * Builds machine-readable CLI error details that agents can use to retry.
 */
final class CliErrorDetails {
    private CliErrorDetails() {
    }

    static ObjectNode detail(CliOutput output, String code, String command) {
        ObjectNode node = output.objectMapper().createObjectNode();
        node.put("code", code);
        if (hasText(command)) {
            node.put("command", command);
        }
        return node;
    }

    static ObjectNode missingRequired(CliOutput output,
                                      String command,
                                      Collection<String> missing,
                                      Collection<String> alternatives,
                                      Collection<String> retryExamples) {
        ObjectNode node = detail(output, "MISSING_REQUIRED_OPTION", command);
        putArray(node, "missing", missing);
        putArray(node, "alternatives", alternatives);
        putArray(node, "retryExamples", retryExamples);
        return node;
    }

    static ObjectNode mutuallyExclusive(CliOutput output,
                                        String command,
                                        Collection<String> options,
                                        Collection<String> retryExamples) {
        ObjectNode node = detail(output, "MUTUALLY_EXCLUSIVE_OPTIONS", command);
        putArray(node, "mutuallyExclusiveWith", options);
        putArray(node, "retryExamples", retryExamples);
        return node;
    }

    static ObjectNode invalidJson(CliOutput output,
                                  String command,
                                  String code,
                                  String expected,
                                  String actual,
                                  Collection<String> retryExamples) {
        ObjectNode node = detail(output, code, command);
        node.put("expected", expected);
        node.put("actual", actual);
        putArray(node, "retryExamples", retryExamples);
        return node;
    }

    static ObjectNode fileRead(CliOutput output, String command, String label, String path) {
        ObjectNode node = detail(output, "FILE_READ_FAILED", command);
        node.put("expected", label + " file readable as UTF-8 text");
        node.put("actual", path);
        return node;
    }

    static ObjectNode parseError(CliOutput output, CommandLine commandLine, String message) {
        String command = commandLine == null ? "actiondock" : commandLine.getCommandSpec().qualifiedName();
        ObjectNode node = detail(output, "INVALID_CLI_ARGUMENTS", command);
        node.put("expected", "valid arguments for " + command);
        node.put("actual", message == null ? "parse error" : message);
        putArray(node, "retryExamples", List.of(command + " --help"));
        return node;
    }

    static ObjectNode timeout(CliOutput output, String command, Collection<String> retryExamples) {
        ObjectNode node = detail(output, "WAIT_TIMEOUT", command);
        putArray(node, "retryExamples", retryExamples);
        return node;
    }

    private static void putArray(ObjectNode node, String field, Collection<String> values) {
        if (values == null || values.isEmpty()) {
            return;
        }
        ArrayNode array = node.putArray(field);
        values.stream().filter(CliErrorDetails::hasText).forEach(array::add);
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
