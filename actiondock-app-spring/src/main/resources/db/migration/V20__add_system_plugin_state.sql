create table if not exists system_plugin_state(
    enabled boolean not null,
    updated_at timestamp(6),
    plugin_id character varying(255) not null,
    primary key(plugin_id)
);
