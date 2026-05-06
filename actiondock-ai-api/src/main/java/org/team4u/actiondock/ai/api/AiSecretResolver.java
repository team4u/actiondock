package org.team4u.actiondock.ai.api;

@FunctionalInterface
public interface AiSecretResolver {
    String resolve(String key);
}
