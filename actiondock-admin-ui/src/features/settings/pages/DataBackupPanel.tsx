import { useState, useRef, useCallback, useEffect } from "react";
import {
  Button,
  Card,
  Space,
  Checkbox,
  Modal,
  Typography,
  Descriptions,
  Alert,
  message
} from "antd";
import {
  DownloadOutlined,
  UploadOutlined,
  CloudDownloadOutlined,
  CheckCircleOutlined,
  WarningOutlined
} from "@ant-design/icons";
import JSZip from "jszip";
import {
  listAiAgents,
  listAiModels,
  listAiToolsets,
  saveAiAgent,
  saveAiModel,
  createAiToolset,
  updateAiToolset
} from "../../ai/api";
import {
  downloadPluginJar,
  getPlugin,
  getPluginConfig,
  installPlugin,
  listPluginConfigs,
  listPlugins,
  uninstallPlugin,
  updatePluginConfig
} from "../../plugins/api";
import {
  createRepository,
  listRepositories,
  updateRepository
} from "../../resources/api";
import {
  createPreset,
  createScript,
  listPresets,
  listScripts,
  updatePreset,
  updateScript
} from "../../scripts/api";
import {
  createPlaybook,
  listPlaybooks,
  updatePlaybook
} from "../../playbooks/api";
import {
  createConfigValue,
  createSharedState,
  getSharedState,
  listConfigValues,
  listSharedState,
  listSharedStateNamespaces,
  updateConfigValue,
  updateSharedState
} from "../../settings/api";
import {
  createSkillTarget,
  deleteSkill,
  disableSkill,
  downloadInstalledSkillArchive,
  installSkillArchive,
  listSkills,
  listSkillTargets,
  restoreSkill,
  updateSkillTarget
} from "../../skills/api";
import {
  createWebhook,
  listSchedules,
  listWebhooks,
  createSchedule,
  updateSchedule,
  updateWebhook
} from "../../triggers/api";
import type {
  ScriptDefinition,
  ScriptSchedule,
  WebhookDefinition,
  ConfigValue,
  ExecutionPreset,
  RepositoryDefinition,
  Playbook,
  PluginView,
  SharedStateSummary,
  AiModelProfile,
  AiAgentProfile,
  AiToolset,
  Skill,
  SkillTarget
} from "../../../shared/types";
import {
  buildSharedStateBackupEntry,
  buildSharedStateBackupKey,
  buildBackupJson,
  buildSkillBackupEntry,
  parseBackupJson,
  analyzeBackupBundle,
  formatBackupFileName,
  shouldIncludeSharedStateValue,
  toSharedStateRestorePayload,
  type SystemBackupBundleV1,
  type BackupAnalysis,
  type SharedStateBackupEntry,
  type SkillBackupEntry
} from "../../../services/systemBackup";

const { Text } = Typography;

interface RestoreResult {
  type: string;
  succeeded: number;
  failed: number;
  skipped?: number;
  errors: string[];
}

async function listAllSharedStateSummaries(): Promise<SharedStateSummary[]> {
  const namespaces = await listSharedStateNamespaces();
  const grouped = await Promise.all(namespaces.map(async namespace => listSharedState(namespace)));
  return grouped
    .flat()
    .sort((left, right) => left.namespace.localeCompare(right.namespace) || left.key.localeCompare(right.key));
}

async function buildSharedStateBackupEntries(includeSecretValues: boolean): Promise<SharedStateBackupEntry[]> {
  const summaries = await listAllSharedStateSummaries();
  const entries = await Promise.all(
    summaries.map(async item => {
      if (!shouldIncludeSharedStateValue(item.secret, includeSecretValues)) {
        return buildSharedStateBackupEntry(item);
      }
      const detail = await getSharedState(item.namespace, item.key);
      return buildSharedStateBackupEntry(detail, { includeValue: true });
    })
  );
  return entries.sort((left, right) => left.namespace.localeCompare(right.namespace) || left.key.localeCompare(right.key));
}

