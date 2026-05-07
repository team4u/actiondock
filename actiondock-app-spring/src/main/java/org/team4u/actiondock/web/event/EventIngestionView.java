package org.team4u.actiondock.web.event;

import org.team4u.actiondock.domain.model.EventDispatchRecord;
import org.team4u.actiondock.domain.model.EventRecord;

import java.util.List;

public record EventIngestionView(
        EventRecord event,
        List<EventDispatchRecord> dispatches
) {
}
