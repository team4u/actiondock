package org.team4u.actiondock.ai.agentscope;

import io.agentscope.core.message.ContentBlock;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.message.ToolResultBlock;
import io.agentscope.core.tool.AgentTool;
import io.agentscope.core.tool.ToolCallParam;
import io.agentscope.core.tool.Toolkit;
import io.agentscope.core.tool.coding.ShellCommandTool;
import io.agentscope.core.tool.file.ReadFileTool;
import io.agentscope.core.tool.file.WriteFileTool;
import io.agentscope.core.tool.multimodal.DashScopeMultiModalTool;
import io.agentscope.core.tool.multimodal.OpenAIMultiModalTool;
import org.team4u.actiondock.ai.api.AiSchemaUtils;
import org.team4u.actiondock.ai.api.AiSecretResolver;
import org.team4u.actiondock.ai.api.AiTool;
import org.team4u.actiondock.ai.api.AiToolExecutionContext;
import org.team4u.actiondock.ai.api.AiToolExecutionResult;
import org.team4u.actiondock.ai.api.AiToolPermission;
import org.team4u.actiondock.ai.api.ConfigurableAiTool;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

public final class AgentScopeBuiltinAiTools {
    private static final String PREFIX = "agentscope.";

    private AgentScopeBuiltinAiTools() {
    }

    public static List<AiTool> create(AiSecretResolver secretResolver) {
        return List.of(
                tool("list_directory", "AgentScope 内置工具：列出目录内容", AiToolPermission.READ_ONLY, secretResolver),
                tool("view_text_file", "AgentScope 内置工具：读取文本文件内容", AiToolPermission.READ_ONLY, secretResolver),
                tool("insert_text_file", "AgentScope 内置工具：向文本文件插入内容", AiToolPermission.CONTROLLED_ACTION, secretResolver),
                tool("write_text_file", "AgentScope 内置工具：写入文本文件", AiToolPermission.CONTROLLED_ACTION, secretResolver),
                tool("execute_shell_command", "AgentScope 内置工具：执行 Shell 命令", AiToolPermission.DANGEROUS_ACTION, secretResolver),
                tool("dashscope_text_to_image", "AgentScope 内置工具：DashScope 文生图", AiToolPermission.CONTROLLED_ACTION, secretResolver),
                tool("dashscope_image_to_text", "AgentScope 内置工具：DashScope 图像理解", AiToolPermission.READ_ONLY, secretResolver),
                tool("dashscope_text_to_audio", "AgentScope 内置工具：DashScope 文生音频", AiToolPermission.CONTROLLED_ACTION, secretResolver),
                tool("dashscope_audio_to_text", "AgentScope 内置工具：DashScope 音频转文本", AiToolPermission.READ_ONLY, secretResolver),
                tool("dashscope_text_to_video", "AgentScope 内置工具：DashScope 文生视频", AiToolPermission.CONTROLLED_ACTION, secretResolver),
                tool("dashscope_image_to_video", "AgentScope 内置工具：DashScope 图生视频", AiToolPermission.CONTROLLED_ACTION, secretResolver),
                tool("dashscope_first_and_last_frame_image_to_video", "AgentScope 内置工具：DashScope 首尾帧生成视频", AiToolPermission.CONTROLLED_ACTION, secretResolver),
                tool("dashscope_video_to_text", "AgentScope 内置工具：DashScope 视频理解", AiToolPermission.READ_ONLY, secretResolver),
                tool("openai_text_to_image", "AgentScope 内置工具：OpenAI 文生图", AiToolPermission.CONTROLLED_ACTION, secretResolver),
                tool("openai_image_to_text", "AgentScope 内置工具：OpenAI 图像理解", AiToolPermission.READ_ONLY, secretResolver),
                tool("openai_text_to_audio", "AgentScope 内置工具：OpenAI 文生音频", AiToolPermission.CONTROLLED_ACTION, secretResolver),
                tool("openai_audio_to_text", "AgentScope 内置工具：OpenAI 音频转文本", AiToolPermission.READ_ONLY, secretResolver)
        );
    }

    private static AiTool tool(String localName, String description, AiToolPermission permission, AiSecretResolver secretResolver) {
        return new BuiltinTool(PREFIX + localName, localName, description, permission, secretResolver, Map.of());
    }

    private static final class BuiltinTool implements ConfigurableAiTool {
        private final String name;
        private final String localName;
        private final String description;
        private final AiToolPermission permission;
        private final AiSecretResolver secretResolver;
        private final Map<String, Object> options;

