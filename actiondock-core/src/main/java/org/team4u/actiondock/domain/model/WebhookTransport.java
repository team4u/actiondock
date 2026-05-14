package org.team4u.actiondock.domain.model;

import java.util.ArrayList;
import java.util.List;

public class WebhookTransport {
    private WebhookTransportType type = WebhookTransportType.HTTP_WEBHOOK;
    private String endpointPath;
    private List<String> contentTypes = new ArrayList<>();

    public WebhookTransportType getType() {
        return type;
    }

    public WebhookTransport setType(WebhookTransportType type) {
        this.type = type == null ? WebhookTransportType.HTTP_WEBHOOK : type;
        return this;
    }

    public String getEndpointPath() {
        return endpointPath;
    }

    public WebhookTransport setEndpointPath(String endpointPath) {
        this.endpointPath = endpointPath;
        return this;
    }

    public List<String> getContentTypes() {
        return List.copyOf(contentTypes);
    }

    public WebhookTransport setContentTypes(List<String> contentTypes) {
        this.contentTypes = contentTypes == null ? new ArrayList<>() : new ArrayList<>(contentTypes);
        return this;
    }
}
