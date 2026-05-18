package org.team4u.actiondock.script;

import org.team4u.actiondock.shared.NormalizeUtils;

import org.team4u.actiondock.domain.model.ErrorDetail;
import org.team4u.actiondock.domain.model.ExecutionLogLevel;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * 子进程执行的共享工具方法。
 */
final class ProcessSupport {

    ProcessSupport() {
    }

    record ProcessResult(int exitCode, String stdout, String stderr, boolean timedOut) {
    }

    /**
     * stderr 日志协议前缀，与 Python 脚本端的日志输出协议一致。
     * <p>
     * 解析以该前缀开头的 stderr 行为结构化日志事件。
     */
    record LogEvent(ExecutionLogLevel level, String message) {
    }

    static ProcessResult runProcessToCompletion(Process process,
                                                 String stdin,
                                                 CompletableFuture<String> stdoutFuture,
                                                 CompletableFuture<String> stderrFuture,
                                                 int timeoutSeconds,
                                                 int defaultTimeoutSeconds)
            throws IOException, InterruptedException {
        try (OutputStream stdinStream = process.getOutputStream()) {
            writeStdin(stdinStream, stdin);

            if (timeoutSeconds <= 0) {
                timeoutSeconds = defaultTimeoutSeconds;
            }
            boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
            if (!finished) {
                forceDestroyProcess(process);
            }

            return new ProcessResult(
                    finished ? process.exitValue() : -1,
                    stdoutFuture.join(),
                    stderrFuture.join(),
                    !finished
            );
        }
    }

    static void writeStdin(OutputStream stdinStream, String stdin) throws IOException {
        if (stdin != null) {
            stdinStream.write(stdin.getBytes(StandardCharsets.UTF_8));
            stdinStream.flush();
        }
    }

    static void forceDestroyProcess(Process process) throws InterruptedException {
        process.destroyForcibly();
        process.waitFor();
    }

    // ---- 流读取辅助方法 ----

    /**
     * 读取输入流为 UTF-8 字符串。
     *
     * @param stream 输入流
     * @return 流的字符串内容
     */
    static String readStream(InputStream stream) {
        try (InputStream inputStream = stream) {
            return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to read Python process output", e);
        }
    }

    // ---- 日志解析辅助方法 ----

    /**
     * 逐行读取输入流，对每一行调用 consumer。
     * <p>
     * 非 consumer 消费的行以换行符拼接为结果字符串返回。
     *
     * @param stream        输入流
     * @param lineProcessor 对每行的处理，返回 true 表示该行已消费（不拼入结果）
     * @return 拼接后的非消费行内容
     */
    static String readStreamLineByLine(InputStream stream, java.util.function.Predicate<String> lineProcessor) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder output = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                if (lineProcessor.test(line)) {
                    continue;
                }
                if (output.length() > 0) {
                    output.append('\n');
                }
                output.append(line);
            }
            return output.toString();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to read Python process output", e);
        }
    }

    /**
     * 解析 stderr 行为结构化日志事件。
     * <p>
     * 仅解析以指定前缀开头的行，其他行返回 null。
     *
     * @param line        stderr 行内容
     * @param logPrefix   日志协议前缀
     * @param jsonCodec   JSON 编解码器
     * @return 解析后的日志事件，若非日志行则返回 null
     */
    static LogEvent parseLogEvent(String line, String logPrefix, org.team4u.actiondock.domain.port.JsonCodec jsonCodec) {
        if (line == null || !line.startsWith(logPrefix)) {
            return null;
        }
        try {
            Map<String, Object> value = jsonCodec.readMap(line.substring(logPrefix.length()));
            Object level = value.get("level");
            Object message = value.get("message");
            return new LogEvent(resolveLevel(level), message == null ? "" : String.valueOf(message));
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * 将字符串值解析为 {@link ExecutionLogLevel}，无法识别时回退为 INFO。
     */
    static ExecutionLogLevel resolveLevel(Object value) {
        if (value == null) {
            return ExecutionLogLevel.INFO;
        }
        try {
            return ExecutionLogLevel.valueOf(String.valueOf(value).trim().toUpperCase());
        } catch (IllegalArgumentException ignored) {
            return ExecutionLogLevel.INFO;
        }
    }

    // ---- 错误详情构建辅助方法 ----

    /**
     * 根据进程执行结果构建详细的错误信息。
     *
     * @param code    错误码
     * @param result  进程执行结果
     * @param details 附加详情
     * @return 错误详情
     */
    static ErrorDetail buildErrorDetail(String code, ProcessResult result, Map<String, Object> details) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("code", code);
        values.put("stdout", result.stdout());
        values.put("stderr", result.stderr());
        values.put("exitCode", result.exitCode());
        values.put("timedOut", result.timedOut());
        values.putAll(details);
        return new ErrorDetail()
                .setType(PythonExecutionException.class.getName())
                .setStackTrace((NormalizeUtils.isBlank(result.stderr())) ? result.stdout() : result.stderr())
                .setDetails(values);
    }

    /**
     * 构建不含进程执行结果的简单错误信息。
     *
     * @param code    错误码
     * @param details 附加详情
     * @return 错误详情
     */
    static ErrorDetail buildSimpleErrorDetail(String code, Map<String, Object> details) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("code", code);
        values.putAll(details);
        return new ErrorDetail()
                .setType(PythonExecutionException.class.getName())
                .setStackTrace("")
                .setDetails(values);
    }
}
