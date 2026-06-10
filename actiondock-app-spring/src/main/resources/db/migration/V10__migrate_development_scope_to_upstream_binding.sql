insert into upstream_binding(
    id,
    asset_type,
    local_asset_id,
    repository_id,
    upstream_asset_id,
    upstream_version,
    source_path,
    base_commit,
    base_digest,
    last_synced_at,
    created_at,
    updated_at
)
select
    random_uuid(),
    'SCRIPT',
    sd.id,
    sd.repository_id,
    coalesce(sd.repository_tool_id, sd.id),
    sd.repository_version,
    sd.source_path,
    sd.source_commit,
    sd.source_digest,
    sd.source_synced_at,
    sd.created_at,
    sd.updated_at
from script_definition sd
where sd.scope = 'DEVELOPMENT'
  and sd.repository_id is not null
  and not exists (
    select 1
    from upstream_binding ub
    where ub.asset_type = 'SCRIPT'
      and ub.local_asset_id = sd.id
  );

update script_definition
set scope = 'PERSONAL'
where scope = 'DEVELOPMENT';
