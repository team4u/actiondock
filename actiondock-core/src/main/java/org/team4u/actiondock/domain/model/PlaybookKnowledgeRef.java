package org.team4u.actiondock.domain.model;

public class PlaybookKnowledgeRef {
    private PlaybookKnowledgeRefType type = PlaybookKnowledgeRefType.FILE;
    private String repositoryId;
    private String path;
    private String markdown;

    public PlaybookKnowledgeRefType getType() {
        return type;
    }

    public PlaybookKnowledgeRef setType(PlaybookKnowledgeRefType type) {
        this.type = type == null ? PlaybookKnowledgeRefType.FILE : type;
        return this;
    }

    public String getRepositoryId() {
        return repositoryId;
    }

    public PlaybookKnowledgeRef setRepositoryId(String repositoryId) {
        this.repositoryId = repositoryId;
        return this;
    }

    public String getPath() {
        return path;
    }

    public PlaybookKnowledgeRef setPath(String path) {
        this.path = path;
        return this;
    }

    public String getMarkdown() {
        return markdown;
    }

    public PlaybookKnowledgeRef setMarkdown(String markdown) {
        this.markdown = markdown;
        return this;
    }
}
