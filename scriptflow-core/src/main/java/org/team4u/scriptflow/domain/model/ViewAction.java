package org.team4u.scriptflow.domain.model;

public class ViewAction {
    private String id;
    private String label;
    private String method;
    private String api;
    private boolean async;

    public String getId() {
        return id;
    }

    public ViewAction setId(String id) {
        this.id = id;
        return this;
    }

    public String getLabel() {
        return label;
    }

    public ViewAction setLabel(String label) {
        this.label = label;
        return this;
    }

    public String getMethod() {
        return method;
    }

    public ViewAction setMethod(String method) {
        this.method = method;
        return this;
    }

    public String getApi() {
        return api;
    }

    public ViewAction setApi(String api) {
        this.api = api;
        return this;
    }

    public boolean isAsync() {
        return async;
    }

    public ViewAction setAsync(boolean async) {
        this.async = async;
        return this;
    }
}
