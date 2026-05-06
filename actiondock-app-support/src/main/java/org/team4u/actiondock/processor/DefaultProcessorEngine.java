package org.team4u.actiondock.processor;

import org.team4u.actiondock.shared.NormalizeUtils;

import com.github.mustachejava.DefaultMustacheFactory;
import com.github.mustachejava.Mustache;
import com.github.mustachejava.MustacheFactory;
import com.jayway.jsonpath.Configuration;
import com.jayway.jsonpath.JsonPath;
import com.jayway.jsonpath.Option;
import org.team4u.actiondock.application.MapValueConverter;
import org.team4u.actiondock.application.ScriptInvocationService;
import org.team4u.actiondock.application.ConfigValueApplicationService;
import org.team4u.actiondock.domain.model.ExecutionLogEntry;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;
import org.team4u.actiondock.domain.model.ProcessorContext;
import org.team4u.actiondock.domain.model.ProcessorDefinition;
import org.team4u.actiondock.domain.model.ProcessorResult;
import org.team4u.actiondock.domain.model.ScriptExecutionContext;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.port.ProcessorEngine;

import java.io.StringReader;
import java.io.StringWriter;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class DefaultProcessorEngine implements ProcessorEngine {
    private static final Configuration JSON_PATH_CONFIGURATION = Configuration.builder()
            .options(Option.SUPPRESS_EXCEPTIONS)
            .build();

    private final ScriptInvocationService scriptInvocationService;
    private final ConfigValueApplicationService configValueApplicationService;
    private final MustacheFactory mustacheFactory = new DefaultMustacheFactory();
    private final ConcurrentHashMap<String, Mustache> templateCache = new ConcurrentHashMap<>();

    public DefaultProcessorEngine(ScriptInvocationService scriptInvocationService,
                                  ConfigValueApplicationService configValueApplicationService) {
        this.scriptInvocationService = scriptInvocationService;
        this.configValueApplicationService = configValueApplicationService;
    }

    @Override
    public ProcessorResult process(ProcessorDefinition processor, ProcessorContext context) {
        long started = System.currentTimeMillis();
        List<ExecutionLogEntry> logs = new ArrayList<>();
        try {
            if (processor == null) {
                throw new IllegalArgumentException("processor 不能为空");
            }
            if (processor.getMode() == null) {
                throw new IllegalArgumentException("processor.mode 不能为空");
            }
            Map<String, Object> output = switch (processor.getMode()) {
                case JSON_PATH -> executeJsonPath(processor, context);
                case TEMPLATE -> executeTemplate(processor, context);
                case SCRIPT_REF -> executeScriptRef(processor, context, logs);
                default -> throw new IllegalArgumentException("当前不支持的 Processor 模式: " + processor.getMode());
            };
            return new ProcessorResult()
                    .setSuccess(true)
                    .setOutput(output)
                    .setLogs(logs)
                    .setDurationMs(System.currentTimeMillis() - started);
        } catch (RuntimeException exception) {
            return new ProcessorResult()
                    .setSuccess(false)
                    .setErrorMessage(exception.getMessage())
                    .setLogs(logs)
                    .setDurationMs(System.currentTimeMillis() - started);
        }
    }

    private static Map<String, Object> executeJsonPath(ProcessorDefinition processor, ProcessorContext context) {
        if (processor.getJsonPath() == null || processor.getJsonPath().getFields().isEmpty()) {
            throw new IllegalArgumentException("JSON_PATH 缺少 fields 配置");
        }
        Object document = context == null ? Map.of() : context.toMap();
        Map<String, Object> output = new LinkedHashMap<>();
        processor.getJsonPath().getFields().forEach((field, expression) -> {
            if (NormalizeUtils.isBlank(field)) {
                return;
            }
            Object value = JsonPath.using(JSON_PATH_CONFIGURATION).parse(document).read(expression);
            output.put(field, value);
        });
        return output;
    }

    private Map<String, Object> executeTemplate(ProcessorDefinition processor, ProcessorContext context) {
        if (processor.getTemplate() == null || processor.getTemplate().getTemplate().isEmpty()) {
            throw new IllegalArgumentException("TEMPLATE 缺少 template 配置");
        }
        Object rendered = renderValue(processor.getTemplate().getTemplate(), context == null ? Map.of() : context.toMap());
        return MapValueConverter.toResultMap(rendered);
    }

    private Map<String, Object> executeScriptRef(ProcessorDefinition processor,
                                                 ProcessorContext context,
                                                 List<ExecutionLogEntry> logs) {
        if (processor.getScriptRef() == null || NormalizeUtils.isBlank(processor.getScriptRef().getScriptId())) {
            throw new IllegalArgumentException("SCRIPT_REF 缺少 scriptId");
        }
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("event", context == null ? Map.of() : context.getEvent());
        input.put("source", context == null ? Map.of() : context.getSource());
        input.put("trigger", context == null ? Map.of() : context.getTrigger());
        input.put("variables", context == null ? Map.of() : context.getVariables());
        ScriptExecutionContext executionContext = new ScriptExecutionContext()
                .setSubmitMode(SubmitMode.SYNC)
                .setConfig(configValueApplicationService.snapshot())
                .setLogger((level, message) -> logs.add(new ExecutionLogEntry()
                        .setLevel(level == null ? ExecutionLogLevel.INFO : level)
                        .setMessage(message)
                        .setCreatedAt(LocalDateTime.now())));
        Object result = scriptInvocationService.invokePublished(
                processor.getScriptRef().getScriptId(),
                null,
                executionContext,
                input
        );
        return MapValueConverter.toResultMap(result);
    }

    private Object renderValue(Object value, Map<String, Object> scope) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> rendered = new LinkedHashMap<>();
            map.forEach((key, item) -> rendered.put(String.valueOf(key), renderValue(item, scope)));
            return rendered;
        }
        if (value instanceof List<?> list) {
            List<Object> rendered = new ArrayList<>(list.size());
            for (Object item : list) {
                rendered.add(renderValue(item, scope));
            }
            return rendered;
        }
        if (value instanceof String text) {
            Mustache mustache = templateCache.computeIfAbsent(text,
                    key -> mustacheFactory.compile(new StringReader(key), "processor-template"));
            StringWriter writer = new StringWriter();
            mustache.execute(writer, scope);
            return writer.toString();
        }
        return value;
    }
}
