package org.team4u.actiondock.web.event;

import org.team4u.actiondock.domain.model.NormalizedEvent;

public class EventTriggerTestRequest {
    private NormalizedEvent event = new NormalizedEvent();
    private boolean execute;

    public NormalizedEvent getEvent() {
        return event;
    }

    public void setEvent(NormalizedEvent event) {
        this.event = event == null ? new NormalizedEvent() : event;
    }

    public boolean isExecute() {
        return execute;
    }

    public void setExecute(boolean execute) {
        this.execute = execute;
    }
}
