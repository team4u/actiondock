-- Bootstrap current H2 schema for both fresh installs and pre-Flyway legacy databases.

create table if not exists ai_agent_approval(
    approved_at timestamp(6),
    requested_at timestamp(6),
    action_type character varying(255),
    approved_by character varying(255),
    id character varying(255) not null,
    run_id character varying(255),
    status character varying(255),
    step_id character varying(255),
    proposed_payload_json character large object,
    reject_reason character large object,
    primary key(id)
);

create table if not exists ai_agent_profile(
    enabled boolean not null,
    created_at timestamp(6),
    updated_at timestamp(6),
    id character varying(255) not null,
    model_profile_id character varying(255) not null,
    name character varying(255) not null,
    provider character varying(255) not null,
    description character large object,
    direct_tool_names_json character large object,
    direct_tool_options_json character large object,
    options_json character large object,
    system_prompt character large object,
    toolset_ids_json character large object,
    primary key(id)
);

create table if not exists ai_agent_run(
    total_model_calls integer,
    total_tokens integer,
    total_tool_calls integer,
    finished_at timestamp(6),
    started_at timestamp(6),
    agent_profile character varying(255),
    caller_type character varying(255),
    execution_id character varying(255),
    id character varying(255) not null,
    script_id character varying(255),
    status character varying(255),
    user_id character varying(255),
    error_message character large object,
    input_summary_json character large object,
    output_summary_json character large object,
    primary key(id)
);

create table if not exists ai_agent_step(
    step_index integer,
    created_at timestamp(6),
    latency_ms bigint,
    id character varying(255) not null,
    model_profile character varying(255),
    run_id character varying(255),
    status character varying(255),
    step_type character varying(255),
    tool_name character varying(255),
    tool_permission character varying(255),
    error_message character large object,
    tool_input_json character large object,
    tool_output_json character large object,
    primary key(id)
);

create table if not exists ai_call_log(
    input_tokens integer,
    output_tokens integer,
    total_tokens integer,
    created_at timestamp(6),
    latency_ms bigint,
    action character varying(255),
    agent_run_id character varying(255),
    agent_step_id character varying(255),
    caller_type character varying(255),
    error_type character varying(255),
    execution_id character varying(255),
    id character varying(255) not null,
    model character varying(255),
    model_profile character varying(255),
    plugin_id character varying(255),
    prompt_hash character varying(255),
    provider character varying(255),
    script_id character varying(255),
    status character varying(255),
    error_message character large object,
    request_summary_json character large object,
    response_summary_json character large object,
    primary key(id)
);

create table if not exists ai_model_profile(
    enabled boolean not null,
    created_at timestamp(6),
    updated_at timestamp(6),
    api_key_config_key character varying(255),
    base_url character varying(255),
    id character varying(255) not null,
    model_name character varying(255) not null,
    model_provider character varying(255) not null,
    name character varying(255) not null,
    provider character varying(255) not null,
    capabilities_json character large object not null,
    default_options_json character large object,
    limits_json character large object,
    primary key(id)
);

create table if not exists ai_toolset(
    enabled boolean not null,
    created_at timestamp(6),
    updated_at timestamp(6),
    id character varying(255) not null,
    max_permission character varying(255) not null,
    name character varying(255) not null,
    description character large object,
    tool_names_json character large object not null,
    tool_options_json character large object,
    primary key(id)
);

create table if not exists api_access_token(
    enabled boolean not null,
    created_at timestamp(6),
    last_used_at timestamp(6),
    updated_at timestamp(6),
    id character varying(255) not null,
    name character varying(255),
    token_hash character varying(255),
    token_preview character varying(255),
    primary key(id)
);

create table if not exists config_value(
    managed boolean not null,
    overridden boolean not null,
    secret boolean not null,
    created_at timestamp(6),
    updated_at timestamp(6),
    config_key character varying(255) not null,
    description character varying(255),
    publish_mode character varying(255),
    repository_id character varying(255),
    repository_tool_id character varying(255),
    repository_version character varying(255),
    config_value character large object not null,
    primary key(config_key)
);

