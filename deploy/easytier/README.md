# EasyTier 只读发现 / SSH 部署（首版）

2026-11-27 已构建发布并更新 Tencent-LA 测试环境，节点发现与浏览器检查通过。自动安装完整闭环仍待隔离目标验收。不会修改已有 EasyTier 配置。

## 接口与权限

- 页面 `/admin/virtualnet`；RPC `admin:virtualnet.*` 仅管理员登录会话可调用，拒绝 API Key。
- Head 内安装与 core 匹配的 `easytier-cli`，固定执行 `-p <portal> -o json -v [--instance-name <name>] route`。
- `ENB_EASYTIER_RPC`：部署时指定 RPC 地址；`ENB_EASYTIER_CLI`：CLI 路径；`ENB_EASYTIER_INSTANCE`：可选实例名。首版要求选择单一实例。
- 支持当前 verbose JSON 的 `node_info` / `peer_routes` 格式。仅输出白名单字段，绝不透传 `node_info.config`、网络密钥或原始错误输出。未知版本明确报错，不猜测文本表格。
- 在 `/admin/virtualnet` 的**部署设置**配置 Node 主控 HTTPS 地址与可选虚拟 IP 映射，保存到 `enb_virtualnet_settings`。无硬编码域名/IP，不依赖 `ENB_NODE_CONTROL_URL` 环境变量；配置未完成时禁用部署并提示入口。
- 主控地址须为证书有效的 HTTPS origin，可带端口，不允许路径、账户、查询参数或 fragment。可选虚拟 IP 通过新 Node Compose 的 `extra_hosts` 映射，仅影响新容器；URL、SNI 和证书校验保留域名，不改宿主 DNS。清空两项禁用新安装，不会修改已有 Node。
- RPC `admin:virtualnet.settings` / `admin:virtualnet.settings.save` 同样仅允许管理员登录会话，拒绝 API Key。部署进行中禁止改设置；任务启动时捕获设置快照，避免后续修改影响已提交任务。

### 页面配置步骤

1. 打开“虚拟内网”→右上角“部署设置”。
2. 输入 Node 可访问、证书有效的主控 HTTPS 地址；不是 EasyTier RPC 地址，也不是 SSH 地址。
3. 若希望控制链路固定经过 EasyTier，在可选 IP 映射填写主控虚拟 IP。域名仍用于 TLS/SNI，仅新 Node 容器的 hosts 发生变化。
4. 保存后页面显示当前控制地址与映射，刷新后仍保留。部署确认框再次展示生效地址。
5. 设置只影响之后安装的 Node。已有 Node 不会因保存设置自动改地址；连接检查仅验证 SSH/Docker，不代表配置的主控地址已从该目标验证可达。

页面配置验收：数据库保存、刷新保留、清空禁用、非 HTTPS 地址拒绝、未登录接口拒绝均通过。部署设置弹窗在桌面及 390px 手机视口输入框均为 40px、无横向溢出。746 前端测试/构建/ESLint、相关后端竞态及全仓 vet 通过；全仓测试跳过 4 项依赖外网的 GeoIP 查询后通过，未将外网查询标为通过。
- SSH 目标必须是本次发现的远端虚拟 IPv4/IPv6，排除本机；子网代理公告不是部署目标。主机指纹需要独立核实，探测指纹不会自动信任。
- SSH 密码、私钥、口令与 sudo 密码通过现有实例密钥加密入库，不返回浏览器；必须一并保护数据库和 `lite-instance.key`，备份同样视为敏感信息。

## Compose 与 RPC 的边界

`compose.override.example.yaml` 示意在**同一个 Compose 项目**中让 Head 使用现有 EasyTier 服务网络命名空间。CLI 在 Head 内运行，通过 loopback RPC 查询，而不是 `docker exec`；不需要 Docker Socket、Docker 管理权限或网络密钥。示例中的服务名需要按实际修改。

共享网络命名空间时，端口发布属于 EasyTier 服务；Head 不能再写 `ports`/`networks`。现有 EasyTier 若使用 host 网络，不应直接照抄：可评估 Head host 网络并严格限定监听，或单独受限 RPC 地址与 Docker 到虚拟网的路由；变更前确认端口与防火墙，不能开放公网 RPC。不能仅用普通 Compose bridge 就假定 Head 能访问另一容器里的 TUN。

