package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.PageDefinition;

import java.util.List;
import java.util.Optional;

public interface PageRepository {
    PageDefinition save(PageDefinition definition);

    Optional<PageDefinition> findById(String id);

    List<PageDefinition> findAll();

    void deleteById(String id);
}
