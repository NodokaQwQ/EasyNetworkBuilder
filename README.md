# ENB — Easy Network Builder

> 本 README 暂作开发记忆文档，记录项目方向与基座变更；不是安装或使用说明。

## 当前状态

### Node 独立权限与宿主机管理（2026-11-27，源码首版未上线）

- 虚拟内网设备新增“权限与宿主机管理”弹窗，独立选择 Node 终端／文件／命令／MCP／防火墙／保护，以及宿主机 SSH 终端／SFTP／命令、受管 Node Docker 与显式目录白名单 Compose 操作。
- SSH 应用 Node 权限需要支持 `--remote-permissions` 的新版镜像 digest，保留原 Compose/Token/快照并使用 `permissions.yaml` 重建及核对新 Agent 连接和上报。新版 `node-permissions-20261127-1` 已发布，digest `sha256:218003521e37d3b7bab117532447cbcd040f9a86fa4a0d6a7387d25c51ecd1bb`；未更新线上 Head 或修改远端。
- 权限是功能入口，不是系统沙箱；宿主机 shell/文件/命令不自动 sudo，不额外挂载宿主目录或 Docker Socket、不启用特权容器。详见 `deploy/easytier/PERMISSIONS.md`。
- 发布前复查已修正旧受管镜像兼容、Compose JSON 启动参数检查、空项目列表和应用后新连接确认；前端753测试、相关竞态/vet、Head全仓跳过4项外网GeoIP后通过。镜像构建与隔离检查见 `deploy/easytier/RELEASE.md`；真实网页到远端应用闭环尚待验收。
- 权限版 Head `head-permissions-20261127-1` 已推送，digest `sha256:b0336d37058f25e8a1816f405490c582662d63e2d180b6611622140564360f24`，linux/amd64，版本 `0.2.1-enb-permissions.1`。本地空数据容器启动/安装门禁/前端及 CLI 检查通过；未更新服务器，未覆盖 latest 或提交/推送 Git。

2026-11-27 仓库结构调整：`lite-plus/`、`lite-plus-agent/`、`lite-plus-web/` 已转为普通目录，由 ENB 根 Git 仓库直接跟踪。下文“保留独立 Git”的描述为历史记录，不再代表当前结构。原 Git 元数据已本机备份，上游基线与许可证说明见 `UPSTREAM.md`。

### EasyTier 虚拟内网管理首版（2026-11-27，已更新测试环境）

- 新增 `/admin/virtualnet` 页面与 `admin:virtualnet.*` RPC，EasyTier 运行时节点信息只读，SSH 凭据加密保存，支持指纹核实、连接测试与确认后后台 Compose 部署。
- 仅查询固定 CLI 命令，不透传原始配置／网络密钥，不允许从页面修改 EasyTier 配置；Compose 接入与权限边界见 `deploy/easytier/README.md`。
- 自动部署仅新建 Linux amd64 采集 Node，不迁移代理或覆盖已有部署。已修复删除凭据丢失 Node 关联、部署状态写库错误处理及发现格式校验；补齐前端测试与词条。
- 镜像 `nodokaqwq/enb:head-easytier-20261127-1` 已发布并更新 Tencent-LA，版本 `0.2.1-enb-easytier.1`；Head host 网络仅绑定 loopback，未改 EasyTier 配置。页面与容器发现 9 设备，刷新、指纹探测和未登录权限拒绝通过。MY 在线；HK 当前离线，其最后更新时间早于本轮更新。详情及镜像 digest 见 `deploy/easytier/README.md`。
- 自动安装仍未完成真实 SSH/Compose 闭环验收。主控 HTTPS 地址及可选虚拟 IP 映射现改为虚拟内网页面“部署设置”入口，存数据库且仅影响之后新安装的 Node，不再依赖环境变量或硬编码域名/IP。按用户要求本轮未额外备份。
- 自动安装目录改为 SSH 登录用户家目录的 `enb/node`：root 为 `/root/enb/node`，普通用户 sudo 后仍保留原用户路径。检测到旧 `/opt/enb/node` 会拒绝重复安装，不自动迁移。
- 热修复 `0.2.1-enb-easytier.2` 修复 SSH 表单高度/标签重叠、错误分类和指纹格式；744 前端测试、相关后端竞态及全仓 vet 通过。后续确认 CAN/LA1 密码提权失败源于旧两次 sudo 调用的无TTY缓存问题，不是用户密码/权限配置；已改单次sudo并隔离stdin密码/载荷，真实Docker检查通过。
- 当前测试 Head 为 `0.2.1-enb-easytier.4`，镜像 `head-easytier-20261127-4`，包含单次 sudo 和登录用户家目录变更；升级后面板 LA1/CAN/LA2 连接测试全部通过。745 前端测试、相关后端竞态和全仓 vet 通过。未进行 Node 自动安装。
- 后续用户已实测 LA2 自动安装成功，任务与 Agent 在线已核实，目录 `/root/enb/node`。默认 bridge 无公网 IPv6，已通过 `AGENT_CUSTOM_IPV6` 补宿主地址上报并确认面板显示；不代表容器 IPv6 网络或代理能力已启用。之后新节点名复用 EasyTier 设备名，空名称才回退 peer ID，不自动重命名已有 Node。
- 删除服务器后的虚拟内网部署按钮问题源于残留 `node_uuid`；删除事务同步解除、profiles读取修复旧残留（跳过运行中任务），前端返回时和定期刷新。仅恢复面板可部署状态，不自动卸载远端或覆盖旧目录。
- 最新测试 Head 已更新至 `0.2.1-enb-easytier.9`（`head-easytier-20261127-9`），合并上述页面设置、命名、IPv6 上报及删除关联修复。浏览器确认 3 条残留关联已释放、凭据/用户设置保留、部署按钮恢复可用；747 前端测试、相关后端竞态/vet通过，全仓跳过4项外网GeoIP后通过。具体digest见部署文档。
- 后续按用户要求增加显式强制覆盖：先检测 `~/enb/node` 与固定 Compose 项目，提示后勾选数据丢失确认，单次会话绑定凭证；先拉镜像再 down，失败不删旧目录，成功才替换 `~/enb/node`，不清整个 `~/enb`，不处理其他项目。已有面板关联复用，旧本地入站/快照将丢失；具体权限边界见部署文档。
- 强制覆盖版已推送并更新测试 Head 至 `0.2.1-enb-easytier.13`。748 前端测试、相关后端竞态/vet、隔离真实Compose覆盖测试通过；线上只读检测LA2及勾选门槛验证通过后取消，未执行远端破坏性覆盖。共享记忆本次连接失败，未更新。
- 新增保留数据的撤销/恢复：仅 down 受管 Compose，不删除原安装/Token/快照或面板记录；恢复使用原 Compose pull/up，不新建服务器。paused 状态持久化，之后点击部署优先恢复，强制覆盖另保留独立确认入口。
- 保留数据生命周期版已推送并更新测试Head至 `0.2.1-enb-easytier.14`。749前端测试/build/eslint及相关后端竞态/vet通过，隔离真实Compose撤销/恢复文件保持通过；线上LA2只验收确认框并取消，容器和原Compose/.env未变。

