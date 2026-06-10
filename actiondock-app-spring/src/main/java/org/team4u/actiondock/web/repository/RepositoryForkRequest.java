package org.team4u.actiondock.web.repository;

/**
 * 仓库工具 Fork 请求。
 *
 * @author jay.wu
 */
public class RepositoryForkRequest {
    private String id;
    private String name;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