RPC 通常不提供应用级只读权限。ENB 固定查询命令只是应用约束，不能把有权访问 RPC 的 Head 进程视为无权修改 core。更强隔离需以后增加只读查询代理。首版不暴露任意 CLI 执行接口。

构建示例要求 `EASYTIER_IMAGE` 固定为与 core 匹配的 digest，并核对镜像内 CLI 路径及 Alpine 兼容性。在根目录构建 `deploy/easytier/Dockerfile`，多阶段构建会自动构建当前前端并嵌入 Head，不再依赖手工复制 dist。三个源码目录由 ENB 根仓库统一管理。

## 部署行为与局限

1. 发现 → 配置 SSH / 指纹 → 测试 → 用户确认部署。
2. 仅 Linux amd64、已安装且有权限访问 Docker Compose 的机器。不会安装 Docker，不获取任意 shell 输出。
3. 后台任务创建独立面板节点及凭据，在 **SSH 登录用户家目录的 `enb/node`** 新建目录，例如 root 为 `/root/enb/node`、nodoka 为 `/home/nodoka/enb/node`。在提权前捕获登录用户的 HOME，sudo 不会改变此路径。通过 SSH stdin 写入权限受限 Compose，使用固定 Node digest、关闭自更新并持久化 `/app/nodemgt`。
   新 Node 默认名复用 EasyTier 设备 hostname，空名称回退 `EasyTier-<peer_id>`；只影响新注册，不自动覆盖用户已有节点名称。
4. 默认拒绝覆盖已有目录；管理员可以在检测结果弹窗中确认强制替换当前用户 `~/enb/node` 的受管项目。其他目录/项目不自动接管，不迁移代理或修改防火墙。
5. 最多单任务执行，等待 Agent 真正上线才标记成功。失败或 Head 重启保留现场和面板关联，不自动重复安装。人工确认／清理后才重新接入，避免产生重复 Node。
6. 删除凭据清空密码、私钥、口令与提权密码，但保留 Node 关联，不卸载远程服务，也不会重新允许自动安装。页面通过 `has_credentials` 区分保留的关联和可用 SSH 配置。远程 `~/enb/node/compose.yaml` 含 Node Token，需保护。检测到旧版 `/opt/enb/node` 也会拒绝自动重复安装，不自动迁移旧目录。
7. 现有 HK/MY 不应用此自动安装测试替换：它们已有手动部署及运行中代理。
8. 新部署使用 `network_mode: host`，并按下文筛选宿主出口网卡；旧 bridge 安装不会自动迁移。仍从宿主 IPv6 路由获取公网源地址（仅接受 2000::/3），通过受限 `.env` 的 `ENB_HOST_IPV6` / `AGENT_CUSTOM_IPV6` 上报，没有则留空。这不是启用 IPv6、代理入站或出站，不修改 Docker daemon/宿主路由。
9. 在服务器页面删除 Node 会同步解除对应虚拟内网 Profile 的关联，保留 SSH 凭据和部署历史。读取 profiles 时也修复旧版残留关联；跳过运行中任务。删除面板不等于卸载：旧受管安装须经检测及强制覆盖确认；其他项目仍拒绝覆盖。

### 宿主机流量口径

新自动安装生成 host 网络 Compose，无 `ports`；宿主需安装 `iproute2`。安装脚本读取 IPv4/IPv6 默认路由的全部 `dev`，只选带 `/sys/class/net/<接口>/device` 的出口并排序去重。物理默认出口与 IPv6 隧道（如 `ipv6net`）并存时跳过隧道，不再整体拒绝部署；loopback、Docker bridge/veth、TUN/TAP、常见 overlay 不计入，避免重复统计。只有隧道/桥接或没有可识别出口时仍拒绝，不能保证覆盖经其他物理接口承载的隧道流量，复杂路由需人工核定。通过后写入 `.env` 的 `ENB_HOST_NICS`，Compose 使用必填插值传给 `AGENT_INCLUDE_NICS`。失败不回退到所有网卡，且发生在 pull/down/删除旧目录之前。