create table if not exists event_dispatch(
    filter_matched boolean,
    created_at timestamp(6),
    updated_at timestamp(6),
    event_id character varying(255) not null,
    execution_id character varying(255),
    execution_status character varying(255),
    id character varying(255) not null,
    idempotency_key character varying(255),
    source_id character varying(255) not null,
    status character varying(255) not null,
    target_script_id character varying(255) not null,
    trigger_id character varying(255) not null,
    error_message character large object,
    mapped_input_json character large object,
    primary key(id)
);

create table if not exists event_record(
    created_at timestamp(6),
    actor character varying(255),
    event_type character varying(255),
    external_event_id character varying(255),
    id character varying(255) not null,
    source_id character varying(255) not null,
    source_key character varying(255) not null,
    status character varying(255) not null,
    subject character varying(255),
    error_message character large object,
    normalized_event_json character large object,
    raw_body_json character large object,
    raw_headers_json character large object,
    raw_query_json character large object,
    primary key(id)
);

create table if not exists event_source(
    enabled boolean not null,
    created_at timestamp(6),
    last_received_at timestamp(6),
    updated_at timestamp(6),
    id character varying(255) not null,
    name character varying(255) not null,
    source_key character varying(255) not null,
    auth_json character large object,
    description character large object,
    normalization_processor_json character large object,
    sample_context_json character large object,
    transport_json character large object,
    primary key(id)
);

create table if not exists event_trigger(
    enabled boolean not null,
    created_at timestamp(6),
    last_triggered_at timestamp(6),
    updated_at timestamp(6),
    id character varying(255) not null,
    last_event_id character varying(255),
    last_execution_id character varying(255),
    last_execution_status character varying(255),
    name character varying(255) not null,
    response_view character varying(255) not null,
    source_id character varying(255) not null,
    submit_mode character varying(255) not null,
    target_script_id character varying(255) not null,
    description character large object,
    filter_processor_json character large object,
    idempotency_processor_json character large object,
    input_processor_json character large object,
    primary key(id)
);

create table if not exists execution_preset(
    editable boolean not null,
    managed boolean not null,
    created_at timestamp(6),
    updated_at timestamp(6),
    id character varying(255) not null,
    name character varying(255) not null,
    repository_id character varying(255),
    repository_package_id character varying(255),
    repository_version character varying(255),
    script_id character varying(255) not null,
    input_json character large object,
    primary key(id)
);

create table if not exists execution_record(
    created_at timestamp(6),
    finished_at timestamp(6),
    started_at timestamp(6),
    agent_run_id character varying(255),
    agent_step_id character varying(255),
    error_type character varying(255),
    event_dispatch_id character varying(255),
    event_record_id character varying(255),
    event_source_id character varying(255),
    event_trigger_id character varying(255),
    id character varying(255) not null,
    schedule_id character varying(255),
    script_id character varying(255) not null,
    status character varying(255) not null,
    submit_mode character varying(255) not null,
    trigger_source character varying(255) not null,
    error_details_json character large object,
    error_message character large object,
    error_stack_trace character large object,
    input_json character large object,
    logs_json character large object,
    output_json character large object,
    primary key(id)
);

create table if not exists plugin_registration(
    enabled boolean not null,
    installed_at timestamp(6),
    updated_at timestamp(6),
    file_name character varying(255) not null,
    name character varying(255) not null,
    plugin_id character varying(255) not null,
    repository_id character varying(255),
    repository_plugin_id character varying(255),
    repository_version character varying(255),
    version character varying(255),
    actions_json character large object,
    config_schema_json character large object,
    default_config_json character large object,
    description character large object,
    primary key(plugin_id)
);

create table if not exists repository_ai_package_installation(
    installed_at timestamp(6),
    updated_at timestamp(6),
    entry_agent_id character varying(255),
    installation_id character varying(255) not null,
    latest_version character varying(255),
    name character varying(255),
    owner character varying(255),
    package_id character varying(255),
    repository_id character varying(255),
    version_value character varying(255),
    agent_ids_json character large object,
    description character large object,
    model_ids_json character large object,
    preset_ids_json character large object,
    schedule_ids_json character large object,
    script_ids_json character large object,
    toolset_ids_json character large object,
    primary key(installation_id)
);

