const STORAGE_KEY = "actiondock_skill_install";

export type SkillInstallSession = {
  source: "REPOSITORY_REF";
  repositoryId: string;
  skillId: string;
  action?: "install" | "update";
  returnTo?: string;
};

export function writeSkillInstallSession(value: SkillInstallSession): void {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function readSkillInstallSession(): SkillInstallSession | null {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as SkillInstallSession;
  } catch {
    return null;
  }
}

export function clearSkillInstallSession(): void {
  window.sessionStorage.removeItem(STORAGE_KEY);
}