### 服务器流量改为宿主机出口口径（2026-11-27）

- **新自动部署的 Node 使用 `network_mode: host`**。安装时读取宿主 IPv4/IPv6 默认路由，去重选择有 `/sys/class/net/<网卡>/device` 的出口网卡，将 `ENB_HOST_NICS` 写入受限 `.env`，由 `AGENT_INCLUDE_NICS` 限定采集。不是写死 `eth0`，也不需要 privileged、Docker Socket 或新增网络管理权限。
- 服务器页的实时速度、累计流量及对应服务器账本，统计**整台机器经过所选网卡的收发字节**：包含独立代理、其他容器、SSH、EasyTier 的底层传输等；不只统计 ENB 内核。不累计 `docker0`、`veth*`、TUN 等虚拟层，避免重复。仅走其他网卡的内网流量、loopback 通信不在此口径内，也不保证等同云厂商账单。
- **用户用量／套餐额度仍来自 Node 内置 Xray/sing-box 的用户计数，不变成整机流量。** 它与服务器网卡统计是两套数据。
- 需有 `iproute2`；没有默认出口、出口为隧道/桥接或非设备型接口时拒绝自动安装，在停止/删除旧项目之前失败，不回退到统计所有网卡。bond、VLAN、策略路由、多出口等须人工核定网卡；默认路由自动探测不覆盖所有拓扑。
- **host 网络中的内核直接占用宿主端口**，不能保留原 `ports` 映射。旧的端口转换、IPv4/IPv6 分流及监听地址必须逐项检查；不自动迁移 HK/MY 等已有代理，不改 EasyTier、其他 Compose 或防火墙。网卡选择不会在每次恢复时重新探测，出口变化后需人工同步。
- **旧安装不会自动切换**：“恢复部署”保留原 Compose、`.env`、Token 和快照，因此旧 bridge 仍是容器口径。不要为了切换统计方式使用“强制覆盖”（会删数据）。无损修改和核验步骤见 [EasyTier 部署文档](deploy/easytier/README.md#旧-node-保留数据迁移)。
- 面板“在线采集配置”优先于启动环境；已有下发配置须把包含网卡改成相同宿主网卡，并检查排除网卡规则，不能仅修改 `.env`。切换后核对流量校准/账本基线：宿主开机以来累计值可能大于原容器，不能把跳差当新产生流量；历史不补算，不自动清空或校准已有用量。
- 本节描述源码中的新模板；本轮未发布镜像、更新线上 Head 或迁移现有 Node，不能据此认为运行中的旧节点已变为整机口径。
- 验证：749 项前端测试、构建/ESLint、相关后端竞态及全仓 vet 通过；后端全仓测试跳过 4 项外网 GeoIP 查询后通过。隔离真实 Compose 验证 host 模式、必填网卡插值、覆盖及撤销/恢复通过；未验证远端真实宿主流量增量或代理端口迁移。

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
