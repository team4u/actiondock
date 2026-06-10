package org.team4u.actiondock.web.common;

import java.util.Collection;
import java.util.List;
import java.util.Objects;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import java.util.stream.Stream;

public final class IntentFilter {
    private IntentFilter() {
    }

    @SafeVarargs
    public static <T> List<T> filter(List<T> items, String intent, Function<T, ?>... extractors) {
        if (intent == null || intent.isBlank()) {
            return items;
        }
        Pattern pattern = compile(intent);
        return items.stream()
                .filter(item -> matches(pattern, item, extractors))
                .toList();
    }

    @SafeVarargs
    private static <T> boolean matches(Pattern pattern, T item, Function<T, ?>... extractors) {
        return Stream.of(extractors)
                .map(extractor -> extractor.apply(item))
                .flatMap(IntentFilter::flatten)
                .filter(Objects::nonNull)
                .map(String::valueOf)
                .anyMatch(value -> pattern.matcher(value).find());
    }

    private static Stream<?> flatten(Object value) {
        if (value instanceof Collection<?> collection) {
            return collection.stream();
        }
        return Stream.of(value);
    }

    private static Pattern compile(String intent) {
        try {
            return Pattern.compile(intent.trim(), Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
        } catch (PatternSyntaxException exception) {
            throw new IllegalArgumentException("intent 正则表达式不合法: " + exception.getDescription(), exception);
        }
    }
}
