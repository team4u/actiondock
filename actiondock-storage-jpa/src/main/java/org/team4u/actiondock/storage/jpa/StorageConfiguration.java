package org.team4u.actiondock.storage.jpa;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.actiondock.ai.api.AiAgentProfileRepository;
import org.team4u.actiondock.ai.api.AiAgentRunRepository;
import org.team4u.actiondock.ai.api.AiAgentStepRepository;
import org.team4u.actiondock.ai.api.AiCallLogRepository;
import org.team4u.actiondock.ai.api.AiModelProfileRepository;
import org.team4u.actiondock.ai.api.AiToolsetRepository;
import org.team4u.actiondock.domain.port.ApiAccessTokenRepository;
import org.team4u.actiondock.domain.port.ConfigValueRepository;
import org.team4u.actiondock.domain.port.ExecutionPresetRepository;
import org.team4u.actiondock.domain.port.ExecutionRepository;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.PluginRegistryRepository;
import org.team4u.actiondock.domain.port.RepositoryDefinitionRepository;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.domain.port.RepositoryToolInstallationRepository;
import org.team4u.actiondock.storage.jpa.adapter.JpaConfigValueRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaExecutionPresetRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaExecutionRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaApiAccessTokenRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaAiAgentProfileRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaAiAgentRunRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaAiAgentStepRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaAiCallLogRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaAiModelProfileRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaAiToolsetRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaPluginRegistryRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaRepositoryDefinitionRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaScriptRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaScriptScheduleRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.adapter.JpaRepositoryToolInstallationRepositoryAdapter;
import org.team4u.actiondock.storage.jpa.json.JacksonJsonCodec;
import org.team4u.actiondock.storage.jpa.repo.SpringDataConfigValueRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataExecutionPresetEntityRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataExecutionEntityRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataApiAccessTokenRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiAgentProfileRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiAgentRunRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiAgentStepRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiCallLogRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiModelProfileRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiToolsetRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPluginRegistrationRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataRepositoryDefinitionRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptEntityRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptScheduleEntityRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataRepositoryToolInstallationRepository;

/**
 * JPA 存储层配置，注册仓储端口适配器和 JSON 编解码器 Bean。
 *
 * @author jay.wu
 */
@Configuration
public class StorageConfiguration {
    /**
     * 注册基于 Jackson 的 JSON 编解码器。
     *
     * @param objectMapper Jackson ObjectMapper
     * @return JSON 编解码器实现
     */
    @Bean
    public JsonCodec jsonCodec(ObjectMapper objectMapper) {
        return new JacksonJsonCodec(objectMapper);
    }

    /**
     * 注册全局配置值仓储适配器。
     *
     * @param repository Spring Data 配置值实体仓储
     * @return 配置值仓储端口实现
     */
    @Bean
    public ConfigValueRepository configValueRepository(SpringDataConfigValueRepository repository) {
        return new JpaConfigValueRepositoryAdapter(repository);
    }

    @Bean
    public ApiAccessTokenRepository apiAccessTokenRepository(SpringDataApiAccessTokenRepository repository) {
        return new JpaApiAccessTokenRepositoryAdapter(repository);
    }

    /**
     * 注册脚本定义仓储适配器。
     *
     * @param repository Spring Data 脚本实体仓储
     * @param jsonCodec JSON 编解码器
     * @return 脚本仓储端口实现
     */
    @Bean
    public ScriptRepository scriptRepository(SpringDataScriptEntityRepository repository, JsonCodec jsonCodec) {
        return new JpaScriptRepositoryAdapter(repository, jsonCodec);
    }

    /**
     * 注册执行记录仓储适配器。
     *
     * @param repository Spring Data 执行记录实体仓储
     * @param jsonCodec JSON 编解码器
     * @return 执行记录仓储端口实现
     */
    @Bean
    public ExecutionRepository executionRepository(SpringDataExecutionEntityRepository repository, JsonCodec jsonCodec) {
        return new JpaExecutionRepositoryAdapter(repository, jsonCodec);
    }

