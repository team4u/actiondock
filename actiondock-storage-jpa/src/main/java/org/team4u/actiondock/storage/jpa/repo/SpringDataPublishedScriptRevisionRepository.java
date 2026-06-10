package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.PublishedScriptRevisionEntity;

import java.util.List;

public interface SpringDataPublishedScriptRevisionRepository extends JpaRepository<PublishedScriptRevisionEntity, String> {
    List<PublishedScriptRevisionEntity> findByScriptIdOrderByVersionValueDesc(String scriptId);

    void deleteByScriptId(String scriptId);
}
