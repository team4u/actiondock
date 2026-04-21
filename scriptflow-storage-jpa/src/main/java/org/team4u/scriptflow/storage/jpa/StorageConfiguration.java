package org.team4u.scriptflow.storage.jpa;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.team4u.scriptflow.domain.port.ExecutionRepository;
import org.team4u.scriptflow.domain.port.JsonCodec;
import org.team4u.scriptflow.domain.port.ScriptRepository;
import org.team4u.scriptflow.storage.jpa.adapter.JpaExecutionRepositoryAdapter;
import org.team4u.scriptflow.storage.jpa.adapter.JpaScriptRepositoryAdapter;
import org.team4u.scriptflow.storage.jpa.json.JacksonJsonCodec;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataExecutionEntityRepository;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataScriptEntityRepository;

@Configuration
public class StorageConfiguration {
    @Bean
    public JsonCodec jsonCodec(ObjectMapper objectMapper) {
        return new JacksonJsonCodec(objectMapper);
    }

    @Bean
    public ScriptRepository scriptRepository(SpringDataScriptEntityRepository repository, JsonCodec jsonCodec) {
        return new JpaScriptRepositoryAdapter(repository, jsonCodec);
    }

    @Bean
    public ExecutionRepository executionRepository(SpringDataExecutionEntityRepository repository, JsonCodec jsonCodec) {
        return new JpaExecutionRepositoryAdapter(repository, jsonCodec);
    }
}
