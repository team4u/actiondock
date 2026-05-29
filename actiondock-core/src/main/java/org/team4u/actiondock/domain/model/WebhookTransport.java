package org.team4u.actiondock.domain.model;

import java.util.ArrayList;
import java.util.List;

/**
 * Webhook 传输配置领域模型。
 * <p>
 * 定义 Webhook 的传输方式和端点信息，包括传输类型、端点路径以及支持的内容类型列表。
 * 内容类型列表在存取时均进行防御性拷贝，确保内部状态的不可变性。
 *
 * @author jay.wu
 */
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
