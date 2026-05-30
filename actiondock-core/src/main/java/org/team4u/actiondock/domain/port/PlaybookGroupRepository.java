package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.PlaybookGroup;

import java.util.List;
import java.util.Optional;

public interface PlaybookGroupRepository {
    PlaybookGroup save(PlaybookGroup group);

    Optional<PlaybookGroup> findById(String id);

    List<PlaybookGroup> findAll();

    void deleteById(String id);
}
