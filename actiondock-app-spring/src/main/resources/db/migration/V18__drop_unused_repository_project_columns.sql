alter table if exists repository_definition
    drop column if exists project_marker_path;

alter table if exists repository_definition
    drop column if exists project_aliases_json;
