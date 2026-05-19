package org.team4u.actiondock.web.repository;

public class InstalledResourceUninstallRequest {
    private String type;
    private String id;

    public String getType() {
        return type;
    }

    public InstalledResourceUninstallRequest setType(String type) {
        this.type = type;
        return this;
    }

    public String getId() {
        return id;
    }

    public InstalledResourceUninstallRequest setId(String id) {
        this.id = id;
        return this;
    }
}