        private BuiltinTool(String name,
                            String localName,
                            String description,
                            AiToolPermission permission,
                            AiSecretResolver secretResolver,
                            Map<String, Object> options) {
            this.name = name;
            this.localName = localName;
            this.description = description;
            this.permission = permission;
            this.secretResolver = secretResolver;
            this.options = copy(options);
        }

        @Override
        public String name() {
            return name;
        }

        @Override
        public String description() {
            return description;
        }

        @Override
        public AiToolPermission permission() {
            return permission;
        }

        @Override
        public String configHelp() {
            return configHelpFor(localName);
        }

        @Override
        public Map<String, Object> configExample() {
            return configExampleFor(localName);
        }

        @Override
        public Map<String, Object> inputSchema() {
            return schemaFor(localName);
        }

        @Override
        public Map<String, Object> outputSchema() {
            return objectSchema(Map.of("result", Map.of("type", "string"), "metadata", Map.of("type", "object")));
        }

        @Override
        public AiTool configure(Map<String, Object> options) {
            return new BuiltinTool(name, localName, description, permission, secretResolver, copy(options));
        }

        @Override
        public AiToolExecutionResult invoke(Map<String, Object> input, AiToolExecutionContext context) {
            long started = System.currentTimeMillis();
            try {
                AgentTool delegate = createDelegate(localName, options, secretResolver);
                ToolResultBlock block = delegate.callAsync(ToolCallParam.builder()
                        .input(input == null ? Map.of() : input)
                        .build()).block(Duration.ofMinutes(5));
                if (block != null && block.getMetadata() != null && Boolean.TRUE.equals(block.getMetadata().get("isError"))) {
                    return AiToolExecutionResult.failed(text(block), System.currentTimeMillis() - started);
                }
                return AiToolExecutionResult.success(Map.of(
                        "result", text(block),
                        "metadata", block == null || block.getMetadata() == null ? Map.of() : block.getMetadata()
                ), System.currentTimeMillis() - started);
            } catch (Exception exception) {
                return AiToolExecutionResult.failed(exception.getMessage(), System.currentTimeMillis() - started);
            }
        }
    }

    private static AgentTool createDelegate(String localName, Map<String, Object> options, AiSecretResolver secretResolver) {
        if ("execute_shell_command".equals(localName)) {
            return new ShellCommandTool(
                    stringOption(options, "baseDir", "."),
                    stringSet(options.get("allowedCommands")),
                    approvalCallback(),
                    null,
                    StandardCharsets.UTF_8
            );
        }
        Toolkit toolkit = new Toolkit();
        switch (localName) {
            case String s when s.startsWith("dashscope_") ->
                toolkit.registerTool(new DashScopeMultiModalTool(requiredSecret(secretResolver, options, "apiKeyConfigKey", "DashScope API Key 配置项不能为空")));
            case String s when s.startsWith("openai_") -> {
                String apiKey = requiredSecret(secretResolver, options, "apiKeyConfigKey", "OpenAI API Key 配置项不能为空");
                String baseUrl = stringOption(options, "baseUrl", null);
                toolkit.registerTool(baseUrl == null || baseUrl.isBlank() ? new OpenAIMultiModalTool(apiKey) : new OpenAIMultiModalTool(apiKey, baseUrl));
            }
            case "list_directory", "view_text_file" ->
                toolkit.registerTool(new ReadFileTool(stringOption(options, "baseDir", ".")));
            case "insert_text_file", "write_text_file" ->
                toolkit.registerTool(new WriteFileTool(stringOption(options, "baseDir", ".")));
            default -> throw new IllegalArgumentException("不支持的 AgentScope 内置工具: " + localName);
        }
        AgentTool tool = toolkit.getTool(localName);
        if (tool == null) {
            throw new IllegalArgumentException("AgentScope 内置工具未注册: " + localName);
        }
        return tool;
    }

    private static Function<String, Boolean> approvalCallback() {
        return command -> true;
    }

