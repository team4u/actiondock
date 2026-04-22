package org.team4u.scriptflow.application;

import org.team4u.scriptflow.domain.model.ErrorDetail;

import java.io.PrintWriter;
import java.io.StringWriter;

public final class ErrorDetailSupport {
    private ErrorDetailSupport() {
    }

    public static String summarize(Throwable throwable) {
        String message = throwable.getMessage();
        if (message != null && !message.isBlank()) {
            return message;
        }
        return throwable.getClass().getName();
    }

    public static ErrorDetail describe(Throwable throwable) {
        return new ErrorDetail()
                .setType(throwable.getClass().getName())
                .setStackTrace(stackTraceOf(throwable));
    }

    private static String stackTraceOf(Throwable throwable) {
        StringWriter buffer = new StringWriter();
        try (PrintWriter writer = new PrintWriter(buffer)) {
            throwable.printStackTrace(writer);
        }
        return buffer.toString();
    }
}
