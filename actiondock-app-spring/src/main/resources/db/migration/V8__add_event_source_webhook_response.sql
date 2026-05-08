alter table if exists event_source
    add column if not exists webhook_response_json character large object;