    private static String requiredSecret(AiSecretResolver resolver, Map<String, Object> options, String optionKey, String message) {
        String configKey = stringOption(options, optionKey, null);
        if (configKey == null || configKey.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        String secret = resolver == null ? null : resolver.resolve(configKey);
        if (secret == null || secret.isBlank()) {
            throw new IllegalArgumentException("配置值未设置或为空: " + configKey);
        }
        return secret;
    }

    private static String text(ToolResultBlock block) {
        if (block == null || block.getOutput() == null || block.getOutput().isEmpty()) {
            return "";
        }
        return block.getOutput().stream().map(AgentScopeBuiltinAiTools::contentText).reduce("", (left, right) -> left.isBlank() ? right : left + "\n" + right);
    }

    private static String contentText(ContentBlock block) {
        if (block instanceof TextBlock textBlock) {
            return textBlock.getText();
        }
        return String.valueOf(block);
    }

    private static Map<String, Object> schemaFor(String localName) {
        return switch (localName) {
            case "list_directory" -> objectSchema(Map.of("path", stringSchema("目录路径")));
            case "view_text_file" -> objectSchema(Map.of("path", stringSchema("文件路径"), "viewRange", stringSchema("可选行范围")));
            case "insert_text_file" -> objectSchema(Map.of("path", stringSchema("文件路径"), "content", stringSchema("插入内容"), "lineNumber", Map.of("type", "integer")));
            case "write_text_file" -> objectSchema(Map.of("path", stringSchema("文件路径"), "content", stringSchema("写入内容"), "mode", stringSchema("写入模式")));
            case "execute_shell_command" -> objectSchema(Map.of("command", stringSchema("Shell 命令"), "timeoutSeconds", Map.of("type", "integer")));
            default -> objectSchema(Map.of("input", Map.of("type", "object")));
        };
    }

    private static Map<String, Object> objectSchema(Map<String, Object> properties) {
        return AiSchemaUtils.objectSchema(properties);
    }

    private static Map<String, Object> stringSchema(String description) {
        return AiSchemaUtils.stringSchema(description);
    }

    private static Map<String, Object> copy(Map<String, Object> options) {
        return options == null ? Map.of() : new LinkedHashMap<>(options);
    }

    private static String configHelpFor(String localName) {
        return switch (localName) {
            case "list_directory", "view_text_file" -> "配置 baseDir 限定可读取的根目录。";
            case "insert_text_file", "write_text_file" -> "配置 baseDir 限定写入的根目录。";
            case "execute_shell_command" -> "配置 baseDir 和 allowedCommands；allowedCommands 为空时表示不限制命令白名单。";
            case "dashscope_text_to_image", "dashscope_image_to_text", "dashscope_text_to_audio",
                 "dashscope_audio_to_text", "dashscope_text_to_video", "dashscope_image_to_video",
                 "dashscope_first_and_last_frame_image_to_video", "dashscope_video_to_text" ->
                    "配置 apiKeyConfigKey 指向系统配置中的 DashScope API Key。";
            case "openai_text_to_image", "openai_image_to_text", "openai_text_to_audio", "openai_audio_to_text" ->
                    "配置 apiKeyConfigKey 指向系统配置中的 OpenAI API Key；兼容接口可额外配置 baseUrl。";
            default -> null;
        };
    }

    private static Map<String, Object> configExampleFor(String localName) {
        return switch (localName) {
            case "list_directory", "view_text_file", "insert_text_file", "write_text_file" ->
                    Map.of("baseDir", "/tmp/actiondock");
            case "execute_shell_command" ->
                    Map.of("baseDir", "/tmp/actiondock", "allowedCommands", List.of("ls", "cat"));
            case "dashscope_text_to_image", "dashscope_image_to_text", "dashscope_text_to_audio",
                 "dashscope_audio_to_text", "dashscope_text_to_video", "dashscope_image_to_video",
                 "dashscope_first_and_last_frame_image_to_video", "dashscope_video_to_text" ->
                    Map.of("apiKeyConfigKey", "dashscope.api_key");
            case "openai_text_to_image", "openai_image_to_text", "openai_text_to_audio", "openai_audio_to_text" ->
                    Map.of("apiKeyConfigKey", "openai.api_key", "baseUrl", "https://api.openai.com/v1");
            default -> Map.of();
        };
    }

    private static String stringOption(Map<String, Object> options, String key, String defaultValue) {
        Object value = options == null ? null : options.get(key);
        return value == null ? defaultValue : String.valueOf(value);
    }

    private static Set<String> stringSet(Object value) {
        Set<String> values = new LinkedHashSet<>();
        if (value instanceof Iterable<?> iterable) {
            iterable.forEach(item -> {
                if (item != null && !String.valueOf(item).isBlank()) {
                    values.add(String.valueOf(item));
                }
            });
        } else if (value instanceof String text && !text.isBlank()) {
            for (String item : text.split(",")) {
                if (!item.isBlank()) {
                    values.add(item.trim());
                }
            }
        }
        return values;
    }
}
