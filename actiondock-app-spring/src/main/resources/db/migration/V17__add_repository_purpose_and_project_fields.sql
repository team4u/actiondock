alter table if exists repository_definition
    add column if not exists purpose character varying(255);

alter table if exists repository_definition
    add column if not exists project_marker_path character varying(255);

alter table if exists repository_definition
    add column if not exists project_aliases_json character large object;

update repository_definition
set purpose = 'CAPABILITY'
where purpose is null;
