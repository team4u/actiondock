const STORAGE_KEY = "actiondock_skill_install";

export type SkillInstallSession = {
  source: "INLINE_ARCHIVE";
  archiveName: string;
  archiveBase64: string;
};

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

function decodeBase64(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function writeSkillInstallSession(value: SkillInstallSession): void {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export async function writeInlineSkillInstallSession(archiveName: string, archive: Blob): Promise<void> {
  const buffer = await archive.arrayBuffer();
  writeSkillInstallSession({
    source: "INLINE_ARCHIVE",
    archiveName,
    archiveBase64: encodeBase64(new Uint8Array(buffer))
  });
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

export function readInlineSkillInstallArchive(session: SkillInstallSession): File | null {
  try {
    const bytes = decodeBase64(session.archiveBase64);
    const normalized = new Uint8Array(bytes.byteLength);
    normalized.set(bytes);
    return new File([normalized.buffer], session.archiveName, { type: "application/zip" });
  } catch {
    return null;
  }
}

export function clearSkillInstallSession(): void {
  window.sessionStorage.removeItem(STORAGE_KEY);
}
