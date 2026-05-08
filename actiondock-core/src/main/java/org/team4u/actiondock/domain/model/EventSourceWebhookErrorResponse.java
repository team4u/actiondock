package org.team4u.actiondock.domain.model;

public class EventSourceWebhookErrorResponse {
    private int httpStatus = 500;
    private String msg = "响应生成失败";
    private Object data;

    public int getHttpStatus() {
        return httpStatus;
    }

    public EventSourceWebhookErrorResponse setHttpStatus(int httpStatus) {
        this.httpStatus = httpStatus <= 0 ? 500 : httpStatus;
        return this;
    }

    public String getMsg() {
        return msg;
    }

    public EventSourceWebhookErrorResponse setMsg(String msg) {
        this.msg = msg == null || msg.isBlank() ? "响应生成失败" : msg;
        return this;
    }

    public Object getData() {
        return SchemaValueCopier.copyObject(data);
    }

    public EventSourceWebhookErrorResponse setData(Object data) {
        this.data = SchemaValueCopier.copyObject(data);
        return this;
    }

    public boolean isEmpty() {
        return httpStatus == 500
                && "响应生成失败".equals(msg)
                && data == null;
    }
}
