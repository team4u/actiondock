# actiondock-admin-ui

React + Vite 管理台模块，承载脚本平台和 AI 工作台的可视化操作界面。

## 技术栈

- React 18
- Ant Design 5
- Vite
- TypeScript
- Monaco Editor

## 主要页面

- `ScriptListPage` / `ScriptEditorPage` / `ScriptRunPage`
- `RepositoryManagementPage` / `RepositoryDiscoveryPage` / `ToolLibraryPage`
- `PluginManagementPage` / `PluginDetailPage`
- `ScheduleManagementPage` / `ScheduleEditorPage`
- `SystemSettingsPage`
- `AccessTokenManagementPage`
- `ConfigValueManagementPage`

AI 相关能力主要分布在：

- `aiWorkbench.ts`
- `aiAgentTools.ts`
- `pages` 下的脚本编辑、运行和系统设置相关页面

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

打包产物会在 `actiondock-app-spring` 构建时自动复制进后端 jar。

## 相关模块

- Web 宿主见 [../actiondock-app-spring/README.md](../actiondock-app-spring/README.md)
- 脚本平台领域见 [../actiondock-core/README.md](../actiondock-core/README.md)
- AI 工作台后端见 [../actiondock-ai-core/README.md](../actiondock-ai-core/README.md)
