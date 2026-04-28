# actiondock-core

脚本平台的核心领域模块，定义脚本、执行、配置、调度、仓库和访问令牌等核心模型与应用服务，不依赖 Web、JPA 或具体 AI Provider。

## 负责范围

- 脚本定义、发布快照和执行模型
- 输入输出 Schema 校验与结果投影
- 执行记录、日志、错误详情、参数预设
- 定时任务与调度领域模型
- 仓库定义、工具安装记录、脚本作用域
- 全局配置值与访问令牌管理

## 关键包

- `application`：应用服务，例如 `ScriptApplicationService`、`ExecutionApplicationService`
- `domain.model`：领域实体和值对象
- `domain.port`：仓储、脚本引擎、调度校验器、JSON 编解码等端口

## 关键概念

### 脚本类型

- `GROOVY`
- `PYTHON`

### 脚本作用域

- `PERSONAL`：个人脚本
- `REPOSITORY`：从仓库安装到本地的脚本，只读可更新
- `FORK`：从仓库脚本 Fork 的个人副本
- `DEVELOPMENT`：从开发仓库同步来的本地可编辑脚本
- `SAMPLE`：系统内置示例

### 执行模型

- `ScriptDefinition`：当前草稿或本地脚本定义
- `PublishedScriptSnapshot`：已发布快照
- `ExecutionRecord`：执行记录，含状态、输入、输出、日志和错误详情
- `ExecutionPreset`：命名参数预设
- `SubmitMode`：同步或异步提交方式

执行结果支持两类视图：

- `RESULT`：按输出 Schema 投影后的轻量响应
- `DEBUG`：包含原始输入输出与调试信息的完整响应

### 配置与调度

- `ConfigValue`：全局字符串配置值，支持 `${config.some.key}` 占位引用
- `ScriptSchedule`：脚本定时任务
- `ApiAccessToken`：Bearer Token 管理对象

### 仓库与分发

- `RepositoryDefinition`：仓库定义
- `RepositoryToolInstallation`：已安装仓库工具记录
- `PluginRegistration`：插件注册信息

仓库类型：

- `LOCAL_DIR`
- `GIT`
- `HTTP`

仓库用途：

- `DISTRIBUTION`
- `DEVELOPMENT`

## 你会在这里找到什么

- 脚本保存、发布、Fork、开发同步等应用服务
- 执行输入 Schema 校验和输出投影逻辑
- 仓库工具、插件依赖和配置值的核心规则
- 不依赖基础设施的纯领域接口，方便被 JPA、Web、CLI 复用

## 相关模块

- 运行时装配见 [../actiondock-app-support/README.md](../actiondock-app-support/README.md)
- Web API 入口见 [../actiondock-app-spring/README.md](../actiondock-app-spring/README.md)
- 持久化实现见 [../actiondock-storage-jpa/README.md](../actiondock-storage-jpa/README.md)
