# ENB — Easy Network Builder

> 本 README 暂作开发记忆文档，记录项目方向与基座变更；不是安装或使用说明。

## 当前状态

### EasyTier 虚拟内网管理首版（2026-11-27，未上线）

- 新增 `/admin/virtualnet` 页面与 `admin:virtualnet.*` RPC，EasyTier 运行时节点信息只读，SSH 凭据加密保存，支持指纹核实、连接测试与确认后后台 Compose 部署。
- 仅查询固定 CLI 命令，不透传原始配置／网络密钥，不允许从页面修改 EasyTier 配置；Compose 接入与权限边界见 `deploy/easytier/README.md`。
- 自动部署仅新建 Linux amd64 采集 Node，不迁移代理或覆盖已有部署。尚未发布镜像／部署线上，现有 HK/MY 代理不受本轮改动影响。

2026-11-26：停止沿用原 ENB 代码，清空当前工作目录中的旧源码、配置、构建与部署文件，仅保留本 README 和 Git 元数据。历史提交保留，不改写历史。

随后按用户要求，将 Lite-Plus 服务端源码克隆到 `lite-plus/`，保留其独立 Git 历史与上游远端。已构建包含配套前端的 Linux amd64 Alpine 镜像，并通过临时容器启动与 HTML 响应检查；尚未验证真实部署的完整业务闭环。

- 克隆来源：`https://github.com/nuomiiiii/Lite-Plus.git`
- 初始检出提交：`fb4fa1d2`（`main` 分支）。
- 根目录 README 继续作为 ENB 开发记忆；`lite-plus/README.md` 保留上游说明。
- Agent 已克隆到 `lite-plus-agent/`，来源为 `https://github.com/nuomiiiii/Lite-Plus-agent.git`，保留独立 Git 历史。
- 配套前端已克隆到 `lite-plus-web/`，提交 `d34e60a37544ecdfdfba9dbbf4e897c828585ef2`，版本 `0.2.1`；已执行 `npm ci`、`npm run build`，产物嵌入服务端。

### Agent 内核升级（2026-11-26）

- Xray：`v26.6.27` → `v26.11.9`，固定提交 `676eaf66f8f05d4d558ee7a74b4736623d3feeb9`。
- sing-box：`v1.14.3` → `v1.14.4`，固定提交 `c005f35300ce76427dc285481ec5695f5b179cd2`。
- 新依赖要求 Go 1.27，CI 构建工具链调整为 Go 1.27.3。
- 适配 Xray 移除的 Shadowsocks NONE 枚举及在线 IP 注册 API；修正双栈 UDP 监听探测，避免 Hysteria2 / TUIC 监听冲突。
- Linux amd64：`go test -tags with_quic,with_utls ./nodemgt/...` 通过；`go vet -tags with_quic,with_utls ./...` 通过；Agent 构建通过。
- 首次全量测试中的防火墙失败共 6 项（此前口头统计为 7 项有误）：两个过时断言已修正并通过；其余四项通过 pkexec 提权，在独立网络命名空间中验证通过，其中运行状态测试同时隔离挂载以避免写入宿主机 nftables 配置。未修改宿主机防火墙规则。普通用户直接跑全量测试仍可能遇到权限失败；尚未完成全仓隔离环境复测，不宣称生产可用。
- 未提交或推送本次源码改动；Agent 镜像已按用户要求推送到 Docker Hub。公网、GUI 客户端和其他系统架构尚未验证。

### Docker 镜像（2026-11-26）

### 远程试部署（2026-11-26）

- Tencent-LA 仅运行 Head，Compose 位于 `~/enb-test/compose.yaml`；公网入口 `https://network.nodoka.top`，现有 nginx 反代本机 28777，管理员初始化已完成。
- HK/MY 的 Node 已通过 `/root/enb-test/compose.yaml` 接管原 Xray 代理；每台保留两个 VLESS / Reality 入站，原 UUID、Reality 密钥和分流规则迁移到面板。控制下发状态均为 `applied`。
- HK 保留 nginx 的 IPv4 / IPv6 443 SNI 分流及本机 14443 / 14444 映射；MY 保留 IPv4 443 → 容器 443、IPv6 443 → 容器 444。跨服务器双栈连接、原凭据握手和 HTTPS 请求测试通过；未承诺双栈出站，当前测试出口为 IPv4。
- 旧 `xray-xray-1` 容器已停止、未删除，原 `/root/xray/` 与 `/root/enb-test/backups/` 保留。回退时先停新 Node 释放端口，再到 `/root/xray` 执行 `docker compose up -d xray`。
- Node 必须覆盖镜像默认帮助命令：`command: ["--disable-auto-update"]`；代理快照与规则资源通过 `./data/nodemgt:/app/nodemgt` 持久化。节点凭据仅保存在远端受限权限 `.env`，不纳入仓库。
- 短时 Docker 内存样本：Head 约 23MiB；双入站启用后 HK 约 23MiB、MY 约 56MiB，受启动、GC、规则缓存和负载影响，非容量保证。未做持续高负载测试，分流目标 HTTPS 成功不等于已独立验证其出口 IP。

### 镜像构建记录

- 目标仓库：`docker.io/nodokaqwq/enb`，平台 `linux/amd64`，运行基座 `alpine:3.23`。
- `node-latest`：包含升级后的 Xray / sing-box，使用 CGO_ENABLED=0 静态构建；已推送并核对远端平台，容器 `--help` 检查通过。
- `head-latest`：包含 Lite-Plus 0.2.1 服务端、配套前端和内置主题，使用 Go 1.27.3 + musl 静态构建；启动及 HTML 检查通过。
- 本轮构建文件及临时产物位于 `/tmp/opencode/enb-images/`，尚未作为可复现发布流水线纳入源码仓库。

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
