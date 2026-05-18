package org.team4u.actiondock.storage.jpa.adapter;

import org.springframework.stereotype.Component;

import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.port.JsonCodec;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.storage.jpa.entity.ScriptScheduleEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptScheduleEntityRepository;

import java.util.List;
import java.util.Optional;

/**
 * JPA 脚本调度仓储适配器，将领域层 ScriptScheduleRepository 端口适配到 JPA 实现。
 *
 * @author jay.wu
 */
@Component
public class JpaScriptScheduleRepositoryAdapter implements ScriptScheduleRepository {
    private final SpringDataScriptScheduleEntityRepository repository;
    private final JsonCodec jsonCodec;

    public JpaScriptScheduleRepositoryAdapter(SpringDataScriptScheduleEntityRepository repository, JsonCodec jsonCodec) {
        this.repository = repository;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public ScriptSchedule save(ScriptSchedule schedule) {
        return toDomain(repository.save(toEntity(schedule)));
    }

    @Override
    public Optional<ScriptSchedule> findById(String id) {
        return repository.findById(id).map(this::toDomain);
    }

    @Override
    public List<ScriptSchedule> findAll() {
        return repository.findAllByOrderByCreatedAtDesc().stream().map(this::toDomain).toList();
    }

    @Override
    public List<ScriptSchedule> findByScriptId(String scriptId) {
        return repository.findByScriptIdOrderByCreatedAtDesc(scriptId).stream().map(this::toDomain).toList();
    }

    @Override
    public List<ScriptSchedule> findEnabled() {
        return repository.findByEnabledTrueOrderByCreatedAtAsc().stream().map(this::toDomain).toList();
    }

    @Override
    public void deleteById(String id) {
        repository.deleteById(id);
    }

    @Override
    public void deleteByScriptId(String scriptId) {
        repository.deleteAllByScriptId(scriptId);
    }

    /**
     * 将调度领域对象转换为 JPA 实体。
     * <p>
     * 调度输入使用 JSON 序列化存储。
     *
     * @param schedule 调度领域对象
     * @return JPA 实体
     */
    private ScriptScheduleEntity toEntity(ScriptSchedule schedule) {
        ScriptScheduleEntity entity = new ScriptScheduleEntity();
        entity.setId(schedule.getId());
        entity.setScriptId(schedule.getScriptId());
        entity.setName(schedule.getName());
        entity.setCronExpression(schedule.getCronExpression());
        entity.setInputJson(jsonCodec.write(schedule.getInput()));
        entity.setEnabled(schedule.isEnabled());
        entity.setEditable(schedule.isEditable());
        entity.setRepositoryId(schedule.getRepositoryId());
        entity.setRepositoryScriptId(schedule.getRepositoryScriptId());
        entity.setRepositoryPackageId(schedule.getRepositoryPackageId());
        entity.setRepositoryVersion(schedule.getRepositoryVersion());
        entity.setLastTriggeredAt(schedule.getLastTriggeredAt());
        entity.setLastExecutionId(schedule.getLastExecutionId());
        entity.setCreatedAt(schedule.getCreatedAt());
        entity.setUpdatedAt(schedule.getUpdatedAt());
        return entity;
    }

    /**
     * 将 JPA 实体转换为调度领域对象。
     * <p>
     * JSON 字段反序列化为调度输入 Map。
     *
     * @param entity JPA 实体
     * @return 调度领域对象
     */
    private ScriptSchedule toDomain(ScriptScheduleEntity entity) {
        return new ScriptSchedule()
                .setId(entity.getId())
                .setScriptId(entity.getScriptId())
                .setName(entity.getName())
                .setCronExpression(entity.getCronExpression())
                .setInput(jsonCodec.readMap(entity.getInputJson()))
                .setEnabled(entity.isEnabled())
                .setEditable(entity.isEditable())
                .setRepositoryId(entity.getRepositoryId())
                .setRepositoryScriptId(entity.getRepositoryScriptId())
                .setRepositoryPackageId(entity.getRepositoryPackageId())
                .setRepositoryVersion(entity.getRepositoryVersion())
                .setLastTriggeredAt(entity.getLastTriggeredAt())
                .setLastExecutionId(entity.getLastExecutionId())
                .setCreatedAt(entity.getCreatedAt())
                .setUpdatedAt(entity.getUpdatedAt());
    }
}
