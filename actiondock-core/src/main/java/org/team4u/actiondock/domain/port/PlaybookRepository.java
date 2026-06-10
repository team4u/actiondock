package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.Playbook;

import java.util.List;
import java.util.Optional;

public interface PlaybookRepository {
    Playbook save(Playbook playbook);

    Optional<Playbook> findById(String id);

    List<Playbook> findAll();

    void deleteById(String id);
}