部署失败现在按网卡探测、已有非受管 Node、Compose 校验、镜像拉取、容器启动分别返回脱敏提示。已有 `~/enb-test` 的旧 Node 仍禁止直接部署覆盖，须单独保留配置和数据迁移；这不属于连接测试的检查范围。

本轮为源码变更，尚未发布新镜像或更新线上 Head/Node；线上 `.14` 的旧模板仍使用 bridge。以下说明不代表现有实例已经切换。

验证：模拟 IPv4/IPv6 同口去重、不同出口、IPv6-only、multipath、无默认路由、命令失败、隧道/桥接/未知设备及非法名称；失败不得停止旧项目。相关后端竞态、全仓 vet、749 前端测试/build/ESLint通过，全仓后端跳过4项外网GeoIP后通过。隔离真实 Compose（仅 sleep，无代理监听）确认生成模板实际为 host、网卡缺值拒绝、环境插值正确；真实覆盖和保留数据生命周期回归通过。未进行线上迁移或真实宿主流量对比验收。

- 服务器速度、累计与服务器账本改为整机经过这些网卡的流量；其他容器及独立代理也包含。用户/套餐流量仍由 ENB 内核用户计数提供，完全独立。
- 不同时累计出口与桥接/TUN，避免重复。默认路由自动选择不是任意拓扑识别：bond/VLAN、策略路由、VPN 默认出口、多网卡内网需人工核定；仅走未选网卡或 loopback 的流量不包含，也不保证与厂商账单一致。
- host 网络减少网络隔离，内核直接占宿主端口。未新增 privileged、capabilities、宿主 `/proc` 或 Docker Socket 挂载；不意味着可忽略主机权限边界。检查现有代理与双栈端口，尤其 HK/MY 旧映射，不能盲目迁移。
- 面板已保存的“在线采集配置”会覆盖环境变量，即使其包含网卡为空也可能改为统计所有网卡。迁移时同步包含/排除规则并下发，等待生效后核对。新安装未保存在线配置时使用环境值；不自动覆盖用户在线设置。
- 选择记录在 `.env` 中，不会随默认路由变化自动刷新。恢复仍沿用原文件，不升级 bridge，也不重算历史。改网卡/网络命名空间可能造成累计阶跃，首次宿主样本可能是宿主开机以来总量；切换前后应检查服务器流量校准及账本基线，必要时人工校准。不要当作新增用量，不自动清空既有流量或套餐。

### 旧 Node 保留数据迁移

以下为人工迁移步骤，**不是强制覆盖安装**；先核定端口和可接受的短时 Node 中断。此变更不会自动操作已有远端节点。

1. 在目标宿主查看真实出口及监听：

   ```sh
   ip -o -4 route show default
   ip -o -6 route show default
   ss -lntup
   ```

   核对每个出口 `/sys/class/net/<接口>/device`，IPv4/IPv6 同接口只算一次。不要把 `docker0`、`br-*`、`veth*`、`tun0` 与物理出口相加。记录迁移前服务器累计/校准数据。检查原 Compose 的 `ports`、监听地址、内核快照及面板入站：host 后容器端口变成宿主端口，旧映射不再有效；原独立代理不能占用相同端口。

2. 在 SSH 登录用户原 `~/enb/node` 修改现有文件，**保留 Token、控制地址、extra_hosts、数据挂载和整个 nodemgt**。在 `compose.yaml` 的 `node` 下加 `network_mode: host`，移除该服务的 `ports` 和显式 `networks`（若存在），环境添加：

   ```yaml
   services:
     node:
       # 其他原有字段保持，不要用此片段覆盖完整文件
       network_mode: host
       environment:
         AGENT_INCLUDE_NICS: "${ENB_HOST_NICS:?host uplink NICs must be configured}"
   ```

   在原 `.env` 添加 `ENB_HOST_NICS=实际接口名`；多接口逗号分隔，不要重复键，不可照抄某台机器的 `eth0`。保护原文件权限。同步面板在线采集配置中的包含/排除网卡并核对生效状态，避免下发规则覆盖环境值。

