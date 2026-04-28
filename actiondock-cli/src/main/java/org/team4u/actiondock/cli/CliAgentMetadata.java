package org.team4u.actiondock.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import picocli.CommandLine;
import picocli.CommandLine.Model.CommandSpec;
import picocli.CommandLine.Model.OptionSpec;
import picocli.CommandLine.Model.PositionalParamSpec;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Machine-readable command discovery and help metadata.
 */
final class CliAgentMetadata {
    private static final Map<String, CommandContract> CONTRACTS = contracts();

    private CliAgentMetadata() {
    }

    static ObjectNode discover(ObjectMapper objectMapper, CommandLine root) {
        ObjectNode data = objectMapper.createObjectNode();
        data.put("schemaVersion", "actiondock.cli.discover.v1");
        data.put("defaultOutput", "json-envelope");
        data.set("exitCodes", exitCodes(objectMapper));
        ArrayNode features = data.putArray("agentFeatures");
        features.add("--help-json");
        features.add("--dry-run");
        features.add("--validate-only");
        features.add("scripts schema --example");

        ArrayNode commands = data.putArray("commands");
        appendCommandTree(commands, root);

        ArrayNode flows = data.putArray("recommendedFlows");
        appendFlow(flows, "execute script safely", List.of(
                "actiondock scripts schema <scriptId> --example",
                "actiondock executions submit --script-id <scriptId> --input '<json>' --validate-only",
                "actiondock executions submit --script-id <scriptId> --input '<json>' --dry-run",
                "actiondock executions submit --script-id <scriptId> --input '<json>' --wait"
        ));
        appendFlow(flows, "create or update from file", List.of(
                "actiondock <resource> create --file request.json --validate-only",
                "actiondock <resource> create --file request.json --dry-run",
                "actiondock <resource> create --file request.json"
        ));
        appendFlow(flows, "invoke plugin safely", List.of(
                "actiondock plugins get <pluginId>",
                "actiondock plugins invoke <pluginId> <action> --file invoke.json --dry-run",
                "actiondock plugins invoke <pluginId> <action> --file invoke.json"
        ));
        appendFlow(flows, "install repository tool safely", List.of(
                "actiondock repositories tools get <repositoryId> <toolId>",
                "actiondock repositories tools install <repositoryId> <toolId> --dry-run",
                "actiondock repositories tools install <repositoryId> <toolId>"
        ));
        appendFlow(flows, "test model safely", List.of(
                "actiondock ai models get <modelId>",
                "actiondock ai models test <modelId> --file chat-request.json --validate-only",
                "actiondock ai models test <modelId> --file chat-request.json --dry-run",
                "actiondock ai models test <modelId> --file chat-request.json"
        ));
        appendFlow(flows, "submit agent run safely", List.of(
                "actiondock ai agents get <agentId>",
                "actiondock ai runs submit --file run-request.json --validate-only",
                "actiondock ai runs submit --file run-request.json --dry-run",
                "actiondock ai runs submit --file run-request.json --wait"
        ));
        appendFlow(flows, "generate script with workbench", List.of(
                "actiondock ai workbench generate-script --file workbench.json --validate-only",
                "actiondock ai workbench generate-script --file workbench.json --dry-run",
                "actiondock ai workbench generate-script --file workbench.json"
        ));
        return data;
    }

    static ObjectNode help(ObjectMapper objectMapper, CommandSpec spec) {
        ObjectNode data = objectMapper.createObjectNode();
        String command = spec.qualifiedName();
        CommandContract contract = CONTRACTS.get(command);
        data.put("schemaVersion", "actiondock.cli.help.v1");
        data.put("command", command);
        data.put("purpose", contract == null ? firstDescriptionLine(spec) : contract.purpose());
        data.set("arguments", arguments(objectMapper, spec));
        data.set("options", options(objectMapper, spec, contract));
        if (contract != null) {
            data.set("constraints", objectMapper.valueToTree(contract.constraints()));
            data.set("defaults", objectMapper.valueToTree(contract.defaults()));
            data.set("inputShapes", objectMapper.valueToTree(contract.inputShapes()));
            data.set("outputShape", objectMapper.valueToTree(contract.outputShape()));
            data.set("examples", objectMapper.valueToTree(contract.examples()));
            data.set("supports", objectMapper.valueToTree(contract.supports()));
        } else {
            data.set("constraints", objectMapper.createArrayNode());
            data.set("defaults", objectMapper.createObjectNode());
            data.set("inputShapes", objectMapper.createObjectNode());
            data.set("outputShape", objectMapper.valueToTree(Map.of("envelope", Map.of("status", 0, "msg", "Success", "data", Map.of()))));
            data.set("examples", objectMapper.createArrayNode());
            data.set("supports", objectMapper.valueToTree(Map.of("helpJson", true)));
        }
        data.set("exitCodes", exitCodes(objectMapper));
        if (!spec.subcommands().isEmpty()) {
            data.set("subcommands", objectMapper.valueToTree(spec.subcommands().keySet()));
        }
        return data;
    }

