# ActionDock 代码注释规范化项目

本项目为 ActionDock 代码库添加专业的 JavaDoc 注释。

## 项目结构

```
actiondock-core/          # 核心模块
  domain/model/          # 域模型实体
  domain/port/          # 端口接口
  application/           # 应用服务
actiondock-plugin-api/   # 插件 API
actiondock-app-spring/    # Spring Boot Web 层
actiondock-storage-jpa/  # JPA 持久化层
```

## 注释规范

1. **类级注释**: 说明类的用途、设计意图、作者
2. **方法注释**: 说明入参、返回值、异常、业务逻辑
3. **字段注释**: 说明业务含义（仅对关键字段）
4. **中文注释**: 与现有代码保持一致

## GSD 工作流

- `/gsd-plan-phase 1` - 规划 Phase 1 (Domain 层注释)
- `/gsd-execute-phase 1` - 执行 Phase 1
- `/gsd-plan-phase 2` - 规划 Phase 2 (API 层注释)
- `/gsd-execute-phase 2` - 执行 Phase 2
- `/gsd-plan-phase 3` - 规划 Phase 3 (Storage 层注释)
- `/gsd-execute-phase 3` - 执行 Phase 3

## 参考文件

- 注释风格参考: `actiondock-core/src/main/java/org/team4u/actiondock/domain/model/ScriptDefinition.java`
