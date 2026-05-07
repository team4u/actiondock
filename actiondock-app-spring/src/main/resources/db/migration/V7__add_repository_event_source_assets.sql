alter table if exists event_source add column if not exists scope character varying(255);
alter table if exists event_source add column if not exists repository_id character varying(255);
alter table if exists event_source add column if not exists repository_event_source_id character varying(255);
alter table if exists event_source add column if not exists repository_version character varying(255);
alter table if exists event_source add column if not exists source_path character varying(255);
alter table if exists event_source add column if not exists source_commit character varying(255);
alter table if exists event_source add column if not exists source_digest character varying(255);
alter table if exists event_source add column if not exists source_synced_at timestamp(6);
alter table if exists event_source add column if not exists dirty boolean not null default false;
alter table if exists event_source add column if not exists editable boolean not null default true;

alter table if exists event_trigger add column if not exists scope character varying(255);
alter table if exists event_trigger add column if not exists repository_id character varying(255);
alter table if exists event_trigger add column if not exists repository_event_source_id character varying(255);
alter table if exists event_trigger add column if not exists repository_version character varying(255);
alter table if exists event_trigger add column if not exists repository_trigger_id character varying(255);
alter table if exists event_trigger add column if not exists editable boolean not null default true;

create table if not exists repository_event_source_installation(
    source_id character varying(255) not null,
    repository_id character varying(255),
    event_source_id character varying(255),
    name character varying(255),
    version_value character varying(255),
    latest_version character varying(255),
    owner character varying(255),
    description character large object,
    installed_at timestamp(6),
    updated_at timestamp(6),
    primary key(source_id)
);
