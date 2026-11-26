# ENB — Easy Network Builder

> 本 README 暂作开发记忆文档，记录项目方向与基座变更；不是安装或使用说明。

## 当前状态

2026-11-26：停止沿用原 ENB 代码，清空当前工作目录中的旧源码、配置、构建与部署文件，仅保留本 README 和 Git 元数据。历史提交保留，不改写历史。

随后按用户要求，将 Lite-Plus 服务端源码克隆到 `lite-plus/`，保留其独立 Git 历史与上游远端。尚未安装依赖、构建、部署或验证运行。

- 克隆来源：`https://github.com/nuomiiiii/Lite-Plus.git`
- 初始检出提交：`fb4fa1d2`（`main` 分支）。
- 根目录 README 继续作为 ENB 开发记忆；`lite-plus/README.md` 保留上游说明。
- 配套前端与 Agent 尚未克隆。

## 开发路线变更

### 原计划：基于 Marzneshin 二次开发

ENB 曾计划以 [Marzneshin](https://github.com/marzneshin/marzneshin) 为基础，开发适合个人使用的多节点代理与有限运维管理面板。

目标包括：

- 单个面板管理多台服务器上的 Xray / sing-box 内核。
- 根据面板设置生成代理配置、用户订阅，并部署到目标节点。
- 统计和管理节点代理流量、用户流量及连接来源 IP。
- 管理指定目录下的 Docker Compose 项目，以及指定进程或服务的状态。

期间也曾规划并推进独立 Go 后端重构。以上属于旧路线，不再作为后续开发的默认前提；过去的实现与测试记录不代表新基座已经具备或通过验证。

### 当前决定：改用 Lite-Plus 作为基座

用户于 2026-11-26 明确决定：放弃当前 ENB 代码底座，转为基于 [Lite-Plus](https://github.com/nuomiiiii/Lite-Plus) 二次开发。

原因：

- Lite-Plus 已覆盖较多 ENB 所需功能，包括多节点管理、入站与出站、路由、用户与套餐、订阅、监控及远程管理。
- 服务端与 Agent 以 Go 为主，符合后续开发方向。
- 复用现有功能，减少重复建设，把精力放在实际缺口与个性化需求上。

ENB 的需求继续作为参考，但旧方案中的通信协议、内核托管方式和目录结构等架构选择不再自动沿用，应结合新基座重新评估。

## 后续工作

1. 检查 Lite-Plus 服务端、配套前端、Agent 及依赖的源码、许可证和构建流程。
2. 选择并固定配套版本，验证原版可构建、可部署。
3. 验证添加节点、创建入站与用户、获取订阅、实际代理连接、流量统计、禁用及到期控制等核心闭环。
4. 盘点 ENB 需求与上游能力的差异，再确定二次开发范围。

旧代码清理与后续源码克隆均未部署服务、修改原仓库远端、提交或推送。

## 上游与许可证注意事项

- [Lite-Plus 服务端](https://github.com/nuomiiiii/Lite-Plus)：已核对根许可证为 MIT。
- [Lite-Plus-agent](https://github.com/nuomiiiii/Lite-Plus-agent)：GitHub 标识为 GPL-3.0，仍需核对许可证正文与依赖。
- [官方共用文档](https://nuomiiiii.github.io/Lite-document/plus/)：Plus 专属功能单独标记。

不能将整套新项目笼统标记为 MIT；前端、Agent、内核及其他依赖需分别核查并保留所需声明。旧 Marzneshin 代码受 AGPL-3.0 约束，清空工作目录不会改变历史代码的许可证，也不代表可以不经评估就将旧代码移植到新基座。
