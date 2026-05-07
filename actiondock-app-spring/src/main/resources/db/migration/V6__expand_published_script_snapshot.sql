alter table script_definition add column if not exists published_owner character varying(255);
alter table script_definition add column if not exists published_description character large object;
alter table script_definition add column if not exists published_tags_json character large object;
alter table script_definition add column if not exists published_plugin_dependencies_json character large object;
