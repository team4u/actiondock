create table if not exists repository_local_asset(
    id character varying(255) not null,
    asset_type character varying(255) not null,
    local_asset_id character varying(255) not null,
    repository_id character varying(255) not null,
    upstream_asset_id character varying(255) not null,
    mode character varying(255) not null,
    version_value character varying(255),
    latest_version character varying(255),
    name character varying(255),
    owner character varying(255),
    description character large object,
    source_path character varying(255),
    base_commit character varying(255),
    base_digest character varying(255),
    last_synced_at timestamp(6),
    created_at timestamp(6),
    updated_at timestamp(6),
    primary key(id)
);

create unique index if not exists idx_repository_local_asset_local
    on repository_local_asset(asset_type, local_asset_id);

create unique index if not exists idx_repository_local_asset_upstream
    on repository_local_asset(asset_type, repository_id, upstream_asset_id);

drop table if exists upstream_binding;
drop table if exists repository_tool_installation;
drop table if exists repository_event_source_installation;