    private static ArrayNode arguments(ObjectMapper objectMapper, CommandSpec spec) {
        ArrayNode arguments = objectMapper.createArrayNode();
        for (PositionalParamSpec positional : spec.positionalParameters()) {
            ObjectNode node = arguments.addObject();
            node.put("index", positional.index().toString());
            node.put("label", positional.paramLabel());
            node.put("type", typeName(positional.type()));
            node.put("required", positional.required());
            node.put("description", String.join(" ", positional.renderedDescription()));
        }
        return arguments;
    }

    private static ArrayNode options(ObjectMapper objectMapper, CommandSpec spec, CommandContract contract) {
        ArrayNode options = objectMapper.createArrayNode();
        Map<String, Map<String, Object>> optionMetadata = contract == null ? Map.of() : contract.optionMetadata();
        for (OptionSpec option : spec.options()) {
            if (option.hidden()) {
                continue;
            }
            ObjectNode node = options.addObject();
            node.set("names", objectMapper.valueToTree(option.names()));
            node.put("type", optionType(option));
            node.put("required", option.required());
            node.put("description", String.join(" ", option.renderedDescription()));
            if (option.defaultValue() != null) {
                node.put("default", option.defaultValue());
            }
            Iterable<String> candidates = option.completionCandidates();
            if (candidates != null) {
                ArrayNode values = node.putArray("values");
                candidates.forEach(values::add);
            }
            Map<String, Object> extra = optionMetadata.get(option.longestName());
            if (extra != null) {
                extra.forEach((key, value) -> node.set(key, objectMapper.valueToTree(value)));
            }
        }
        return options;
    }

    private static ObjectNode exitCodes(ObjectMapper objectMapper) {
        ObjectNode codes = objectMapper.createObjectNode();
        codes.put("0", "success");
        codes.put("2", "validation error");
        codes.put("3", "config error");
        codes.put("4", "transport error");
        codes.put("5", "business error");
        codes.put("6", "timeout");
        return codes;
    }

    private static void appendCommandTree(ArrayNode commands, CommandLine commandLine) {
        CommandSpec spec = commandLine.getCommandSpec();
        ObjectNode node = commands.addObject();
        node.put("name", spec.name());
        node.put("qualifiedName", spec.qualifiedName());
        node.put("purpose", firstDescriptionLine(spec));
        ArrayNode subcommands = node.putArray("subcommands");
        spec.subcommands().forEach((name, subcommand) -> {
            subcommands.add(name);
            appendCommandTree(commands, subcommand);
        });
    }

    private static void appendFlow(ArrayNode flows, String name, List<String> steps) {
        ObjectNode flow = flows.addObject();
        flow.put("name", name);
        ArrayNode values = flow.putArray("steps");
        steps.forEach(values::add);
    }

    private static String firstDescriptionLine(CommandSpec spec) {
        String[] description = spec.usageMessage().description();
        if (description == null || description.length == 0) {
            return "";
        }
        return Arrays.stream(description)
                .filter(item -> item != null && !item.isBlank())
                .findFirst()
                .orElse("");
    }

    private static String optionType(OptionSpec option) {
        String name = option.longestName();
        if (name.contains("file") && option.type() == String.class) {
            return "path";
        }
        if (List.of("--input", "--args", "--script-input").contains(name)) {
            return "jsonObject";
        }
        return typeName(option.type());
    }

    private static String typeName(Class<?> type) {
        if (type == null) {
            return "string";
        }
        if (type == boolean.class || type == Boolean.class) {
            return "boolean";
        }
        if (type == int.class || type == Integer.class || type == long.class || type == Long.class) {
            return "integer";
        }
        if (type.isEnum()) {
            return "enum";
        }
        return "string";
    }

