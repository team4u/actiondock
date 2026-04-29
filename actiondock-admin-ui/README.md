# actiondock-admin-ui

React + Vite 管理台模块，承载脚本平台和 AI 工作台的可视化操作界面。

## 技术栈

- React 18
- Ant Design 5
- Vite
- TypeScript
- Monaco Editor

## 主要页面

- `ScriptLibraryPage` / `ScriptEditorPage` / `ScriptRunPage`
- `RepositoryManagementPage` / `RepositoryDiscoveryPage`
- `PluginManagementPage` / `PluginDetailPage`
- `ScheduleManagementPage` / `ScheduleEditorPage`
- `SystemSettingsPage`
- `AccessTokenManagementPage`
- `ConfigValueManagementPage`
- `SharedStateManagementPage`

AI 相关能力主要分布在：

- `aiAgentTools.ts`
- `pages` 下的脚本编辑、运行和系统设置相关页面

## 系统配置页包含的能力

- 配置值管理
- 共享状态管理
- 访问令牌管理
- 控制台凭证设置
- 数据备份

其中“共享状态”页支持：

- 命名空间浏览与切换
- 条目列表与过滤
- JSON 值编辑
- `secret` 标记
- 过期时间设置
- 删除与清理过期条目
- 查看版本号和最后写入信息

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
