-- Backfill primitive boolean columns after V1 adds them to legacy tables.

update ai_agent_profile set enabled = true where enabled is null;
update ai_model_profile set enabled = true where enabled is null;
update ai_toolset set enabled = true where enabled is null;
update api_access_token set enabled = true where enabled is null;
update config_value set managed = false where managed is null;
update config_value set overridden = false where overridden is null;
update config_value set secret = false where secret is null;
update event_source set enabled = true where enabled is null;
update event_trigger set enabled = true where enabled is null;
update execution_preset set editable = true where editable is null;
update execution_preset set managed = false where managed is null;
update plugin_registration set enabled = true where enabled is null;
update repository_definition set enabled = true where enabled is null;
update script_definition set dirty = false where dirty is null;
update script_definition set editable = true where editable is null;
update script_schedule set editable = true where editable is null;
update script_schedule set enabled = true where enabled is null;
update shared_state_entry set secret = false where secret is null;

alter table ai_agent_profile alter column enabled set not null;
alter table ai_model_profile alter column enabled set not null;
alter table ai_toolset alter column enabled set not null;
alter table api_access_token alter column enabled set not null;
alter table config_value alter column managed set not null;
alter table config_value alter column overridden set not null;
alter table config_value alter column secret set not null;
alter table event_source alter column enabled set not null;
alter table event_trigger alter column enabled set not null;
alter table execution_preset alter column editable set not null;
alter table execution_preset alter column managed set not null;
alter table plugin_registration alter column enabled set not null;
alter table repository_definition alter column enabled set not null;
alter table script_definition alter column dirty set not null;
alter table script_definition alter column editable set not null;
alter table script_schedule alter column editable set not null;
alter table script_schedule alter column enabled set not null;
alter table shared_state_entry alter column secret set not null;
