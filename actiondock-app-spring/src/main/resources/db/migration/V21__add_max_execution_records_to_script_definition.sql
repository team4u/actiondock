-- V21: Add max_execution_records column to script_definition table
alter table script_definition add column if not exists max_execution_records integer not null default 1000;
