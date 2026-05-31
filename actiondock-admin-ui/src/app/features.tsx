import type { AppFeatureDefinition } from "./featureRegistry";
import { capabilitiesFeature } from "../features/capabilities/routes";
import { resourcesFeature } from "../features/resources/routes";
import { executionsFeature } from "../features/executions/routes";
import { settingsFeature } from "../features/settings/routes";

export { type AppFeatureDefinition, type AppFeatureRoute, type AppSectionKey } from "./featureRegistry";

export const appFeatures: AppFeatureDefinition[] = [
  capabilitiesFeature,
  resourcesFeature,
  executionsFeature,
  settingsFeature
];
