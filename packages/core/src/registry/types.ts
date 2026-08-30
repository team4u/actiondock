export interface LinkedPackageEntry {
  id: string;
  name: string;
  version: string;
  path: string;
  linkedAt: string;
}

export interface GlobalRegistryData {
  version: "2.0.0";
  packages: Record<string, LinkedPackageEntry>;
}

export interface ResolvedActionProject {
  projectRoot: string;
  packageId: string;
  actionId: string;
}
