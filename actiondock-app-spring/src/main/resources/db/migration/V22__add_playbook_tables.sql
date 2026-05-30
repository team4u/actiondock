CREATE TABLE playbook_group (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description CLOB,
    tags_json CLOB,
    default_repository_ids_json CLOB,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    managed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE playbook (
    id VARCHAR(255) PRIMARY KEY,
    group_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description CLOB,
    intent_aliases_json CLOB,
    tags_json CLOB,
    risk_level VARCHAR(32),
    repository_ids_json CLOB,
    knowledge_refs_json CLOB,
    script_refs_json CLOB,
    guide_markdown CLOB NOT NULL,
    stop_conditions_json CLOB,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    managed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    CONSTRAINT fk_playbook_group FOREIGN KEY (group_id) REFERENCES playbook_group(id)
);

CREATE INDEX idx_playbook_group_id ON playbook(group_id);
CREATE INDEX idx_playbook_enabled ON playbook(enabled);
CREATE INDEX idx_playbook_managed ON playbook(managed);

ALTER TABLE repository_ai_package_installation ADD COLUMN playbook_group_ids_json CLOB;
ALTER TABLE repository_ai_package_installation ADD COLUMN playbook_ids_json CLOB;
