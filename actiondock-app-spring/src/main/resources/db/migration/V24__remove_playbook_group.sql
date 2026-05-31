-- 1. Drop foreign key constraint on playbook table
ALTER TABLE playbook DROP CONSTRAINT fk_playbook_group;

-- 2. Drop index on playbook group_id
DROP INDEX idx_playbook_group_id;

-- 3. Drop column group_id from playbook table
ALTER TABLE playbook DROP COLUMN group_id;

-- 4. Drop playbook_group table
DROP TABLE playbook_group;

-- 5. Drop playbook_group_ids_json from repository_ai_package_installation table
ALTER TABLE repository_ai_package_installation DROP COLUMN playbook_group_ids_json;
