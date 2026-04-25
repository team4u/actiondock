package org.team4u.scriptflow.storage.jpa;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.scriptflow.domain.port.ConfigValueRepository;
import org.team4u.scriptflow.domain.port.ExecutionRepository;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.domain.port.PluginRegistryRepository;
import org.team4u.scriptflow.domain.port.RepositoryDefinitionRepository;
import org.team4u.scriptflow.domain.port.ScriptRepository;
import org.team4u.scriptflow.domain.port.ScriptScheduleRepository;
import org.team4u.scriptflow.domain.port.RepositoryToolInstallationRepository;
import org.team4u.scriptflow.storage.jpa.adapter.JpaConfigValueRepositoryAdapter;
import org.team4u.scriptflow.storage.jpa.adapter.JpaExecutionRepositoryAdapter;
import org.team4u.scriptflow.storage.jpa.adapter.JpaPluginRegistryRepositoryAdapter;
import org.team4u.scriptflow.storage.jpa.adapter.JpaRepositoryDefinitionRepositoryAdapter;
import org.team4u.scriptflow.storage.jpa.adapter.JpaScriptRepositoryAdapter;
import org.team4u.scriptflow.storage.jpa.adapter.JpaScriptScheduleRepositoryAdapter;
import org.team4u.scriptflow.storage.jpa.adapter.JpaRepositoryToolInstallationRepositoryAdapter;
import org.team4u.scriptflow.storage.jpa.json.JacksonJsonCodec;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataConfigValueRepository;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataExecutionEntityRepository;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataPluginRegistrationRepository;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataRepositoryDefinitionRepository;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataScriptEntityRepository;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataScriptScheduleEntityRepository;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataRepositoryToolInstallationRepository;

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
}
