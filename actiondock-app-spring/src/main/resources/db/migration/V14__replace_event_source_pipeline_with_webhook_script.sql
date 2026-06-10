ALTER TABLE event_source ADD COLUMN webhook_script_id VARCHAR(255);

ALTER TABLE event_source DROP COLUMN auth_json;
ALTER TABLE event_source DROP COLUMN normalization_processor_json;
ALTER TABLE event_source DROP COLUMN webhook_response_json;
