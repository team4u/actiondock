package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.PublishedScriptRevision;

import java.util.List;
import java.util.Optional;

/**
 * 已发布脚本修订仓储端口。
 */
public interface PublishedScriptRevisionRepository {
    PublishedScriptRevision save(PublishedScriptRevision revision);

    Optional<PublishedScriptRevision> findById(String id);

    List<PublishedScriptRevision> findByScriptId(String scriptId);

    void deleteByScriptId(String scriptId);
}
