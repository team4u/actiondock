package org.team4u.actiondock.script;

import groovy.lang.Script;
import org.team4u.actiondock.config.AppProperties;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

/**
 * Groovy 脚本编译缓存，基于 LRU 策略管理已编译的脚本类。
 * <p>
 * 通过源码 SHA-256 哈希作为缓存键，支持并发编译去重和过期淘汰。
 *
 * @author jay.wu
 */
final class CompiledGroovyScriptCache {
    private final boolean enabled;
    private final int maxSize;
    private final Duration expireAfterAccess;
    private final Clock clock;
    private final GroovyCompiler compiler;
    private final Object monitor = new Object();
    private final LinkedHashMap<String, CacheEntry> cache = new LinkedHashMap<>(16, 0.75f, true);
    private final Map<String, CompletableFuture<Class<? extends Script>>> inFlight = new HashMap<>();

    CompiledGroovyScriptCache(AppProperties.Groovy properties,
                              Clock clock,
                              GroovyCompiler compiler) {
        AppProperties.Groovy groovy = properties == null ? new AppProperties.Groovy() : properties;
        this.enabled = groovy.isEnabled();
        this.maxSize = Math.max(1, groovy.getCacheMaxSize());
        this.expireAfterAccess = Duration.ofMinutes(Math.max(1, groovy.getCacheExpireAfterAccessMinutes()));
        this.clock = Objects.requireNonNull(clock, "clock");
        this.compiler = Objects.requireNonNull(compiler, "compiler");
    }

    /**
     * 获取已编译的脚本类，若缓存未命中则编译并缓存。
     * <p>
     * 以源码的 SHA-256 哈希作为缓存键，支持并发编译去重：
     * 当多个线程同时请求编译同一脚本时，只有一个线程执行编译，其余线程等待结果。
     * 每次访问后会淘汰过期和溢出的缓存条目。
     *
     * @param source Groovy 脚本源码
     * @return 编译后的脚本类
     * @throws IllegalStateException 如果脚本编译失败
     */
    Class<? extends Script> getOrCompile(String source) {
        if (!enabled) {
            return compiler.compile(source);
        }

        String cacheKey = cacheKey(source);
        Instant now = clock.instant();
        CompletableFuture<Class<? extends Script>> future;
        boolean shouldCompile = false;

        synchronized (monitor) {
            evictExpired(now);
            CacheEntry cached = cache.get(cacheKey);
            if (cached != null) {
                cached.touch(now);
                return cached.scriptClass();
            }
            future = inFlight.get(cacheKey);
            if (future == null) {
                future = new CompletableFuture<>();
                inFlight.put(cacheKey, future);
                shouldCompile = true;
            }
        }

        if (shouldCompile) {
            return compileAndStore(source, cacheKey, future);
        }

        try {
            Class<? extends Script> compiled = future.join();
            synchronized (monitor) {
                CacheEntry cached = cache.get(cacheKey);
                if (cached != null) {
                    cached.touch(clock.instant());
                }
            }
            return compiled;
        } catch (CompletionException ex) {
            throw rethrow(ex.getCause());
        }
    }

    private Class<? extends Script> compileAndStore(String source,
                                                    String cacheKey,
                                                    CompletableFuture<Class<? extends Script>> future) {
        try {
            Class<? extends Script> compiled = compiler.compile(source);
            Instant compiledAt = clock.instant();
            synchronized (monitor) {
                cache.put(cacheKey, new CacheEntry(compiled, compiledAt));
                evictExpired(compiledAt);
                evictOverflow();
                inFlight.remove(cacheKey);
            }
            future.complete(compiled);
            return compiled;
        } catch (Throwable ex) {
            synchronized (monitor) {
                inFlight.remove(cacheKey);
            }
            future.completeExceptionally(ex);
            throw rethrow(ex);
        }
    }

    private void evictExpired(Instant now) {
        Iterator<Map.Entry<String, CacheEntry>> iterator = cache.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<String, CacheEntry> entry = iterator.next();
            if (entry.getValue().isExpired(now, expireAfterAccess)) {
                iterator.remove();
            }
        }
    }

    private void evictOverflow() {
        while (cache.size() > maxSize) {
            Iterator<Map.Entry<String, CacheEntry>> iterator = cache.entrySet().iterator();
            if (!iterator.hasNext()) {
                return;
            }
            iterator.next();
            iterator.remove();
        }
    }

    private static String cacheKey(String source) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(source.getBytes(StandardCharsets.UTF_8));
            return "groovy:" + HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 algorithm is unavailable", e);
        }
    }

    private static RuntimeException rethrow(Throwable throwable) {
        if (throwable instanceof RuntimeException runtimeException) {
            return runtimeException;
        }
        if (throwable instanceof Error error) {
            throw error;
        }
        return new IllegalStateException("Groovy script compilation failed", throwable);
    }

    @FunctionalInterface
    interface GroovyCompiler {
        Class<? extends Script> compile(String source);
    }

    private static final class CacheEntry {
        private final Class<? extends Script> scriptClass;
        private Instant lastAccessAt;

        private CacheEntry(Class<? extends Script> scriptClass, Instant lastAccessAt) {
            this.scriptClass = scriptClass;
            this.lastAccessAt = lastAccessAt;
        }

        private Class<? extends Script> scriptClass() {
            return scriptClass;
        }

        private void touch(Instant now) {
            lastAccessAt = now;
        }

        private boolean isExpired(Instant now, Duration expireAfterAccess) {
            return lastAccessAt.plus(expireAfterAccess).isBefore(now);
        }
    }
}
