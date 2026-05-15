alter table script_definition
    rename column repository_tool_id to repository_script_id;

alter table script_schedule
    rename column repository_tool_id to repository_script_id;

alter table config_value
    rename column repository_tool_id to repository_script_id;