    /**
     * 注册脚本调度仓储适配器。
     *
     * @param repository Spring Data 脚本调度实体仓储
     * @param jsonCodec JSON 编解码器
     * @return 脚本调度仓储端口实现
     */
    @Bean
    public ScriptScheduleRepository scriptScheduleRepository(SpringDataScriptScheduleEntityRepository repository, JsonCodec jsonCodec) {
        return new JpaScriptScheduleRepositoryAdapter(repository, jsonCodec);
    }

    /**
     * 注册插件注册仓储适配器。
     *
     * @param repository Spring Data 插件注册实体仓储
     * @param jsonCodec JSON 编解码器
     * @return 插件注册仓储端口实现
     */
    @Bean
    public PluginRegistryRepository pluginRegistryRepository(SpringDataPluginRegistrationRepository repository, JsonCodec jsonCodec) {
        return new JpaPluginRegistryRepositoryAdapter(repository, jsonCodec);
    }

    /**
     * 注册仓库定义仓储适配器。
     *
     * @param repository Spring Data 仓库定义实体仓储
     * @return 仓库定义仓储端口实现
     */
    @Bean
    public RepositoryDefinitionRepository repositoryDefinitionRepository(SpringDataRepositoryDefinitionRepository repository) {
        return new JpaRepositoryDefinitionRepositoryAdapter(repository);
    }

    /**
     * 注册仓库工具安装仓储适配器。
     *
     * @param repository Spring Data 仓库工具安装实体仓储
     * @return 仓库工具安装仓储端口实现
     */
    @Bean
    public RepositoryToolInstallationRepository repositoryToolInstallationRepository(SpringDataRepositoryToolInstallationRepository repository) {
        return new JpaRepositoryToolInstallationRepositoryAdapter(repository);
    }

    /**
     * 注册执行参数预设备储适配器。
     *
     * @param repository Spring Data 执行参数预设实体仓储
     * @param jsonCodec JSON 编解码器
     * @return 执行参数预设备储端口实现
     */
    @Bean
    public ExecutionPresetRepository executionPresetRepository(SpringDataExecutionPresetEntityRepository repository, JsonCodec jsonCodec) {
        return new JpaExecutionPresetRepositoryAdapter(repository, jsonCodec);
    }

    @Bean
    public AiModelProfileRepository aiModelProfileRepository(SpringDataAiModelProfileRepository repository, JsonCodec jsonCodec) {
        return new JpaAiModelProfileRepositoryAdapter(repository, jsonCodec);
    }

    @Bean
    public AiAgentProfileRepository aiAgentProfileRepository(SpringDataAiAgentProfileRepository repository, JsonCodec jsonCodec) {
        return new JpaAiAgentProfileRepositoryAdapter(repository, jsonCodec);
    }

    @Bean
    public AiToolsetRepository aiToolsetRepository(SpringDataAiToolsetRepository repository, JsonCodec jsonCodec) {
        return new JpaAiToolsetRepositoryAdapter(repository, jsonCodec);
    }

    @Bean
    public AiCallLogRepository aiCallLogRepository(SpringDataAiCallLogRepository repository, JsonCodec jsonCodec) {
        return new JpaAiCallLogRepositoryAdapter(repository, jsonCodec);
    }

    @Bean
    public AiAgentRunRepository aiAgentRunRepository(SpringDataAiAgentRunRepository repository, JsonCodec jsonCodec) {
        return new JpaAiAgentRunRepositoryAdapter(repository, jsonCodec);
    }

    @Bean
    public AiAgentStepRepository aiAgentStepRepository(SpringDataAiAgentStepRepository repository, JsonCodec jsonCodec) {
        return new JpaAiAgentStepRepositoryAdapter(repository, jsonCodec);
    }
}
