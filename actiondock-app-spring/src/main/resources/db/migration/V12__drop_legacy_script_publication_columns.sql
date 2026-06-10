drop index if exists idx_script_status;

alter table script_definition drop column if exists status;
alter table script_definition drop column if exists published_name;
alter table script_definition drop column if exists published_type;
alter table script_definition drop column if exists published_packaging;
alter table script_definition drop column if exists published_source;
alter table script_definition drop column if exists published_python_requirements;
alter table script_definition drop column if exists published_owner;
alter table script_definition drop column if exists published_description;
alter table script_definition drop column if exists published_tags_json;
alter table script_definition drop column if exists published_plugin_dependencies_json;
alter table script_definition drop column if exists published_input_schema_json;
alter table script_definition drop column if exists published_output_schema_json;
alter table script_definition drop column if exists published_script_dependencies_json;
alter table script_definition drop column if exists published_ai_dependencies_json;
