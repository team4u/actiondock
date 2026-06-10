package org.team4u.actiondock.ai.api;

/**
 * AI 密钥解析器接口。
 * <p>
 * 用于根据键名解析 AI 模型调用所需的密钥（如 API Key），解耦密钥存储与使用。
 *
 * @author jay.wu
 */
@FunctionalInterface
public interface AiSecretResolver {

    /**
     * 根据键名解析密钥值。
     *
     * @param key 密钥名称
     * @return 对应的密钥值
     */
    String resolve(String key);
}
