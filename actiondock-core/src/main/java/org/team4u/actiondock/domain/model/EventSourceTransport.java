package org.team4u.actiondock.domain.model;

import java.util.ArrayList;
import java.util.List;

public class EventSourceTransport {
    private EventSourceTransportType type = EventSourceTransportType.HTTP_WEBHOOK;
    private String endpointPath;
    private List<String> contentTypes = new ArrayList<>();

    public EventSourceTransportType getType() {
        return type;
    }

    public EventSourceTransport setType(EventSourceTransportType type) {
        this.type = type == null ? EventSourceTransportType.HTTP_WEBHOOK : type;
        return this;
    }

    public String getEndpointPath() {
        return endpointPath;
    }

    public EventSourceTransport setEndpointPath(String endpointPath) {
        this.endpointPath = endpointPath;
        return this;
    }

    public List<String> getContentTypes() {
        return List.copyOf(contentTypes);
    }

    public EventSourceTransport setContentTypes(List<String> contentTypes) {
        this.contentTypes = contentTypes == null ? new ArrayList<>() : new ArrayList<>(contentTypes);
        return this;
    }
}