create table if not exists repository_definition(
    enabled boolean not null,
    created_at timestamp(6),
    last_synced_at timestamp(6),
    updated_at timestamp(6),
    branch character varying(255),
    description character varying(255),
    id character varying(255) not null,
    name character varying(255),
    trust_level character varying(255),
    type character varying(255),
    url character varying(255),
    usage character varying(255),
    primary key(id)
);

create table if not exists repository_tool_installation(
    installed_at timestamp(6),
    updated_at timestamp(6),
    latest_version character varying(255),
    name character varying(255),
    owner character varying(255),
    repository_id character varying(255),
    tool_id character varying(255) not null,
    version_value character varying(255),
    description character large object,
    primary key(tool_id)
);

create table if not exists script_definition(
    dirty boolean not null,
    editable boolean not null,
    version_value integer,
    created_at timestamp(6),
    source_synced_at timestamp(6),
    updated_at timestamp(6),
    id character varying(255) not null,
    name character varying(255) not null,
    owner character varying(255),
    packaging character varying(255),
    published_name character varying(255),
    published_packaging character varying(255),
    published_type character varying(255),
    repository_id character varying(255),
    repository_tool_id character varying(255),
    repository_version character varying(255),
    scope character varying(255),
    source_commit character varying(255),
    source_digest character varying(255),
    source_path character varying(255),
    status character varying(255),
    type character varying(255) not null,
    ai_dependencies_json character large object,
    description character large object,
    input_schema_json character large object,
    output_schema_json character large object,
    plugin_dependencies_json character large object,
    published_ai_dependencies_json character large object,
    published_input_schema_json character large object,
    published_output_schema_json character large object,
    published_python_requirements character large object,
    published_script_dependencies_json character large object,
    published_source character large object,
    python_requirements character large object,
    script_dependencies_json character large object,
    source character large object not null,
    tags_json character large object,
    primary key(id)
);

create table if not exists script_schedule(
    editable boolean not null,
    enabled boolean not null,
    created_at timestamp(6),
    last_triggered_at timestamp(6),
    updated_at timestamp(6),
    cron_expression character varying(255) not null,
    id character varying(255) not null,
    last_execution_id character varying(255),
    name character varying(255) not null,
    repository_id character varying(255),
    repository_package_id character varying(255),
    repository_tool_id character varying(255),
    repository_version character varying(255),
    script_id character varying(255) not null,
    input_json character large object,
    primary key(id)
);

create table if not exists shared_state_entry(
    secret boolean not null,
    created_at timestamp(6),
    expires_at timestamp(6),
    updated_at timestamp(6),
    version_value bigint,
    id character varying(255) not null,
    last_writer_execution_id character varying(255),
    last_writer_script_id character varying(255),
    state_key character varying(255) not null,
    state_namespace character varying(255) not null,
    value_json character large object,
    primary key(id)
);

-- Converge legacy tables by adding any columns introduced after their original creation.

