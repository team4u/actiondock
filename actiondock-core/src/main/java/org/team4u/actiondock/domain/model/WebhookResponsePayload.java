package org.team4u.actiondock.domain.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Webhook 响应载荷领域模型。
 * <p>
 * 封装 Webhook 处理脚本返回的 HTTP 响应信息，包括状态码、响应头和响应体。
 * 所有集合类型字段在存取时均进行防御性拷贝，确保内部状态的不可变性。
 *
 * @author jay.wu
 */
public class WebhookResponsePayload {
    private int status = 200;
    private Map<String, List<String>> headers = new LinkedHashMap<>();
    private Object body;

    public int getStatus() {
        return status;
    }

    public WebhookResponsePayload setStatus(int status) {
        this.status = status <= 0 ? 200 : status;
        return this;
    }

    public Map<String, List<String>> getHeaders() {
        return copy(headers);
    }

    public WebhookResponsePayload setHeaders(Map<String, List<String>> headers) {
        this.headers = copy(headers);
        return this;
    }

    public Object getBody() {
        return SchemaValueCopier.copyObject(body);
    }

    public WebhookResponsePayload setBody(Object body) {
        this.body = SchemaValueCopier.copyObject(body);
        return this;
    }

    private static Map<String, List<String>> copy(Map<String, List<String>> source) {
        Map<String, List<String>> target = new LinkedHashMap<>();
        if (source == null) {
            return target;
        }
        source.forEach((name, values) -> target.put(name, values == null ? List.of() : List.copyOf(new ArrayList<>(values))));
        return target;
    }
}
