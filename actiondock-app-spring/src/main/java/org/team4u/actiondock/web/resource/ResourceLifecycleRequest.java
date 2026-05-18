package org.team4u.actiondock.web.resource;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 统一资源生命周期请求。
 * <p>
 * 当前作为仓库资源的薄 facade，payload 保留各资源已有请求结构。
 */
public class ResourceLifecycleRequest {
    private String resourceType;
    private String operation;
    private String repositoryId;
    private String resourceId;
    private String installedResourceId;
    private JsonNode payload;

    public String getResourceType() {
        return resourceType;
    }

    public void setResourceType(String resourceType) {
        this.resourceType = resourceType;
    }

    public String getOperation() {
        return operation;
    }

    public void setOperation(String operation) {
        this.operation = operation;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public void setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
    }

    public String getResourceId() {
        return resourceId;
    }

    public void setResourceId(String resourceId) {
        this.resourceId = resourceId;
    }

    public String getInstalledResourceId() {
        return installedResourceId;
    }

    public void setInstalledResourceId(String installedResourceId) {
        this.installedResourceId = installedResourceId;
    }

    public JsonNode getPayload() {
        return payload;
    }

    public void setPayload(JsonNode payload) {
        this.payload = payload;
    }
}
