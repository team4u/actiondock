ALTER TABLE event_source RENAME COLUMN sample_context_json TO sample_request_json;

ALTER TABLE execution_record DROP COLUMN event_trigger_id;
ALTER TABLE execution_record DROP COLUMN event_record_id;
ALTER TABLE execution_record DROP COLUMN event_dispatch_id;

DROP TABLE event_dispatch;
DROP TABLE event_record;
DROP TABLE event_trigger;