3. 验证并仅重建该 Node（不用 down、不删文件或服务器记录）：

   ```sh
   cd ~/enb/node
   docker compose -p enb-managed-node config --quiet
   docker compose -p enb-managed-node up -d --no-deps node
   docker compose -p enb-managed-node ps
   docker inspect enb-managed-node-node-1 --format '{{.HostConfig.NetworkMode}}'
   ```

   普通用户若无 Docker 权限按现有授权使用 sudo；不要改变原项目名。最后应显示 `host`，且面板原 UUID 重新在线。对比宿主 `/sys/class/net/<接口>/statistics/{rx_bytes,tx_bytes}` 与面板同一时间窗口增量，确认独立宿主业务也被计入（月重置模式只累计采样周期内数据，不要求绝对数相等）。再次测试原代理和双栈监听；核对并按需人工校准统计基线。失败时恢复修改前网络/网卡字段并用同一命令重建，不删除数据。

### 撤销部署 / 恢复（保留数据）

- “撤销部署（保留数据）”检测并确认后，仅 down 当前 SSH 用户 `~/enb/node` 的固定受管 Compose。Node 及容器内代理内核停止；不删目录、Compose、`.env`、Token、nodemgt 快照/规则或面板服务器，显示 paused 状态。
- “恢复部署”使用原 Compose 和原环境，拉取原固定 Node digest 后 `up -d --no-deps node`，不写配置、不新建服务器，等待原 Agent 重新上线。页面部署设置的变化只影响新安装，不影响恢复。
- 撤销后点击“部署 Node”优先恢复；强制覆盖另有独立红色入口，仍需数据删除确认。服务器记录已删或 Token 已失效时不能直接恢复，避免静默用新 Token 覆写原文件。
- 撤销/恢复使用分动作的会话绑定单次确认，不得用 pause/resume 凭证授权覆盖。仅单服务、固定镜像的受管项目可恢复；其他项目归属或符号链接仍拒绝。
- 不会为了恢复改写旧 Token 或重新关联已删除的面板服务器。请保留服务器记录；如果手动旋转过 Token，先保证远端原配置仍有效。撤销时会关闭主控旧连接，使面板不再误报在线；恢复以实际 Agent 重连为成功依据。
- “拉取镜像”指原 Compose 的固定 digest，不会自动切换 `node-latest` 或升级到未知版本。恢复可能重新启动快照中的代理内核，因此会显示操作确认；不是只恢复监控页面。
- 隔离 Linux 真实 Compose 验证 down 后无运行容器、pull/up 后重新运行，原 Compose 与快照字节保持不变；模拟测试含 pull/down 失败、符号链接、文件保留。前端749测试及构建/ESLint通过。
- 已发布并更新 Tencent-LA 为 `0.2.1-enb-easytier.14`，`head-easytier-20261127-14`，digest `sha256:3911b4546abb99d974c2e9b2c4739905ef2b4a0d3ec60c54885f9fdd3ab471d6`。浏览器 LA2 撤销/恢复确认框验证后均取消，容器未重建、原 compose.yaml/.env 校验和保持，未实际停止远端节点。相关后端竞态/vet、全仓跳过4项外网GeoIP后通过。

### 显式强制覆盖