    private static Map<String, CommandContract> contracts() {
        Map<String, CommandContract> result = new LinkedHashMap<>();
        result.put("actiondock executions submit", new CommandContract(
                "Submit a script execution against the current saved script definition.",
                List.of(
                        "--script-id is required unless --file is used",
                        "--file is mutually exclusive with --script-id, --input, --input-file, --mode, and --response-view"
                ),
                Map.of("mode", "SYNC", "responseView", "RESULT", "waitTimeoutSeconds", 30, "pollIntervalMs", 1000),
                Map.of(
                        "input", Map.of("name", "Alice"),
                        "file", Map.of("scriptId", "hello", "input", Map.of("name", "Alice"), "mode", "SYNC", "responseView", "RESULT")
                ),
                Map.of("envelope", Map.of("status", 0, "msg", "Success", "data", Map.of())),
                List.of(
                        Map.of("description", "Submit inline JSON input", "command", "actiondock executions submit --script-id hello --input '{\"name\":\"Alice\"}'"),
                        Map.of("description", "Preview final request", "command", "actiondock executions submit --script-id hello --input '{\"name\":\"Alice\"}' --dry-run")
                ),
                Map.of("helpJson", true, "dryRun", true, "validateOnly", true),
                Map.of(
                        "--input", Map.of("mutuallyExclusiveWith", List.of("--input-file", "--file"), "example", Map.of("name", "Alice")),
                        "--file", Map.of("mutuallyExclusiveWith", List.of("--script-id", "--input", "--input-file", "--mode", "--response-view"), "example", Map.of("scriptId", "hello", "input", Map.of("name", "Alice"), "mode", "SYNC", "responseView", "RESULT"))
                )
        ));
        result.put("actiondock scripts schema", new CommandContract(
                "Get the input/output schema summary for the current script definition.",
                List.of(),
                Map.of(),
                Map.of(),
                Map.of("envelope", Map.of("status", 0, "msg", "Success", "data", Map.of("inputSchema", Map.of(), "inputExample", Map.of()))),
                List.of(Map.of("description", "Get schema and examples", "command", "actiondock scripts schema hello --example")),
                Map.of("helpJson", true),
                Map.of()
        ));
        result.put("actiondock ai runs submit", new CommandContract(
                "Submit an AI agent run asynchronously.",
                List.of(
                        "--file is required",
                        "--wait polls /api/ai/agents/runs/{runId} until the run leaves RUNNING state"
                ),
                Map.of("waitTimeoutSeconds", 30, "pollIntervalMs", 1000),
                Map.of(
                        "file", Map.of(
                                "agentProfile", "support-agent",
                                "messages", List.of(Map.of("role", "user", "content", "Summarize this incident")),
                                "input", Map.of(),
                                "options", Map.of()
                        )
                ),
                Map.of("envelope", Map.of("status", 0, "msg", "Success", "data", Map.of("runId", "run-1", "status", "RUNNING"))),
                List.of(
                        Map.of("description", "Submit an agent run", "command", "actiondock ai runs submit --file run-request.json"),
                        Map.of("description", "Submit and wait", "command", "actiondock ai runs submit --file run-request.json --wait")
                ),
                Map.of("helpJson", true, "dryRun", true, "validateOnly", true),
                Map.of(
                        "--file", Map.of("example", Map.of(
                                "agentProfile", "support-agent",
                                "messages", List.of(Map.of("role", "user", "content", "Summarize this incident")),
                                "input", Map.of(),
                                "options", Map.of()
                        ))
                )
        ));
        result.put("actiondock ai models test", new CommandContract(
                "Test an AI model profile with a chat request JSON file.",
                List.of("--file is required"),
                Map.of(),
                Map.of(
                        "file", Map.of(
                                "messages", List.of(Map.of("role", "user", "content", "Hello")),
                                "options", Map.of()
                        )
                ),
                Map.of("envelope", Map.of("status", 0, "msg", "Success", "data", Map.of("message", Map.of("role", "assistant", "content", "Hi")))),
                List.of(Map.of("description", "Test a model", "command", "actiondock ai models test demo-model --file chat-request.json")),
                Map.of("helpJson", true, "dryRun", true, "validateOnly", true),
                Map.of(
                        "--file", Map.of("example", Map.of(
                                "messages", List.of(Map.of("role", "user", "content", "Hello")),
                                "options", Map.of()
                        ))
                )
        ));
        return result;
    }

    private record CommandContract(
            String purpose,
            List<String> constraints,
            Map<String, Object> defaults,
            Map<String, Object> inputShapes,
            Map<String, Object> outputShape,
            List<Map<String, String>> examples,
            Map<String, Object> supports,
            Map<String, Map<String, Object>> optionMetadata
    ) {
    }
}
