import { JSON_HEADERS, request, requestBlob } from "../../shared/api/httpClient";
import type {
  GithubSkillInstallResponse,
  GithubSkillScanResponse,
  Skill,
  SkillDetail,
  SkillFilePreview,
  SkillPackageResult,
  SkillScanDetail,
  SkillScanItem,
  SkillSyncResponse,
  SkillTarget,
  SkillValidationResult
} from "../../shared/types";

export function listSkills(): Promise<Skill[]> {
  return request<Skill[]>("/api/skills");
}

export function getSkill(skillId: string): Promise<Skill> {
  return request<Skill>(`/api/skills/${encodeURIComponent(skillId)}`);
}

export function getSkillDetail(skillId: string): Promise<SkillDetail> {
  return request<SkillDetail>(`/api/skills/${encodeURIComponent(skillId)}/detail`);
}

export function downloadInstalledSkillArchive(skillId: string): Promise<Blob> {
  return requestBlob(`/api/skills/${encodeURIComponent(skillId)}/archive`);
}

export function previewSkillFile(skillId: string, path: string): Promise<SkillFilePreview> {
  const params = new URLSearchParams({ path });
  return request<SkillFilePreview>(`/api/skills/${encodeURIComponent(skillId)}/preview?${params.toString()}`);
}

export async function validateSkillArchive(file: File): Promise<SkillValidationResult> {
  const formData = new FormData();
  formData.append("file", file);
  return request<SkillValidationResult>("/api/skills/validate", {
    method: "POST",
    body: formData
  });
}

export async function importSkill(targetIds: string[], file: File): Promise<Skill> {
  const formData = new FormData();
  targetIds.forEach((targetId) => formData.append("targetIds", targetId));
  formData.append("file", file);
  return request<Skill>("/api/skills/import", {
    method: "POST",
    body: formData
  });
}

export function installSkillDirectory(targetIds: string[], directory: string): Promise<Skill> {
  return request<Skill>("/api/skills/install-directory", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ targetIds, directory })
  });
}

export function scanGithubSkillCollection(url: string): Promise<GithubSkillScanResponse> {
  return request<GithubSkillScanResponse>("/api/skills/github/scan", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ url })
  });
}

export function installGithubSkillCollection(payload: {
  url: string;
  targetIds: string[];
  skillPaths: string[];
}): Promise<GithubSkillInstallResponse> {
  return request<GithubSkillInstallResponse>("/api/skills/github/install", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function installSkillArchive(payload: {
  targetIds: string[];
  repositoryId?: string;
  archive: File | Blob;
}): Promise<Skill> {
  const formData = new FormData();
  payload.targetIds.forEach((targetId) => formData.append("targetIds", targetId));
  if (payload.repositoryId?.trim()) {
    formData.append("repositoryId", payload.repositoryId.trim());
  }
  formData.append("archive", payload.archive);
  return request<Skill>("/api/skills/install-archive", {
    method: "POST",
    body: formData
  });
}

export function updateSkill(skillId: string, directory: string): Promise<Skill> {
  return request<Skill>(`/api/skills/${encodeURIComponent(skillId)}/update`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ directory })
  });
}

export function updateSkillVersion(skillId: string, version: string): Promise<Skill> {
  return request<Skill>(`/api/skills/${encodeURIComponent(skillId)}/version`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ version })
  });
}

export function disableSkill(skillId: string): Promise<Skill> {
  return request<Skill>(`/api/skills/${encodeURIComponent(skillId)}/disable`, {
    method: "POST"
  });
}

export function restoreSkill(skillId: string): Promise<Skill> {
  return request<Skill>(`/api/skills/${encodeURIComponent(skillId)}/restore`, {
    method: "POST"
  });
}

export function deleteSkill(skillId: string): Promise<void> {
  return request<void>(`/api/skills/${encodeURIComponent(skillId)}`, {
    method: "DELETE"
  });
}

export function removeSkillFromTarget(skillId: string, targetId: string): Promise<void> {
  return request<void>(`/api/skills/${encodeURIComponent(skillId)}/targets/${encodeURIComponent(targetId)}`, {
    method: "DELETE"
  });
}

export function packageSkillDirectory(directory: string): Promise<SkillPackageResult> {
  return request<SkillPackageResult>("/api/skills/package", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ directory })
  });
}

export function listSkillTargets(): Promise<SkillTarget[]> {
  return request<SkillTarget[]>("/api/skill-targets");
}

export function createSkillTarget(payload: SkillTarget): Promise<SkillTarget> {
  return request<SkillTarget>("/api/skill-targets", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateSkillTarget(id: string, payload: SkillTarget): Promise<SkillTarget> {
  return request<SkillTarget>(`/api/skill-targets/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteSkillTarget(id: string): Promise<void> {
  return request<void>(`/api/skill-targets/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function scanSkillTarget(id: string): Promise<SkillScanItem[]> {
  return request<SkillScanItem[]>(`/api/skill-targets/${encodeURIComponent(id)}/scan`, {
    method: "POST"
  });
}

export function getScanItemDetail(targetId: string, directoryId: string): Promise<SkillScanDetail> {
  return request<SkillScanDetail>(`/api/skill-targets/${encodeURIComponent(targetId)}/scan/${encodeURIComponent(directoryId)}`);
}

export function previewScanItemFile(targetId: string, directoryId: string, path: string): Promise<SkillFilePreview> {
  return request<SkillFilePreview>(`/api/skill-targets/${encodeURIComponent(targetId)}/scan/${encodeURIComponent(directoryId)}/preview?path=${encodeURIComponent(path)}`);
}

export function deleteScanDirectory(targetId: string, directoryId: string): Promise<void> {
  return request<void>(`/api/skill-targets/${encodeURIComponent(targetId)}/scan/${encodeURIComponent(directoryId)}`, {
    method: "DELETE"
  });
}

export function syncSkillInstallationsToTarget(targetId: string, skillIds: string[]): Promise<SkillSyncResponse> {
  return request<SkillSyncResponse>(`/api/skill-targets/${encodeURIComponent(targetId)}/sync-installations`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ skillIds })
  });
}
