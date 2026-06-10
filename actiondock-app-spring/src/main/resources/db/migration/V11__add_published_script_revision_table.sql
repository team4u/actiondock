create table if not exists published_script_revision(
    id character varying(255) not null,
    script_id character varying(255) not null,
    version_value integer not null,
    published_at timestamp(6),
    name character varying(255),
    type character varying(255),
    packaging character varying(255),
    owner character varying(255),
    source character large object,
    python_requirements character large object,
    input_schema_json character large object,
    output_schema_json character large object,
    description character large object,
    tags_json character large object,
    script_dependencies_json character large object,
    plugin_dependencies_json character large object,
    ai_dependencies_json character large object,
    primary key(id)
);

create index if not exists idx_published_script_revision_script_id on published_script_revision(script_id);

alter table script_definition add column if not exists published_revision_id character varying(255);
alter table script_definition add column if not exists published_at timestamp(6);

insert into published_script_revision(
    id,
    script_id,
    version_value,
    published_at,
    name,
    type,
    packaging,
    owner,
    source,
    python_requirements,
    input_schema_json,
    output_schema_json,
    description,
    tags_json,
    script_dependencies_json,
    plugin_dependencies_json,
    ai_dependencies_json
)
select
    script_definition.id || ':published:' || cast(coalesce(script_definition.version_value, 1) as character varying(255)),
    script_definition.id,
    coalesce(script_definition.version_value, 1),
    coalesce(script_definition.updated_at, script_definition.created_at),
    coalesce(script_definition.published_name, script_definition.name),
    coalesce(script_definition.published_type, script_definition.type),
    coalesce(script_definition.published_packaging, script_definition.packaging),
    coalesce(script_definition.published_owner, script_definition.owner),
    coalesce(script_definition.published_source, script_definition.source),
    coalesce(script_definition.published_python_requirements, script_definition.python_requirements),
    coalesce(script_definition.published_input_schema_json, script_definition.input_schema_json),
    coalesce(script_definition.published_output_schema_json, script_definition.output_schema_json),
    coalesce(script_definition.published_description, script_definition.description),
    coalesce(script_definition.published_tags_json, script_definition.tags_json),
    coalesce(script_definition.published_script_dependencies_json, script_definition.script_dependencies_json),
    coalesce(script_definition.published_plugin_dependencies_json, script_definition.plugin_dependencies_json),
    coalesce(script_definition.published_ai_dependencies_json, script_definition.ai_dependencies_json)
from script_definition
where (script_definition.status = 'PUBLISHED'
        or script_definition.published_source is not null
        or script_definition.published_name is not null
        or script_definition.published_input_schema_json is not null
        or script_definition.published_output_schema_json is not null)
  and not exists (
        select 1
        from published_script_revision revision
        where revision.script_id = script_definition.id
          and revision.version_value = coalesce(script_definition.version_value, 1)
    );

update script_definition
set published_revision_id = script_definition.id || ':published:' || cast(coalesce(script_definition.version_value, 1) as character varying(255)),
    published_at = coalesce(script_definition.updated_at, script_definition.created_at)
where script_definition.published_revision_id is null
  and exists (
      select 1
      from published_script_revision revision
      where revision.script_id = script_definition.id
        and revision.version_value = coalesce(script_definition.version_value, 1)
  );
