create table if not exists skill_installation(
    enabled boolean not null,
    installed_at timestamp(6),
    updated_at timestamp(6),
    digest character varying(255),
    display_name character varying(255),
    installation_id character varying(255) not null,
    installed_path character varying(255),
    repository_id character varying(255),
    skill_id character varying(255),
    target_id character varying(255),
    target_path character varying(255),
    version_value character varying(255),
    description character large object,
    primary key(installation_id)
);

create table if not exists skill_target(
    enabled boolean not null,
    writable boolean not null,
    created_at timestamp(6),
    updated_at timestamp(6),
    id character varying(255) not null,
    name character varying(255),
    root_path character varying(255),
    type character varying(255),
    primary key(id)
);
