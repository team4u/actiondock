create table if not exists managed_skill(
    skill_id character varying(255) not null,
    repository_id character varying(255),
    version_value character varying(255),
    digest character varying(255),
    display_name character varying(255),
    description character large object,
    installed_at timestamp(6),
    updated_at timestamp(6),
    primary key(skill_id)
);

merge into managed_skill(skill_id, repository_id, version_value, digest, display_name, description, installed_at, updated_at)
key(skill_id)
select skill_id,
       repository_id,
       version_value,
       digest,
       display_name,
       description,
       installed_at,
       updated_at
from skill_installation
where skill_id is not null;

alter table skill_installation drop primary key;
alter table skill_installation add constraint pk_skill_installation primary key (installation_id);
alter table skill_installation add constraint uk_skill_installation_skill_target unique (skill_id, target_id);
