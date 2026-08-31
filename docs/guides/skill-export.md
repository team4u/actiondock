# 实践指南：Agent Skill 导出与分发

`ac export skill` 命令用于将 Action Package 打包为可供 AI 智能体（如 Antigravity、Claude Code、Cursor、Codex）直接理解与调用的自包含 Skill。

---

## 1. 导出源码型 Skill (Source Skill)

默认导出为轻量源码型 Skill：

```bash
ac export skill
```

产物生成在 `./dist/<package-id>-skill/`：
- `SKILL.md`：包含 YAML Frontmatter 元数据与工具说明书。
- `actiondock.skill.json`：机器可读的 Tool Schema 清单。
- `actions/`：TypeScript Action 源码文件。
- `playbooks/`：SOP 操作规程 Markdown 文件。

---

## 2. 导出独立二进制型 Skill (Standalone Skill)

如果目标机器或沙箱环境没有安装 Bun，可导出包含预编译二进制的独立型 Skill：

```bash
ac export skill --standalone
```

此时导出包内包含预编译好的自包含单文件二进制，AI 智能体直接通过 `./bin/<name> run <action>` 执行，零环境依赖。

---

## 3. 按 Playbook 规程按需裁剪

当一个大型 Action Package 包含数十个 Action，但某个特定任务场景只需要其中几个时，可以使用 `--playbook` 进行按需裁剪打包：

```bash
ac export skill --playbook review-pr
```

导出引擎会自动：
1. 解析 `playbooks/review-pr.md` 的 Frontmatter，提取声明的 `actions`。
2. 仅打包这些被引用的 Action 文件（及其级联依赖），剔除无关文件。
3. 生成针对该特定规程精简的 `SKILL.md`。

---

## 4. 常用参数选项

| 参数 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `-o, --out <dir>` | `./dist/<package-id>-skill` | 自定义导出目标目录 |
| `--standalone` | `false` | 打包预编译单文件独立二进制 |
| `-p, --playbook <id>` | (全部) | 按指定 Playbook 裁剪依赖 Action |
