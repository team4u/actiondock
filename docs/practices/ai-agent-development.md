# 实战指南：智能体协同开发与自愈流程

大模型代码生成改变了人机协作分工。人类的核心价值在于业务编排与划定安全红线。智能体依据契约快速编写代码并调试。

本指南说明如何落地人定规程、智能体写代码、纯内存沙箱自愈的开发流程。

---

## 协作分工与职责模型

ActionDock 将工具软件工程划分为两大职责边界：

```text
人类领域专家                   大语言模型智能体
     │                                │
     ├─ 编写 Playbook 操作规程        ├─ 阅读规程与 actiondock.json
     ├─ 声明 Schema 输入输出契约      ├─ 生成 Action TypeScript 实现
     ├─ 设定安全边界与不可逾越红线    ├─ 编写测试用例
     │                                ├─ 执行 npm test 毫秒级沙箱
     │                                ├─ 依据结构化报错自主修复
     │                                │       ↓ (绿灯通过)
     └─────── 代码评审与合并 ─────────┴─ 提交代码与发起审查
```

- 人类的职责：在 `playbooks/` 目录下编写操作指引。在 `actiondock.json` 中定义字段契约与配置约束。
- 智能体的职责：根据接口模式编写 `actions/` 中的代码。利用 `@actiondock/testing` 编写单测。依据测试错误自主修正，直至断言全部通过。

---

## 为项目配置智能体协作规则文件

为使智能体工具感知项目规范，建议在项目根目录编写规则文件（如 `AGENTS.md` 或 `.cursorrules`）：

```markdown
# 智能体开发指引

- 项目架构：基于 ActionDock 2.x 构建，核心清单为 actiondock.json（schemaVersion: 2）。
- 编码契约：Action 业务逻辑仅依赖 @actiondock/sdk，严禁直接引入未经清单声明的外部包。
- 物理通道：业务返回值仅通过 run 方法输出至标准输出；过程日志一律使用 ctx.log 写入标准错误输出，严禁使用 console.log。
- 测试与自愈驱动：每次编写或修改 Action 源码后，必须在 tests/ 下编写配套单测，并执行 npm test 验证。若测试失败，必须分析结构化报错并自主修正，严禁交付未经测试的代码。
```

---

## 自愈工作流实战

智能体接收到开发任务时，执行标准自愈流：

- 读取规程与清单模式：
  智能体解析 `playbooks/` 对应 Markdown 文件与 `actiondock.json`。提取输入输出模式、配置键名与关联动作。
- 编写原子 Action 业务逻辑：
  根据契约在 `actions/` 中生成代码。
- 编写测试套件：
  利用 `@actiondock/testing` 提供的 `createTestRuntime` 模拟输入、虚拟时钟与进程调用。
- 执行内存沙箱单测：
  在终端执行 `npm test`。内存沙箱与原生类型擦除可在数十毫秒内完成测试。
- 分析错误并自主修复：
  若测试输出校验失败、模式不匹配或边界错误，智能体依据错误栈定位代码行并调整。循环执行 `npm test` 直至通过。

---

## 示例：模式不匹配的自愈全过程

假设智能体在初次生成代码时，返回的字段名称与 `outputSchema` 要求的 `ticketId` 不一致（写成了 `id`）：

```text
测试报错反馈：
错误: 输出模式校验失败: ActionOutputValidationError
  instancePath: ""
  message: must have required property 'ticketId'
```

智能体捕获结构化错误后，识别字段差异。智能体将 `id: res.id` 修改为 `ticketId: res.id`。再次执行测试后通过，完成自动化自愈。
