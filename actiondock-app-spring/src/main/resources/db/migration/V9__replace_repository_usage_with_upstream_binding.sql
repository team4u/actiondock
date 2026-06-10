alter table if exists repository_definition
    drop column if exists usage;

create table if not exists upstream_binding(
    created_at timestamp(6),
    last_synced_at timestamp(6),
    updated_at timestamp(6),
    asset_type character varying(255) not null,
    base_commit character varying(255),
    base_digest character varying(255),
    id character varying(255) not null,
    local_asset_id character varying(255) not null,
    repository_id character varying(255) not null,
    source_path character varying(255),
    upstream_asset_id character varying(255) not null,
    upstream_version character varying(255),
    primary key(id)
);

create unique index if not exists idx_upstream_binding_local
    on upstream_binding(asset_type nulls first, local_asset_id nulls first);

create unique index if not exists idx_upstream_binding_upstream
    on upstream_binding(asset_type nulls first, repository_id nulls first, upstream_asset_id nulls first);
