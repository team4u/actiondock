package org.team4u.actiondock.config;

import org.springframework.transaction.annotation.Transactional;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;
import org.team4u.actiondock.domain.port.ScriptEngine;
import org.team4u.actiondock.domain.port.ScriptRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;

public class TransactionalScriptApplicationService extends ScriptApplicationService {

    public TransactionalScriptApplicationService(ScriptRepository scriptRepository,
                                                 ScriptEngine scriptEngine,
                                                 ScriptScheduleRepository scriptScheduleRepository,
                                                 RepositoryLocalAssetRepository repositoryLocalAssetRepository) {
        super(scriptRepository, scriptEngine, scriptScheduleRepository, repositoryLocalAssetRepository);
    }

    @Override
    @Transactional
    public ScriptDefinition save(ScriptDefinition definition) {
        return super.save(definition);
    }

    @Override
    @Transactional
    public void delete(String id) {
        super.delete(id);
    }

    @Override
    @Transactional
    public ScriptDefinition publish(String id) {
        return super.publish(id);
    }

    @Override
    @Transactional
    public ScriptDefinition discardDraft(String id) {
        return super.discardDraft(id);
    }

    @Override
    @Transactional
    public ScriptDefinition createFork(String id, String targetId, String targetName) {
        return super.createFork(id, targetId, targetName);
    }
}
