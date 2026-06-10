CREATE TABLE playbook_session (
    id VARCHAR(255) PRIMARY KEY,
    playbook_id VARCHAR(255) NOT NULL,
    playbook_name VARCHAR(255),
    playbook_version VARCHAR(255),
    playbook_snapshot_hash VARCHAR(255),
    user_prompt CLOB,
    intent CLOB,
    agent_name VARCHAR(255),
    agent_run_id VARCHAR(255),
    repository_ids_json CLOB,
    risk_level_snapshot VARCHAR(32),
    stop_conditions_snapshot_json CLOB,
    status VARCHAR(32) NOT NULL,
    current_phase VARCHAR(32) NOT NULL,
    parent_session_id VARCHAR(255),
    handoff_from_session_id VARCHAR(255),
    handoff_relation VARCHAR(64),
    started_at TIMESTAMP,
    updated_at TIMESTAMP,
    ended_at TIMESTAMP,
    final_summary CLOB,
    failure_reason CLOB
);

CREATE INDEX idx_playbook_session_playbook ON playbook_session(playbook_id);
CREATE INDEX idx_playbook_session_agent_run ON playbook_session(agent_run_id);
CREATE INDEX idx_playbook_session_status ON playbook_session(status);

CREATE TABLE playbook_trace_event (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    external_event_id VARCHAR(255),
    sequence BIGINT NOT NULL,
    phase VARCHAR(32) NOT NULL,
    type VARCHAR(64) NOT NULL,
    actor VARCHAR(64),
    message CLOB,
    ref_type VARCHAR(64),
    ref_id VARCHAR(255),
    decision VARCHAR(64),
    reason CLOB,
    observed_risk VARCHAR(32),
    stop_condition_hit BOOLEAN NOT NULL DEFAULT FALSE,
    stop_condition CLOB,
    payload_json CLOB,
    redacted BOOLEAN NOT NULL DEFAULT FALSE,
    redacted_fields_json CLOB,
    created_at TIMESTAMP,
    CONSTRAINT fk_playbook_trace_session FOREIGN KEY (session_id) REFERENCES playbook_session(id),
    CONSTRAINT uk_playbook_trace_session_sequence UNIQUE (session_id, sequence),
    CONSTRAINT uk_playbook_trace_external_event UNIQUE (session_id, external_event_id)
);

CREATE INDEX idx_playbook_trace_event_session ON playbook_trace_event(session_id);
CREATE INDEX idx_playbook_trace_event_type ON playbook_trace_event(type);
