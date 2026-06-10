package org.team4u.actiondock.ai.core;

import java.time.LocalDateTime;
import java.util.Optional;
import java.util.function.BiConsumer;
import java.util.function.Function;

/**
 * AI 实体保存时的时间戳填充工具。
 *
 * @author jay.wu
 */
final class AiTimestampSupport {

    private AiTimestampSupport() {
    }

    static <T> T saveWithTimestamps(T entity,
                                    String id,
                                    Function<String, Optional<T>> finder,
                                    Function<T, LocalDateTime> getCreatedAt,
                                    BiConsumer<T, LocalDateTime> setCreatedAt,
                                    BiConsumer<T, LocalDateTime> setUpdatedAt,
                                    Function<T, T> saver) {
        LocalDateTime now = LocalDateTime.now();
        T existing = finder.apply(id).orElse(null);
        if (existing == null) {
            setCreatedAt.accept(entity, now);
        } else if (getCreatedAt.apply(entity) == null) {
            setCreatedAt.accept(entity, getCreatedAt.apply(existing));
        }
        setUpdatedAt.accept(entity, now);
        return saver.apply(entity);
    }
}
