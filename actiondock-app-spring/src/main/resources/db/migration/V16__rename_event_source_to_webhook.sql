ALTER TABLE event_source RENAME TO webhook;

ALTER TABLE webhook RENAME COLUMN source_key TO webhook_key;
ALTER TABLE webhook RENAME COLUMN repository_event_source_id TO repository_webhook_id;

ALTER TABLE execution_record RENAME COLUMN event_source_id TO webhook_id;
