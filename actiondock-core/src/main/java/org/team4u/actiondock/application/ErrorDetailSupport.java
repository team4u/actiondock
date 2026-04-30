package org.team4u.actiondock.application;

import org.team4u.actiondock.domain.model.ErrorDetail;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.Map;

/**
 * 错误详情工具类，提供异常信息的摘要提取和详情构建。
 *
 * @author jay.wu
 */
public final class ErrorDetailSupport {
    private ErrorDetailSupport() {
    }

    /**
     * 提取异常的摘要信息。
     * <p>
     * 优先返回异常的 message，如果 message 为空则返回异常类的全限定名。
     *
     * @param throwable 异常对象
     * @return 异常摘要文本
     */
    public static String summarize(Throwable throwable) {
        String message = throwable.getMessage();
        if (message != null && !message.isBlank()) {
            return message;
        }
        return throwable.getClass().getName();
    }

    /**
     * 构建异常的详情对象。
     * <p>
     * 包含异常类型全限定名和完整的堆栈跟踪信息。
     *
     * @param throwable 异常对象
     * @return 包含类型和堆栈信息的错误详情
     */
    public static ErrorDetail describe(Throwable throwable) {
        return new ErrorDetail()
                .setType(throwable.getClass().getName())
                .setStackTrace(stackTraceOf(throwable));
    }

    public static ErrorDetail describe(Throwable throwable, Map<String, Object> details) {
        return describe(throwable).setDetails(details);
    }

    private static String stackTraceOf(Throwable throwable) {
        StringWriter buffer = new StringWriter();
        try (PrintWriter writer = new PrintWriter(buffer)) {
            throwable.printStackTrace(writer);
        }
        return buffer.toString();
    }
}