- 点击部署先调用管理员会话专用 `virtualnet.inspect`，只检查 `~/enb/node`、Compose 容器及运行状态，不修改远端。发现安装或现有面板关联时，弹窗必须勾选数据永久丢失确认。
- `virtualnet.deploy` 必须携带检测返回的单次确认凭证，绑定会话、完整 SSH 配置和部署设置，5 分钟失效；更换凭据/地址/设置后必须重新检测。覆盖默认关闭，检测未发现旧安装时不允许凭空开启覆盖。
- 仅允许同一 SSH 用户家目录的 `~/enb/node` 和固定 `enb-managed-node` 项目；Docker Compose working_dir 标签不匹配、其他项目占用同目录、符号链接或挂载目录均拒绝。旧 `/opt/enb/node` 不属于覆盖范围。
- 提权后仍使用原登录用户 HOME。远端加部署锁、暂存并验证新 Compose、先拉取镜像，再 down 对应项目；down 失败不删旧数据。成功后删除整个 `~/enb/node` 并重建，父 `~/enb` 和其他项目保留；不使用旧 YAML 执行任意项目命令。
- 不创建备份。该目录内旧入站、快照、规则、凭据等永久删除；不会保留本地代理状态，可能中断旧 Node 托管的代理。已有面板关联复用其 UUID/Token，不额外注册重复服务器；服务器已删才注册新的。面板尚存的配置仍可能在 Agent 重连后再次下发。
- 此选项不是任意 Compose 运维入口，不自动接管别处的 Agent/Compose 项目、不修改 EasyTier、防火墙或系统服务。
- `down` 不使用 `-v`，不删除 Docker 命名卷或镜像；删除范围是 `~/enb/node` 内的文件/绑定目录。覆盖前先验证并拉取新镜像，减少停止旧服务后才发现下载失败的风险。复用 Node UUID 时须等待新的 Agent 连接代际上线，不把旧连接残留视为安装成功。
- 测试覆盖未确认拒绝、错误项目归属、符号链接/挂载点、镜像拉取失败不停止旧项目、down 失败保留数据、成功 down→替换→up、父目录其他数据保留；凭证过期/会话及配置变化/重放拒绝。隔离 Linux 使用随机独立项目进行真实 Docker Compose 覆盖测试通过，非在现有远程 Node 执行破坏性验收。
- 前端 748 项测试、构建/页面 ESLint；相关后端竞态测试、全仓 vet 通过；全仓测试跳过 4 项外网 GeoIP 查询后通过。
- 已更新 Tencent-LA `0.2.1-enb-easytier.13`，镜像 `head-easytier-20261127-13`，digest `sha256:41633000963293be2c79939de8da109be6d661e91c05241543ef052f72525716`。浏览器只读检测 LA2 目录/Compose/运行状态均为有，勾选前按钮禁用、勾选后启用，再取消，未触发实际远端覆盖；LA2 原容器运行时长未变化。
- `.10` / `.11` / `.12` 为本地中间构建，未推送/部署；本次发布以 `.13` 为准。

删除关联回归覆盖：正常删除事务释放关联且保留凭据、profiles 历史残留修复、有效服务器关联保留、运行中任务关联不清理；前端验证返回/可见性及定时刷新。747 前端测试及构建/ESLint、virtualnet/clients/jsonrpc/dbcore 竞态测试、全仓 vet 通过；全仓测试跳过 4 项外网 GeoIP 后通过。

### 最新合并版上线（2026-11-27）

- Tencent-LA 当前 `0.2.1-enb-easytier.9`，镜像 `head-easytier-20261127-9`，digest `sha256:4327a5e3e7c8c29ead81306bea9d836fa5c147ce8d1105fb16ccfec55144e68c`。包含页面部署设置、设备名默认命名、宿主 IPv6 上报、删除关联修复及状态刷新。
- 升级后浏览器确认旧 3 条已删除服务器残留关联全部释放、6 份 SSH 凭据保留、有配置的远端部署按钮恢复可用；用户已保存控制 URL/IP 未被覆盖。未为验收删除真实服务器或卸载/覆盖远端安装。
- `.7` 已推送但未部署；`.8` 仅本地构建未推送。当前实际运行以 `.9` 及上述 digest 为准。

### LA2 首次自动安装验证

- 用户已通过虚拟内网页面成功安装 LA2，后台任务 `succeeded / online`，实际目录 `/root/enb/node`，固定 Node 镜像。任务和 Agent 在线状态已核实。
- 宿主有公网 IPv6 与默认路由，默认 bridge 容器仅 IPv6 loopback，导致自动检测不报 IPv6。仅对该新采集 Node Compose 增加宿主 IPv6 上报环境并重建；面板已显示宿主公网 IPv6 且 Node 在线。未动原 Xray/sing-box，未据此声称容器双栈代理已可用。

## Tencent-LA 测试环境验收（2026-11-27）