alter table ai_agent_approval add column if not exists approved_at timestamp(6);
alter table ai_agent_approval add column if not exists requested_at timestamp(6);
alter table ai_agent_approval add column if not exists action_type character varying(255);
alter table ai_agent_approval add column if not exists approved_by character varying(255);
alter table ai_agent_approval add column if not exists id character varying(255);
alter table ai_agent_approval add column if not exists run_id character varying(255);
alter table ai_agent_approval add column if not exists status character varying(255);
alter table ai_agent_approval add column if not exists step_id character varying(255);
alter table ai_agent_approval add column if not exists proposed_payload_json character large object;
alter table ai_agent_approval add column if not exists reject_reason character large object;
alter table ai_agent_profile add column if not exists enabled boolean;
alter table ai_agent_profile add column if not exists created_at timestamp(6);
alter table ai_agent_profile add column if not exists updated_at timestamp(6);
alter table ai_agent_profile add column if not exists id character varying(255);
alter table ai_agent_profile add column if not exists model_profile_id character varying(255);
alter table ai_agent_profile add column if not exists name character varying(255);
alter table ai_agent_profile add column if not exists provider character varying(255);
alter table ai_agent_profile add column if not exists description character large object;
alter table ai_agent_profile add column if not exists direct_tool_names_json character large object;
alter table ai_agent_profile add column if not exists direct_tool_options_json character large object;
alter table ai_agent_profile add column if not exists options_json character large object;
alter table ai_agent_profile add column if not exists system_prompt character large object;
alter table ai_agent_profile add column if not exists toolset_ids_json character large object;
alter table ai_agent_run add column if not exists total_model_calls integer;
alter table ai_agent_run add column if not exists total_tokens integer;
alter table ai_agent_run add column if not exists total_tool_calls integer;
alter table ai_agent_run add column if not exists finished_at timestamp(6);
alter table ai_agent_run add column if not exists started_at timestamp(6);
alter table ai_agent_run add column if not exists agent_profile character varying(255);
alter table ai_agent_run add column if not exists caller_type character varying(255);
alter table ai_agent_run add column if not exists execution_id character varying(255);
alter table ai_agent_run add column if not exists id character varying(255);
alter table ai_agent_run add column if not exists script_id character varying(255);
alter table ai_agent_run add column if not exists status character varying(255);
alter table ai_agent_run add column if not exists user_id character varying(255);
alter table ai_agent_run add column if not exists error_message character large object;
alter table ai_agent_run add column if not exists input_summary_json character large object;
alter table ai_agent_run add column if not exists output_summary_json character large object;
alter table ai_agent_step add column if not exists step_index integer;
alter table ai_agent_step add column if not exists created_at timestamp(6);
alter table ai_agent_step add column if not exists latency_ms bigint;
alter table ai_agent_step add column if not exists id character varying(255);
alter table ai_agent_step add column if not exists model_profile character varying(255);
alter table ai_agent_step add column if not exists run_id character varying(255);
alter table ai_agent_step add column if not exists status character varying(255);
alter table ai_agent_step add column if not exists step_type character varying(255);
alter table ai_agent_step add column if not exists tool_name character varying(255);
alter table ai_agent_step add column if not exists tool_permission character varying(255);
alter table ai_agent_step add column if not exists error_message character large object;
alter table ai_agent_step add column if not exists tool_input_json character large object;
alter table ai_agent_step add column if not exists tool_output_json character large object;
alter table ai_call_log add column if not exists input_tokens integer;
alter table ai_call_log add column if not exists output_tokens integer;
alter table ai_call_log add column if not exists total_tokens integer;
alter table ai_call_log add column if not exists created_at timestamp(6);
alter table ai_call_log add column if not exists latency_ms bigint;
alter table ai_call_log add column if not exists action character varying(255);
alter table ai_call_log add column if not exists agent_run_id character varying(255);
alter table ai_call_log add column if not exists agent_step_id character varying(255);
alter table ai_call_log add column if not exists caller_type character varying(255);
alter table ai_call_log add column if not exists error_type character varying(255);
alter table ai_call_log add column if not exists execution_id character varying(255);
alter table ai_call_log add column if not exists id character varying(255);
alter table ai_call_log add column if not exists model character varying(255);
alter table ai_call_log add column if not exists model_profile character varying(255);
alter table ai_call_log add column if not exists plugin_id character varying(255);
alter table ai_call_log add column if not exists prompt_hash character varying(255);
alter table ai_call_log add column if not exists provider character varying(255);
alter table ai_call_log add column if not exists script_id character varying(255);
alter table ai_call_log add column if not exists status character varying(255);
alter table ai_call_log add column if not exists error_message character large object;
alter table ai_call_log add column if not exists request_summary_json character large object;
alter table ai_call_log add column if not exists response_summary_json character large object;
alter table ai_model_profile add column if not exists enabled boolean;
alter table ai_model_profile add column if not exists created_at timestamp(6);
alter table ai_model_profile add column if not exists updated_at timestamp(6);
alter table ai_model_profile add column if not exists api_key_config_key character varying(255);
alter table ai_model_profile add column if not exists base_url character varying(255);
alter table ai_model_profile add column if not exists id character varying(255);
alter table ai_model_profile add column if not exists model_name character varying(255);
alter table ai_model_profile add column if not exists model_provider character varying(255);
alter table ai_model_profile add column if not exists name character varying(255);
alter table ai_model_profile add column if not exists provider character varying(255);
alter table ai_model_profile add column if not exists capabilities_json character large object;
alter table ai_model_profile add column if not exists default_options_json character large object;
alter table ai_model_profile add column if not exists limits_json character large object;
alter table ai_toolset add column if not exists enabled boolean;
alter table ai_toolset add column if not exists created_at timestamp(6);
alter table ai_toolset add column if not exists updated_at timestamp(6);
alter table ai_toolset add column if not exists id character varying(255);
alter table ai_toolset add column if not exists max_permission character varying(255);
alter table ai_toolset add column if not exists name character varying(255);
alter table ai_toolset add column if not exists description character large object;
alter table ai_toolset add column if not exists tool_names_json character large object;
alter table ai_toolset add column if not exists tool_options_json character large object;
alter table api_access_token add column if not exists enabled boolean;
alter table api_access_token add column if not exists created_at timestamp(6);
alter table api_access_token add column if not exists last_used_at timestamp(6);
alter table api_access_token add column if not exists updated_at timestamp(6);
alter table api_access_token add column if not exists id character varying(255);
alter table api_access_token add column if not exists name character varying(255);
alter table api_access_token add column if not exists token_hash character varying(255);
alter table api_access_token add column if not exists token_preview character varying(255);
alter table config_value add column if not exists managed boolean;
alter table config_value add column if not exists overridden boolean;
alter table config_value add column if not exists secret boolean;
alter table config_value add column if not exists created_at timestamp(6);
alter table config_value add column if not exists updated_at timestamp(6);
alter table config_value add column if not exists config_key character varying(255);
alter table config_value add column if not exists description character varying(255);
alter table config_value add column if not exists publish_mode character varying(255);
alter table config_value add column if not exists repository_id character varying(255);
alter table config_value add column if not exists repository_tool_id character varying(255);
alter table config_value add column if not exists repository_version character varying(255);
alter table config_value add column if not exists config_value character large object;
alter table event_dispatch add column if not exists filter_matched boolean;
alter table event_dispatch add column if not exists created_at timestamp(6);
alter table event_dispatch add column if not exists updated_at timestamp(6);
alter table event_dispatch add column if not exists event_id character varying(255);
alter table event_dispatch add column if not exists execution_id character varying(255);
alter table event_dispatch add column if not exists execution_status character varying(255);
alter table event_dispatch add column if not exists id character varying(255);
alter table event_dispatch add column if not exists idempotency_key character varying(255);
alter table event_dispatch add column if not exists source_id character varying(255);
alter table event_dispatch add column if not exists status character varying(255);
alter table event_dispatch add column if not exists target_script_id character varying(255);
alter table event_dispatch add column if not exists trigger_id character varying(255);
alter table event_dispatch add column if not exists error_message character large object;
alter table event_dispatch add column if not exists mapped_input_json character large object;
alter table event_record add column if not exists created_at timestamp(6);
alter table event_record add column if not exists actor character varying(255);
alter table event_record add column if not exists event_type character varying(255);
alter table event_record add column if not exists external_event_id character varying(255);
alter table event_record add column if not exists id character varying(255);
alter table event_record add column if not exists source_id character varying(255);
alter table event_record add column if not exists source_key character varying(255);
alter table event_record add column if not exists status character varying(255);
alter table event_record add column if not exists subject character varying(255);
alter table event_record add column if not exists error_message character large object;
alter table event_record add column if not exists normalized_event_json character large object;
alter table event_record add column if not exists raw_body_json character large object;
alter table event_record add column if not exists raw_headers_json character large object;
alter table event_record add column if not exists raw_query_json character large object;
alter table event_source add column if not exists enabled boolean;
alter table event_source add column if not exists created_at timestamp(6);
alter table event_source add column if not exists last_received_at timestamp(6);
alter table event_source add column if not exists updated_at timestamp(6);
alter table event_source add column if not exists id character varying(255);
alter table event_source add column if not exists name character varying(255);
alter table event_source add column if not exists source_key character varying(255);
alter table event_source add column if not exists auth_json character large object;
alter table event_source add column if not exists description character large object;
alter table event_source add column if not exists normalization_processor_json character large object;
alter table event_source add column if not exists sample_context_json character large object;
alter table event_source add column if not exists transport_json character large object;
alter table event_trigger add column if not exists enabled boolean;
alter table event_trigger add column if not exists created_at timestamp(6);
alter table event_trigger add column if not exists last_triggered_at timestamp(6);
alter table event_trigger add column if not exists updated_at timestamp(6);
alter table event_trigger add column if not exists id character varying(255);
alter table event_trigger add column if not exists last_event_id character varying(255);
alter table event_trigger add column if not exists last_execution_id character varying(255);
alter table event_trigger add column if not exists last_execution_status character varying(255);
alter table event_trigger add column if not exists name character varying(255);
alter table event_trigger add column if not exists response_view character varying(255);
alter table event_trigger add column if not exists source_id character varying(255);
alter table event_trigger add column if not exists submit_mode character varying(255);
alter table event_trigger add column if not exists target_script_id character varying(255);
alter table event_trigger add column if not exists description character large object;
alter table event_trigger add column if not exists filter_processor_json character large object;
alter table event_trigger add column if not exists idempotency_processor_json character large object;
alter table event_trigger add column if not exists input_processor_json character large object;
alter table execution_preset add column if not exists editable boolean;
alter table execution_preset add column if not exists managed boolean;
alter table execution_preset add column if not exists created_at timestamp(6);
alter table execution_preset add column if not exists updated_at timestamp(6);
alter table execution_preset add column if not exists id character varying(255);
alter table execution_preset add column if not exists name character varying(255);
alter table execution_preset add column if not exists repository_id character varying(255);
alter table execution_preset add column if not exists repository_package_id character varying(255);
alter table execution_preset add column if not exists repository_version character varying(255);
alter table execution_preset add column if not exists script_id character varying(255);
alter table execution_preset add column if not exists input_json character large object;
alter table execution_record add column if not exists created_at timestamp(6);
alter table execution_record add column if not exists finished_at timestamp(6);
alter table execution_record add column if not exists started_at timestamp(6);
alter table execution_record add column if not exists agent_run_id character varying(255);
alter table execution_record add column if not exists agent_step_id character varying(255);
alter table execution_record add column if not exists error_type character varying(255);
alter table execution_record add column if not exists event_dispatch_id character varying(255);
alter table execution_record add column if not exists event_record_id character varying(255);
alter table execution_record add column if not exists event_source_id character varying(255);
alter table execution_record add column if not exists event_trigger_id character varying(255);
alter table execution_record add column if not exists id character varying(255);
alter table execution_record add column if not exists schedule_id character varying(255);
alter table execution_record add column if not exists script_id character varying(255);
alter table execution_record add column if not exists status character varying(255);
alter table execution_record add column if not exists submit_mode character varying(255);
alter table execution_record add column if not exists trigger_source character varying(255);
alter table execution_record add column if not exists error_details_json character large object;
alter table execution_record add column if not exists error_message character large object;
alter table execution_record add column if not exists error_stack_trace character large object;
alter table execution_record add column if not exists input_json character large object;
alter table execution_record add column if not exists logs_json character large object;
alter table execution_record add column if not exists output_json character large object;
alter table plugin_registration add column if not exists enabled boolean;
alter table plugin_registration add column if not exists installed_at timestamp(6);
alter table plugin_registration add column if not exists updated_at timestamp(6);
alter table plugin_registration add column if not exists file_name character varying(255);
alter table plugin_registration add column if not exists name character varying(255);
alter table plugin_registration add column if not exists plugin_id character varying(255);
alter table plugin_registration add column if not exists repository_id character varying(255);
alter table plugin_registration add column if not exists repository_plugin_id character varying(255);
alter table plugin_registration add column if not exists repository_version character varying(255);
alter table plugin_registration add column if not exists version character varying(255);
alter table plugin_registration add column if not exists actions_json character large object;
alter table plugin_registration add column if not exists config_schema_json character large object;
alter table plugin_registration add column if not exists default_config_json character large object;
alter table plugin_registration add column if not exists description character large object;
alter table repository_ai_package_installation add column if not exists installed_at timestamp(6);
alter table repository_ai_package_installation add column if not exists updated_at timestamp(6);
alter table repository_ai_package_installation add column if not exists entry_agent_id character varying(255);
alter table repository_ai_package_installation add column if not exists installation_id character varying(255);
alter table repository_ai_package_installation add column if not exists latest_version character varying(255);
alter table repository_ai_package_installation add column if not exists name character varying(255);
alter table repository_ai_package_installation add column if not exists owner character varying(255);
alter table repository_ai_package_installation add column if not exists package_id character varying(255);
alter table repository_ai_package_installation add column if not exists repository_id character varying(255);
alter table repository_ai_package_installation add column if not exists version_value character varying(255);
alter table repository_ai_package_installation add column if not exists agent_ids_json character large object;
alter table repository_ai_package_installation add column if not exists description character large object;
alter table repository_ai_package_installation add column if not exists model_ids_json character large object;
alter table repository_ai_package_installation add column if not exists preset_ids_json character large object;
alter table repository_ai_package_installation add column if not exists schedule_ids_json character large object;
alter table repository_ai_package_installation add column if not exists script_ids_json character large object;
alter table repository_ai_package_installation add column if not exists toolset_ids_json character large object;
alter table repository_definition add column if not exists enabled boolean;
alter table repository_definition add column if not exists created_at timestamp(6);
alter table repository_definition add column if not exists last_synced_at timestamp(6);
alter table repository_definition add column if not exists updated_at timestamp(6);
alter table repository_definition add column if not exists branch character varying(255);
alter table repository_definition add column if not exists description character varying(255);
alter table repository_definition add column if not exists id character varying(255);
alter table repository_definition add column if not exists name character varying(255);
alter table repository_definition add column if not exists trust_level character varying(255);
alter table repository_definition add column if not exists type character varying(255);
alter table repository_definition add column if not exists url character varying(255);
alter table repository_definition add column if not exists usage character varying(255);
alter table repository_tool_installation add column if not exists installed_at timestamp(6);
alter table repository_tool_installation add column if not exists updated_at timestamp(6);
alter table repository_tool_installation add column if not exists latest_version character varying(255);
alter table repository_tool_installation add column if not exists name character varying(255);
alter table repository_tool_installation add column if not exists owner character varying(255);
alter table repository_tool_installation add column if not exists repository_id character varying(255);
alter table repository_tool_installation add column if not exists tool_id character varying(255);
alter table repository_tool_installation add column if not exists version_value character varying(255);
alter table repository_tool_installation add column if not exists description character large object;
alter table script_definition add column if not exists dirty boolean;
alter table script_definition add column if not exists editable boolean;
alter table script_definition add column if not exists version_value integer;
alter table script_definition add column if not exists created_at timestamp(6);
alter table script_definition add column if not exists source_synced_at timestamp(6);
alter table script_definition add column if not exists updated_at timestamp(6);
alter table script_definition add column if not exists id character varying(255);
alter table script_definition add column if not exists name character varying(255);
alter table script_definition add column if not exists owner character varying(255);
alter table script_definition add column if not exists packaging character varying(255);
alter table script_definition add column if not exists published_name character varying(255);
alter table script_definition add column if not exists published_packaging character varying(255);
alter table script_definition add column if not exists published_type character varying(255);
alter table script_definition add column if not exists repository_id character varying(255);
alter table script_definition add column if not exists repository_tool_id character varying(255);
alter table script_definition add column if not exists repository_version character varying(255);
alter table script_definition add column if not exists scope character varying(255);
alter table script_definition add column if not exists source_commit character varying(255);
alter table script_definition add column if not exists source_digest character varying(255);
alter table script_definition add column if not exists source_path character varying(255);
alter table script_definition add column if not exists status character varying(255);
alter table script_definition add column if not exists type character varying(255);
alter table script_definition add column if not exists ai_dependencies_json character large object;
alter table script_definition add column if not exists description character large object;
alter table script_definition add column if not exists input_schema_json character large object;
alter table script_definition add column if not exists output_schema_json character large object;
alter table script_definition add column if not exists plugin_dependencies_json character large object;
alter table script_definition add column if not exists published_ai_dependencies_json character large object;
alter table script_definition add column if not exists published_input_schema_json character large object;
alter table script_definition add column if not exists published_output_schema_json character large object;
alter table script_definition add column if not exists published_python_requirements character large object;
alter table script_definition add column if not exists published_script_dependencies_json character large object;
alter table script_definition add column if not exists published_source character large object;
alter table script_definition add column if not exists python_requirements character large object;
alter table script_definition add column if not exists script_dependencies_json character large object;
alter table script_definition add column if not exists source character large object;
alter table script_definition add column if not exists tags_json character large object;
alter table script_schedule add column if not exists editable boolean;
alter table script_schedule add column if not exists enabled boolean;
alter table script_schedule add column if not exists created_at timestamp(6);
alter table script_schedule add column if not exists last_triggered_at timestamp(6);
alter table script_schedule add column if not exists updated_at timestamp(6);
alter table script_schedule add column if not exists cron_expression character varying(255);
alter table script_schedule add column if not exists id character varying(255);
alter table script_schedule add column if not exists last_execution_id character varying(255);
alter table script_schedule add column if not exists name character varying(255);
alter table script_schedule add column if not exists repository_id character varying(255);
alter table script_schedule add column if not exists repository_package_id character varying(255);
alter table script_schedule add column if not exists repository_tool_id character varying(255);
alter table script_schedule add column if not exists repository_version character varying(255);
alter table script_schedule add column if not exists script_id character varying(255);
alter table script_schedule add column if not exists input_json character large object;
alter table shared_state_entry add column if not exists secret boolean;
alter table shared_state_entry add column if not exists created_at timestamp(6);
alter table shared_state_entry add column if not exists expires_at timestamp(6);
alter table shared_state_entry add column if not exists updated_at timestamp(6);
alter table shared_state_entry add column if not exists version_value bigint;
alter table shared_state_entry add column if not exists id character varying(255);
alter table shared_state_entry add column if not exists last_writer_execution_id character varying(255);
alter table shared_state_entry add column if not exists last_writer_script_id character varying(255);
alter table shared_state_entry add column if not exists state_key character varying(255);
alter table shared_state_entry add column if not exists state_namespace character varying(255);
alter table shared_state_entry add column if not exists value_json character large object;

