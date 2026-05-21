package org.team4u.actiondock.project.knowledge.plugin.parser;

import org.team4u.actiondock.plugin.api.PluginObjectMappers;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AI 输出解析器。
 *
 * <p>将 AI Agent 或外部 CLI 返回的原始输出解析为结构化数据。支持多种 JSON 格式：
 * <ol>
 *   <li>直接的 JSON 字符串</li>
 *   <li>Markdown 围栏代码块中的 JSON（{@code ```json ... ```}）</li>
 *   <li>混合文本中提取的 JSON 片段</li>
 * </ol>
 * 当所有 JSON 解析策略均失败时，将原始输出包装为纯文本格式并标记为需要人工审核。
 *
 * @author ActionDock
 */
public class AiOutputParser {

    /**
     * 解析 AI 原始输出。
     *
     * <p>依次尝试直接解析、围栏 JSON 提取和 JSON 片段提取三种策略。
     *
     * @param rawOutput AI 返回的原始输出
     * @return 解析结果，{@link ParsedAiOutput#parsed()} 为 {@code true} 表示解析成功
     */
    public ParsedAiOutput parse(String rawOutput) {
        String raw = rawOutput == null ? "" : rawOutput.trim();
        if (raw.isEmpty()) {
            return ParsedAiOutput.needsReview(rawOutput, "empty-output", Map.of("text", ""));
        }

        ParsedAiOutput direct = tryParse(raw, rawOutput, null);
        if (direct.parsed()) {
            return direct;
        }

        String fenced = fencedJson(raw);
        if (fenced != null) {
            ParsedAiOutput parsed = tryParse(fenced, rawOutput, "fenced-json-parse-failed");
            if (parsed.parsed()) {
                return parsed;
            }
        }

        String fragment = jsonFragment(raw);
        if (fragment != null) {
            ParsedAiOutput parsed = tryParse(fragment, rawOutput, "json-fragment-parse-failed");
            if (parsed.parsed()) {
                return parsed;
            }
        }

        Map<String, Object> fallback = new LinkedHashMap<>();
        fallback.put("text", rawOutput == null ? "" : rawOutput);
        fallback.put("format", "plain-text");
        return ParsedAiOutput.needsReview(rawOutput, "not-json", fallback);
    }

    /**
     * 尝试将候选字符串解析为 JSON 对象或数组。
     *
     * @param candidate 候选 JSON 字符串
     * @param rawOutput 原始输出（保留在结果中）
     * @param errorCode 解析失败时的错误编码
     * @return 解析结果
     */
    @SuppressWarnings("unchecked")
    private ParsedAiOutput tryParse(String candidate, String rawOutput, String errorCode) {
        try {
            Object parsed = PluginObjectMappers.DEFAULT.readValue(candidate, Object.class);
            // JSON 对象直接使用；JSON 数组包装为 {items: [...]}
            if (parsed instanceof Map<?, ?> map) {
                return ParsedAiOutput.done(rawOutput, (Map<String, Object>) map);
            }
            Map<String, Object> wrapped = new LinkedHashMap<>();
            wrapped.put("items", parsed);
            return ParsedAiOutput.done(rawOutput, wrapped);
        } catch (Exception exception) {
            // errorCode 非空时使用固定编码，否则使用原始异常消息（首次直接解析失败时保留详细原因）
            return ParsedAiOutput.needsReview(rawOutput, errorCode == null ? exception.getMessage() : errorCode, Map.of());
        }
    }

    /**
     * 从 Markdown 围栏代码块中提取 JSON 内容。
     *
     * @param raw 原始文本
     * @return 提取的 JSON 字符串，无围栏块时返回 {@code null}
     */
    private static String fencedJson(String raw) {
        int fence = raw.indexOf("```");
        while (fence >= 0) {
            // 定位围栏行尾（换行符），提取 info 字符串
            int contentStart = raw.indexOf('\n', fence + 3);
            if (contentStart < 0) {
                return null;
            }
            String info = raw.substring(fence + 3, contentStart).trim();
            // 查找闭合围栏
            int end = raw.indexOf("```", contentStart + 1);
            if (end < 0) {
                return null;
            }
            // 无标记或标记为 json 的围栏块视为 JSON 内容
            if (info.isEmpty() || info.equalsIgnoreCase("json")) {
                return raw.substring(contentStart + 1, end).trim();
            }
            // 跳过非 JSON 围栏块（如 java、xml），继续搜索下一个围栏
            fence = raw.indexOf("```", end + 3);
        }
        return null;
    }

    /**
     * 从混合文本中提取 JSON 片段（第一个 {@code {} 或 {@code [} 到最后一个匹配的闭合符）。
     *
     * @param raw 原始文本
     * @return 提取的 JSON 片段，无有效片段时返回 {@code null}
     */
    private static String jsonFragment(String raw) {
        // 找到第一个 JSON 起始位置（对象 { 或数组 [）
        int objectStart = raw.indexOf('{');
        int arrayStart = raw.indexOf('[');
        int start;
        char close;
        if (objectStart < 0 && arrayStart < 0) {
            return null;
        }
        // 数组比对象更靠前（或只有数组）时以数组起始
        if (arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)) {
            start = arrayStart;
            close = ']';
        } else {
            start = objectStart;
            close = '}';
        }
        // 用最后一个匹配的闭合符提取片段（粗略但足以处理 AI 输出中的内嵌 JSON）
        int end = raw.lastIndexOf(close);
        if (end <= start) {
            return null;
        }
        return raw.substring(start, end + 1);
    }
}