- 镜像 `nodokaqwq/enb:head-easytier-20261127-1`，digest `sha256:564d6669cdb2b98843a9edbcb8eec5d8be9da482bfcddd1ec16f98df001d3700`，linux/amd64，版本 `0.2.1-enb-easytier.1`。
- 匹配既有 EasyTier 2.6.4 CLI。既有 RPC 白名单拒绝 Docker bridge 来源（TCP 可连不代表 RPC 可用），采用 Head `network_mode: host`、显式 `--listen 127.0.0.1:28777`；内置 HTTPS 未启用，公网仍由原 nginx 终止 TLS。未更改 EasyTier、nginx、防火墙或现有 Node。
- Head CLI 与已登录页面均发现 9 设备（本机及 8 远端）；RPC 返回仅白名单字段，无原始配置或网络密钥。刷新、SSH 指纹探测通过，未登录发现请求拒绝。容器无重启；公网 HTTPS 版本及嵌入前端检查通过。
- 相关后端竞态测试通过；全仓 `go vet ./...` 通过；前端 742 项测试、构建及页面 ESLint 通过。后端全量测试其余包通过，GeoIP 外网查询超时并触发该测试原有空指针，不标为全量通过。新增真实 SSH exec/stdin 与模拟 sudo 测试，不等同实际 Docker 安装验收。
- 首次上线时未设置 `ENB_NODE_CONTROL_URL`，自动安装明确拒绝。后续按用户要求改为页面部署设置，不再读取该环境变量。远端完整安装闭环仍未验证；未在已有代理机器试装。首次检查时 MY 重连在线、HK 离线，后续 HK 已重新出现在发现列表。
- 用户明确当前均为测试环境，本轮不创建额外配置或数据备份；仍保留旧镜像。源码未提交或推送 Git。

### SSH 连接排错

- 填写远端实际 SSH 端口和允许登录的用户；默认 `22` / `root` 不是自动识别结果。sudo 在成功登录后才执行，不会绕过禁用 root 登录的策略。
- 指纹探测只显示未验证指纹，需要通过服务器控制台或已有可信 SSH 通道核实。不同主机密钥类型的 SHA256 指纹不同，不能把 ED25519 指纹直接替代探测到的 ECDSA 指纹。
- 握手错误分为主机指纹不符、认证失败、超时、其他协议/算法错误；不返回服务器控制的原始错误。指纹不符时不会发送认证资料。
- 保存时校验 SHA256 指纹为完整的 32 字节摘要，去除用户名称与指纹两端空白；不修改密码或密钥内容。
- SSH 对话框使用紧凑尺寸及固定浮动标签，避免主题的 medium 输入框 border-box 高度压缩造成标签/提示重叠；不全局改写其他页面样式。

### SSH / 表单热修复（2026-11-27）

- `head-easytier-20261127-2` 已发布并更新测试 Head，版本 `0.2.1-enb-easytier.2`，digest `sha256:ff7734e898451d87d6b803090b77003d29f659ebda570701b9c41054f3eb9397`。
- 前端 744 测试、构建、页面 ESLint；相关后端竞态测试和全仓 vet 通过。真实浏览器重新加载后，桌面及 390px 手机视口所有表单输入根节点高 40px，无横向溢出，标签/提示重叠已消除。
- 当时用户已保存配置连接测试：LA2 通过，CAN 在 Docker/sudo 阶段失败。后续已确认不是密码或用户权限问题，而是旧版两次 sudo 调用的认证缓存缺陷，见下文。

### sudo 修复及登录用户目录

- 真实 LA1/CAN 均复现旧版 `sudo -S -v` 成功而 `exec sudo -n` 失败。无 TTY 时 sudo 认证记录与父进程关联，exec 改变第二次调用的父进程；不能依赖这种缓存方式。
- 改为单次 `sudo -S` 直接执行。密码、随机分隔行、Compose 内容经 stdin 传送；提权包装器处理 sudo 已消耗/未消耗密码两种情况，只将实际载荷传给安装脚本。密码不进入命令行，不改 sudo 策略。
- 新测试涵盖密码提权、免密/缓存不读取密码、错误密码拒绝、载荷完整性及 sudo 重置 HOME 后仍使用原登录用户路径。真实 LA1/CAN 单次 sudo 检查 Docker Compose 与 daemon 成功。
- `head-easytier-20261127-4` 已发布并更新 Tencent-LA，版本 `0.2.1-enb-easytier.4`，digest `sha256:9a175f48f6fbac77ec106fafd1160d3b9f23038255e7175349b32d1b2a19c7b2`。中间构建的 `.3` 未发布/部署，最新版本同时包含目录变更。
- 升级后通过面板现有保存凭据逐个调用 `virtualnet.test`：LA1、CAN、LA2 全部 `{ok:true}`，未修改远端权限或执行 Node 安装。745 前端测试、前端构建/ESLint、相关后端竞态测试及全仓 vet 通过。