-- Recreate secondary indexes when absent.

create index if not exists idx_config_value_repository_id on config_value(repository_id nulls first);
create index if not exists idx_event_dispatch_event_id on event_dispatch(event_id nulls first);
create index if not exists idx_event_dispatch_trigger_id on event_dispatch(trigger_id nulls first);
create index if not exists idx_event_record_source_created on event_record(source_id nulls first, created_at nulls first);
create index if not exists idx_event_record_status on event_record(status nulls first);
create index if not exists idx_event_source_enabled on event_source(enabled nulls first);
create index if not exists idx_event_trigger_source_id on event_trigger(source_id nulls first);
create index if not exists idx_event_trigger_enabled on event_trigger(enabled nulls first);
create index if not exists idx_execution_preset_script_id on execution_preset(script_id nulls first);
create index if not exists idx_script_status on script_definition(status nulls first);
create index if not exists idx_script_scope on script_definition(scope nulls first);
create index if not exists idx_script_schedule_script_id on script_schedule(script_id nulls first);
create index if not exists idx_script_schedule_enabled on script_schedule(enabled nulls first);
create index if not exists idx_shared_state_namespace on shared_state_entry(state_namespace nulls first);
create index if not exists idx_shared_state_expires_at on shared_state_entry(expires_at nulls first);
create index if not exists idx_shared_state_namespace_expires on shared_state_entry(state_namespace nulls first, expires_at nulls first);
create unique index if not exists idx_event_source_key on event_source(source_key nulls first);
create unique index if not exists idx_event_dispatch_trigger_key on event_dispatch(trigger_id nulls first, idempotency_key nulls first);