export function DataBackupPanel() {
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [dataCounts, setDataCounts] = useState<{
    scripts: number;
    schedules: number;
    webhooks: number;
    configValues: number;
    presets: number;
    repositories: number;
    playbooks: number;
    plugins: number;
    sharedStates: number;
    aiModels: number;
    aiAgents: number;
    aiToolsets: number;
    skillTargets: number;
    skills: number;
  } | null>(null);
  const [analysis, setAnalysis] = useState<BackupAnalysis | null>(null);
  const [pendingBundle, setPendingBundle] = useState<SystemBackupBundleV1 | null>(null);
  const [pendingPluginFiles, setPendingPluginFiles] = useState<Map<string, Blob> | null>(null);
  const [pendingSkillFiles, setPendingSkillFiles] = useState<Map<string, Blob> | null>(null);
  const [restoreResults, setRestoreResults] = useState<RestoreResult[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const loadDataCounts = useCallback(async () => {
    const [scripts, schedules, webhooks, configValues, repositories, playbooks, plugins, sharedStates, aiModels, aiAgents, aiToolsets, skillTargets, skills] = await Promise.all([
      listScripts(),
      listSchedules(),
      listWebhooks(),
      listConfigValues(),
      listRepositories(),
      listPlaybooks(),
      listPlugins(),
      listAllSharedStateSummaries(),
      listAiModels(),
      listAiAgents(),
      listAiToolsets(),
      listSkillTargets(),
      listSkills()
    ]);
    let presetCount = 0;
    for (const script of scripts) {
      try {
        const presets = await listPresets(script.id);
        presetCount += presets.length;
      } catch {
        // skip
      }
    }
    setDataCounts({
      scripts: scripts.length,
      schedules: schedules.length,
      webhooks: webhooks.length,
      configValues: configValues.length,
      presets: presetCount,
      repositories: repositories.length,
      playbooks: playbooks.filter((item) => !item.managed).length,
      plugins: plugins.length,
      sharedStates: sharedStates.length,
      aiModels: aiModels.length,
      aiAgents: aiAgents.length,
      aiToolsets: aiToolsets.length,
      skillTargets: skillTargets.length,
      skills: skills.length
    });
  }, []);

  useEffect(() => {
    loadDataCounts().catch(() => {
      // ignore initial overview errors
    });
  }, [loadDataCounts]);

  const handleBackup = useCallback(async () => {
    setBackupLoading(true);
    try {
      const [scripts, schedules, webhooks, configValues, repositories, playbooks, plugins, sharedStates, aiModels, aiAgents, aiToolsets, skillTargets, skills] = await Promise.all([
        listScripts(),
        listSchedules(),
        listWebhooks(),
        listConfigValues(),
        listRepositories(),
        listPlaybooks(),
        listPlugins(),
        buildSharedStateBackupEntries(includeSecrets),
        listAiModels(),
        listAiAgents(),
        listAiToolsets(),
        listSkillTargets(),
        listSkills()
      ]);

      const allPresets: ExecutionPreset[] = [];
      await Promise.all(
        scripts.map(async script => {
          try {
            const presets = await listPresets(script.id);
            allPresets.push(...presets);
          } catch {
            // skip
          }
        })
      );

      const fullPlugins = await Promise.all(
        plugins
          .filter(plugin => plugin.sourceType !== "SYSTEM")
          .map(async plugin => {
            try {
              return await getPlugin(plugin.pluginId);
            } catch {
              return null;
            }
          })
      ).then(items => items.filter((plugin): plugin is PluginView => plugin !== null));

      const pluginConfigs = new Map<string, Record<string, unknown>>();
      const pluginNamedConfigs = new Map<string, Record<string, Record<string, unknown>>>();
      await Promise.all(
        plugins
          .filter(p => p.configurable)
          .map(async p => {
            try {
              const configViews = await listPluginConfigs(p.pluginId);
              const configs: Record<string, Record<string, unknown>> = {};
              for (const configView of configViews) {
                configs[configView.configName] = configView.config;
                if (configView.configName === "default") {
                  pluginConfigs.set(p.pluginId, configView.config);
                }
              }
              pluginNamedConfigs.set(p.pluginId, configs);
            } catch {
              try {
                const configView = await getPluginConfig(p.pluginId);
                pluginConfigs.set(p.pluginId, configView.config);
              } catch {
                // skip
              }
            }
          })
      );

      const skillArchives = new Map<string, { blob: Blob; fileName: string }>();
      const skillEntries: SkillBackupEntry[] = [];
      await Promise.all(
        skills.map(async skill => {
          try {
            const blob = await downloadInstalledSkillArchive(skill.skillId);
            const fileName = `${skill.skillId}.zip`;
            skillArchives.set(skill.skillId, { blob, fileName });
            skillEntries.push(buildSkillBackupEntry(skill, fileName));
          } catch {
            // skip skills whose archives can't be downloaded
          }
        })
      );

      const backupJson = buildBackupJson(
        {
          scripts,
          schedules,
          webhooks,
          configValues,
          executionPresets: allPresets,
          repositories,
          playbooks: playbooks.filter((item) => !item.managed),
          plugins: fullPlugins,
          pluginConfigs,
          pluginNamedConfigs,
          sharedStates,
          aiModels,
          aiAgents,
          aiToolsets,
          skillTargets,
          skills: skillEntries
        },
        { includeSecretValues: includeSecrets }
      );

      const pluginJars = new Map<string, { blob: Blob; fileName: string }>();
      await Promise.all(
        plugins.filter((plugin) => plugin.sourceType !== "SYSTEM").map(async p => {
          try {
            const blob = await downloadPluginJar(p.pluginId);
            const fileName = p.fileName ?? `${p.pluginId}.jar`;
            pluginJars.set(p.pluginId, { blob, fileName });
          } catch {
            // skip
          }
        })
      );

      const zip = new JSZip();
      zip.file("backup.json", JSON.stringify(backupJson, null, 2));
      const pluginsFolder = zip.folder("plugins");
      for (const [_, jar] of pluginJars) {
        pluginsFolder!.file(jar.fileName, jar.blob);
      }
      const skillsFolder = zip.folder("skills");
      for (const [_, archive] of skillArchives) {
        skillsFolder!.file(archive.fileName, archive.blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = formatBackupFileName();
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      messageApi.success("备份已创建并下载");
      loadDataCounts();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "备份创建失败");
    } finally {
      setBackupLoading(false);
    }
  }, [includeSecrets, messageApi, loadDataCounts]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    try {
      setRestoreLoading(true);
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      const backupFile = zip.file("backup.json");
      if (!backupFile) {
        messageApi.error("ZIP 包中未找到 backup.json");
        setRestoreLoading(false);
        return;
      }

      const backupText = await backupFile.async("string");
      const bundle = parseBackupJson(backupText);

      const pluginFiles = new Map<string, Blob>();
      const pluginEntries = Object.entries(zip.files).filter(
        ([path]) => path.startsWith("plugins/") && !zip.files[path].dir
      );
      for (const [path, entry] of pluginEntries) {
        const blob = await entry.async("blob");
        pluginFiles.set(path, blob);
      }

      const skillFiles = new Map<string, Blob>();
      const skillZipEntries = Object.entries(zip.files).filter(
        ([path]) => path.startsWith("skills/") && !zip.files[path].dir
      );
      for (const [path, entry] of skillZipEntries) {
        const blob = await entry.async("blob");
        skillFiles.set(path, blob);
      }
      setPendingSkillFiles(skillFiles);

      const [scripts, schedules, webhooks, configValues, repositories, playbooks, plugins, sharedStates, aiModels, aiAgents, aiToolsets, skillTargets, skills] = await Promise.all([
        listScripts(),
        listSchedules(),
        listWebhooks(),
        listConfigValues(),
        listRepositories(),
        listPlaybooks(),
        listPlugins(),
        listAllSharedStateSummaries(),
        listAiModels(),
        listAiAgents(),
        listAiToolsets(),
        listSkillTargets(),
        listSkills()
      ]);

      const allPresets: ExecutionPreset[] = [];
      await Promise.all(
        scripts.map(async s => {
          try {
            const presets = await listPresets(s.id);
            allPresets.push(...presets);
          } catch {
            // skip
          }
        })
      );

      const analysisResult = analyzeBackupBundle(bundle, {
        scripts,
        schedules,
        webhooks,
        configValues,
        executionPresets: allPresets,
        repositories,
        playbooks,
        plugins,
        sharedStates,
        aiModels,
        aiAgents,
        aiToolsets,
        skillTargets,
        skills
      });

      setPendingBundle(bundle);
      setPendingPluginFiles(pluginFiles);
      setAnalysis(analysisResult);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "备份文件解析失败");
    } finally {
      setRestoreLoading(false);
    }
  }, [messageApi]);

  const executeRestore = useCallback(async () => {
    if (!pendingBundle || !analysis) return;

    setRestoreLoading(true);
    setAnalysis(null);

    const results: RestoreResult[] = [];
    const bundle = pendingBundle;
    const pluginFiles = pendingPluginFiles ?? new Map<string, Blob>();
    const skillFiles = pendingSkillFiles ?? new Map<string, Blob>();

    try {
      const [currentScripts, currentSchedules, currentWebhooks, currentConfigValues, currentRepositories, currentPlaybooks, currentPlugins, currentSharedStates, currentAiModels, currentAiAgents, currentAiToolsets, currentSkillTargets, currentSkills] = await Promise.all([
        listScripts(),
        listSchedules(),
        listWebhooks(),
        listConfigValues(),
        listRepositories(),
        listPlaybooks(),
        listPlugins(),
        listAllSharedStateSummaries(),
        listAiModels(),
        listAiAgents(),
        listAiToolsets(),
        listSkillTargets(),
        listSkills()
      ]);

      const currentScriptIds = new Set(currentScripts.map(s => s.id));
      const currentScheduleIds = new Set(currentSchedules.map(s => s.id));
      const currentWebhookIds = new Set(currentWebhooks.map(s => s.id));
      const currentConfigKeys = new Set(currentConfigValues.map(c => c.key));
      const currentRepoIds = new Set(currentRepositories.map(r => r.id));
      const currentPlaybookById = new Map(currentPlaybooks.map((item) => [item.id, item]));
      const currentPluginIds = new Set(currentPlugins.map(p => p.pluginId));
      const currentSharedStateKeys = new Set(currentSharedStates.map(item => buildSharedStateBackupKey(item)));
      const currentSkillTargetIds = new Set(currentSkillTargets.map(t => t.id));
      const currentSkillIds = new Set(currentSkills.map(s => s.skillId));

      const currentPresets: ExecutionPreset[] = [];
      await Promise.all(
        currentScripts.map(async s => {
          try {
            const presets = await listPresets(s.id);
            currentPresets.push(...presets);
          } catch {
            // skip
          }
        })
      );
      const currentPresetIds = new Set(currentPresets.map(p => p.id));

      const currentAiModelIds = new Set(currentAiModels.map(m => m.id));
      const currentAiAgentIds = new Set(currentAiAgents.map(a => a.id));
      const currentAiToolsetIds = new Set(currentAiToolsets.map(t => t.id));

      // 1. Config Values
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const item of bundle.data.configValues) {
          try {
            const payload = {
              key: item.key,
              value: item.value ?? "",
              description: item.description,
              secret: item.secret ?? false
            };
            if (currentConfigKeys.has(item.key)) {
              await updateConfigValue(item.key, payload);
            } else {
              await createConfigValue(payload);
            }
            succeeded++;
          } catch (e) {
            errors.push(`${item.key}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "配置值", succeeded, failed: errors.length, errors });
      }

      // 2. Shared States
      {
        let succeeded = 0;
        let skipped = 0;
        const errors: string[] = [];
        for (const item of bundle.data.sharedStates) {
          const payload = toSharedStateRestorePayload(item);
          if (!payload) {
            skipped++;
            continue;
          }
          try {
            if (currentSharedStateKeys.has(buildSharedStateBackupKey(item))) {
              await updateSharedState(payload);
            } else {
              await createSharedState(payload);
            }
            succeeded++;
          } catch (e) {
            errors.push(`${item.namespace}/${item.key}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "共享状态", succeeded, failed: errors.length, skipped, errors });
      }

      // 3. Repositories
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const repo of bundle.data.repositories) {
          try {
            if (currentRepoIds.has(repo.id)) {
              await updateRepository(repo.id, repo);
            } else {
              await createRepository(repo);
            }
            succeeded++;
          } catch (e) {
            errors.push(`${repo.name}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "仓库", succeeded, failed: errors.length, errors });
      }

      // 4. Scripts
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const script of bundle.data.scripts) {
          try {
            if (currentScriptIds.has(script.id)) {
              await updateScript(script.id, script);
            } else {
              await createScript(script);
            }
            succeeded++;
          } catch (e) {
            errors.push(`${script.name}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "脚本", succeeded, failed: errors.length, errors });
      }

      // 5. Playbooks
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const playbook of bundle.data.playbooks) {
          try {
            const current = currentPlaybookById.get(playbook.id);
            if (current?.managed) {
              errors.push(`${playbook.name}: 已存在同 ID 仓库托管任务手册，已跳过`);
              continue;
            }
            const payload: Playbook = { ...playbook, managed: false };
            if (current) {
              await updatePlaybook(playbook.id, payload);
            } else {
              await createPlaybook(payload);
            }
            succeeded++;
          } catch (e) {
            errors.push(`${playbook.name}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "任务手册", succeeded, failed: errors.length, errors });
      }

      // 6. Execution Presets
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const preset of bundle.data.executionPresets) {
          try {
            const payload = { name: preset.name, input: preset.input };
            if (currentPresetIds.has(preset.id)) {
              await updatePreset(preset.scriptId, preset.id, payload);
            } else {
              await createPreset(preset.scriptId, payload);
            }
            succeeded++;
          } catch (e) {
            errors.push(`${preset.name}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "执行预设", succeeded, failed: errors.length, errors });
      }

      // 7. Schedules
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const schedule of bundle.data.schedules) {
          try {
            const payload = {
              scriptId: schedule.scriptId,
              name: schedule.name,
              cronExpression: schedule.cronExpression,
              input: schedule.input,
              enabled: schedule.enabled
            };
            if (currentScheduleIds.has(schedule.id)) {
              await updateSchedule(schedule.id, payload);
            } else {
              await createSchedule(payload);
            }
            succeeded++;
          } catch (e) {
            errors.push(`${schedule.name}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "定时任务", succeeded, failed: errors.length, errors });
      }

      // 8. Event Sources
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const item of bundle.data.webhooks) {
          try {
            if (currentWebhookIds.has(item.id)) {
              await updateWebhook(item.id, item);
            } else {
              await createWebhook(item);
            }
            succeeded++;
          } catch (e) {
            errors.push(`${item.name}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "Webhook", succeeded, failed: errors.length, errors });
      }

      // 9. Plugins (uninstall then install)
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const plugin of bundle.data.plugins) {
          try {
            const jarEntry = Array.from(pluginFiles.entries()).find(([path]) => {
              const fileName = path.replace("plugins/", "");
              return fileName === plugin.fileName || fileName === `${plugin.pluginId}.jar`;
            });

            if (!jarEntry) {
              errors.push(`${plugin.name}: ZIP 中未找到插件文件`);
              continue;
            }

            const jarBlob = jarEntry[1];

            if (currentPluginIds.has(plugin.pluginId)) {
              await uninstallPlugin(plugin.pluginId, true);
            }

            const jarFile = new File([jarBlob], plugin.fileName, { type: "application/java-archive" });
            await installPlugin(jarFile);

            if (plugin.configurable && plugin.config) {
              try {
                await updatePluginConfig(plugin.pluginId, plugin.config);
              } catch {
                // config restore is non-fatal
              }
            }
            if (plugin.configurable && plugin.configs) {
              for (const [configName, config] of Object.entries(plugin.configs)) {
                try {
                  await updatePluginConfig(plugin.pluginId, config, configName === "default" ? undefined : configName);
                } catch {
                  // config restore is non-fatal
                }
              }
            }
            succeeded++;
          } catch (e) {
            errors.push(`${plugin.name}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "插件", succeeded, failed: errors.length, errors });
      }

      // 10. AI Models
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const model of bundle.data.aiModels) {
          try {
            const { createdAt, updatedAt, ...payload } = model;
            await saveAiModel({ ...payload, id: currentAiModelIds.has(model.id) ? model.id : "" });
            succeeded++;
          } catch (e) {
            errors.push(`${model.name}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "AI 模型", succeeded, failed: errors.length, errors });
      }

      // 11. AI Agents
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const agent of bundle.data.aiAgents) {
          try {
            const { createdAt, updatedAt, ...payload } = agent;
            await saveAiAgent({ ...payload, id: currentAiAgentIds.has(agent.id) ? agent.id : "" });
            succeeded++;
          } catch (e) {
            errors.push(`${agent.name}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "AI Agent", succeeded, failed: errors.length, errors });
      }

      // 12. AI Toolsets
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const toolset of bundle.data.aiToolsets) {
          try {
            const { createdAt, updatedAt, ...payload } = toolset;
            if (currentAiToolsetIds.has(toolset.id)) {
              await updateAiToolset(toolset.id, payload);
            } else {
              await createAiToolset(payload);
            }
            succeeded++;
          } catch (e) {
            errors.push(`${toolset.name}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "AI 工具集", succeeded, failed: errors.length, errors });
      }

      // 13. Skill Targets
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const target of bundle.data.skillTargets) {
          try {
            const payload: SkillTarget = {
              id: target.id,
              name: target.name,
              type: target.type,
              rootPath: target.rootPath,
              enabled: target.enabled,
              writable: target.writable
            };
            if (currentSkillTargetIds.has(target.id)) {
              await updateSkillTarget(target.id, payload);
            } else {
              await createSkillTarget(payload);
            }
            succeeded++;
          } catch (e) {
            errors.push(`${target.name}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "Skill 目标", succeeded, failed: errors.length, errors });
      }

      // 14. Skills
      {
        let succeeded = 0;
        const errors: string[] = [];
        for (const skill of bundle.data.skills) {
          try {
            const archiveEntry = Array.from(skillFiles.entries()).find(([path]) => {
              const fileName = path.replace("skills/", "");
              return fileName === skill.fileName || fileName === `${skill.skillId}.zip`;
            });

            if (!archiveEntry) {
              errors.push(`${skill.displayName ?? skill.skillId}: ZIP 中未找到技能文件`);
              continue;
            }

            if (currentSkillIds.has(skill.skillId)) {
              await deleteSkill(skill.skillId);
            }

            const archiveBlob = archiveEntry[1];
            const archiveFile = new File([archiveBlob], skill.fileName, { type: "application/zip" });
            await installSkillArchive({
              targetIds: skill.targetIds,
              repositoryId: skill.repositoryId,
              archive: archiveFile
            });

            if (skill.disabledTargetIds.length > 0 && skill.disabledTargetIds.length === skill.targetIds.length) {
              try {
                await disableSkill(skill.skillId);
              } catch {
                // disable is non-fatal
              }
            }

            succeeded++;
          } catch (e) {
            errors.push(`${skill.displayName ?? skill.skillId}: ${e instanceof Error ? e.message : "未知错误"}`);
          }
        }
        results.push({ type: "Skill", succeeded, failed: errors.length, errors });
      }

      setPendingBundle(null);
      setPendingPluginFiles(null);
      setPendingSkillFiles(null);
      setRestoreResults(results);
      await loadDataCounts();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setRestoreLoading(false);
    }
  }, [pendingBundle, pendingPluginFiles, pendingSkillFiles, analysis, loadDataCounts, messageApi]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}

      <Card
        title={<Space><CloudDownloadOutlined /> 创建备份</Space>}
        size="small"
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {dataCounts && (
            <Descriptions size="small" column={3} bordered>
              <Descriptions.Item label="脚本">{dataCounts.scripts}</Descriptions.Item>
              <Descriptions.Item label="定时任务">{dataCounts.schedules}</Descriptions.Item>
              <Descriptions.Item label="Webhook">{dataCounts.webhooks}</Descriptions.Item>
              <Descriptions.Item label="配置值">{dataCounts.configValues}</Descriptions.Item>
              <Descriptions.Item label="执行预设">{dataCounts.presets}</Descriptions.Item>
              <Descriptions.Item label="仓库">{dataCounts.repositories}</Descriptions.Item>
              <Descriptions.Item label="任务手册">{dataCounts.playbooks}</Descriptions.Item>
              <Descriptions.Item label="插件">{dataCounts.plugins}</Descriptions.Item>
              <Descriptions.Item label="共享状态">{dataCounts.sharedStates}</Descriptions.Item>
              <Descriptions.Item label="AI 模型">{dataCounts.aiModels}</Descriptions.Item>
              <Descriptions.Item label="AI Agent">{dataCounts.aiAgents}</Descriptions.Item>
              <Descriptions.Item label="AI 工具集">{dataCounts.aiToolsets}</Descriptions.Item>
              <Descriptions.Item label="Skill 目标">{dataCounts.skillTargets}</Descriptions.Item>
              <Descriptions.Item label="Skill">{dataCounts.skills}</Descriptions.Item>
            </Descriptions>
          )}

          <Checkbox
            checked={includeSecrets}
            onChange={e => setIncludeSecrets(e.target.checked)}
          >
            包含 Secret 配置值和共享状态的明文值
          </Checkbox>

          <Space>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={backupLoading}
              onClick={handleBackup}
            >
              创建备份
            </Button>
            <Button onClick={loadDataCounts} disabled={backupLoading}>
              刷新数据概览
            </Button>
          </Space>
        </Space>
      </Card>

      <Card
        title={<Space><UploadOutlined /> 从备份恢复</Space>}
        size="small"
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="warning"
            message="恢复操作将覆盖现有数据，请谨慎操作。建议在恢复前先创建备份。"
            showIcon
          />

          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
          <Button
            icon={<UploadOutlined />}
            loading={restoreLoading}
            onClick={() => fileInputRef.current?.click()}
          >
            选择备份文件
          </Button>
        </Space>
      </Card>

      {restoreResults && (
        <Card title="恢复结果" size="small">
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {restoreResults.map(r => (
              <div key={r.type}>
                <Space>
                  {r.failed === 0 ? (
                    <CheckCircleOutlined style={{ color: "#52c41a" }} />
                  ) : (
                    <WarningOutlined style={{ color: "#faad14" }} />
                  )}
                  <Text strong>{r.type}</Text>
                  <Text type="success">成功 {r.succeeded}</Text>
                  {r.skipped ? <Text type="secondary">跳过 {r.skipped}</Text> : null}
                  {r.failed > 0 && <Text type="danger">失败 {r.failed}</Text>}
                </Space>
                {r.errors.length > 0 && (
                  <div style={{ marginLeft: 24, marginTop: 4 }}>
                    {r.errors.map((err, i) => (
                      <div key={i}><Text type="danger" style={{ fontSize: 12 }}>{err}</Text></div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <Button onClick={() => setRestoreResults(null)} style={{ marginTop: 8 }}>
              关闭
            </Button>
          </Space>
        </Card>
      )}

      <Modal
        title="恢复预览"
        open={analysis !== null}
        okText="确认恢复"
        cancelText="取消"
        onOk={executeRestore}
        onCancel={() => {
          setAnalysis(null);
          setPendingBundle(null);
          setPendingPluginFiles(null);
          setPendingSkillFiles(null);
        }}
        confirmLoading={restoreLoading}
        width={600}
      >
        {analysis && (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Alert
              type="warning"
              message="此操作将覆盖现有数据，请确认以下变更。"
              showIcon
            />
            <Descriptions size="small" column={3} bordered>
              <Descriptions.Item label="脚本">
                <Text>共 {analysis.scripts.total} 条</Text>
                <br />
                <Text type="success">新建 {analysis.scripts.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.scripts.overwrite}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="定时任务">
                <Text>共 {analysis.schedules.total} 条</Text>
                <br />
                <Text type="success">新建 {analysis.schedules.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.schedules.overwrite}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Webhook">
                <Text>共 {analysis.webhooks.total} 条</Text>
                <br />
                <Text type="success">新建 {analysis.webhooks.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.webhooks.overwrite}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="配置值">
                <Text>共 {analysis.configValues.total} 条</Text>
                <br />
                <Text type="success">新建 {analysis.configValues.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.configValues.overwrite}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="执行预设">
                <Text>共 {analysis.executionPresets.total} 条</Text>
                <br />
                <Text type="success">新建 {analysis.executionPresets.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.executionPresets.overwrite}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="仓库">
                <Text>共 {analysis.repositories.total} 条</Text>
                <br />
                <Text type="success">新建 {analysis.repositories.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.repositories.overwrite}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="任务手册">
                <Text>共 {analysis.playbooks.total} 条</Text>
                <br />
                <Text type="success">新建 {analysis.playbooks.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.playbooks.overwrite}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="插件">
                <Text>共 {analysis.plugins.total} 个</Text>
                <br />
                <Text type="success">新建 {analysis.plugins.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.plugins.overwrite}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="共享状态">
                <Text>共 {analysis.sharedStates.total} 条</Text>
                <br />
                <Text type="success">新建 {analysis.sharedStates.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.sharedStates.overwrite}</Text>
                {analysis.sharedStates.skipped > 0 ? (
                  <>
                    {" / "}
                    <Text type="secondary">跳过 {analysis.sharedStates.skipped}</Text>
                  </>
                ) : null}
              </Descriptions.Item>
              <Descriptions.Item label="AI 模型">
                <Text>共 {analysis.aiModels.total} 条</Text>
                <br />
                <Text type="success">新建 {analysis.aiModels.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.aiModels.overwrite}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="AI Agent">
                <Text>共 {analysis.aiAgents.total} 条</Text>
                <br />
                <Text type="success">新建 {analysis.aiAgents.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.aiAgents.overwrite}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="AI 工具集">
                <Text>共 {analysis.aiToolsets.total} 条</Text>
                <br />
                <Text type="success">新建 {analysis.aiToolsets.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.aiToolsets.overwrite}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Skill 目标">
                <Text>共 {analysis.skillTargets.total} 条</Text>
                <br />
                <Text type="success">新建 {analysis.skillTargets.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.skillTargets.overwrite}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Skill">
                <Text>共 {analysis.skills.total} 个</Text>
                <br />
                <Text type="success">新建 {analysis.skills.create}</Text>
                {" / "}
                <Text type="warning">覆盖 {analysis.skills.overwrite}</Text>
              </Descriptions.Item>
            </Descriptions>
          </Space>
        )}
      </Modal>
    </Space>
  );
}
