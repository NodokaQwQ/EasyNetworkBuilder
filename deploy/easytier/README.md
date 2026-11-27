# EasyTier 接入与受管 Node 部署

ENB 读取已有 EasyTier 实例发现设备，不创建或修改组网。不要直接套用示例覆盖现有网络服务。

## Head 接入

- 在虚拟内网的“部署设置”填写 EasyTier RPC `host:port` 和可选实例名；留空时使用 `ENB_EASYTIER_RPC` / `ENB_EASYTIER_INSTANCE`。保存后无需重启 Head。
- CLI 文件路径由宿主机 `ENB_EASYTIER_CLI` 配置，默认 `easytier-cli`。不提供网页任意可执行文件路径设置。
- Head 必须能访问 RPC；共享网络命名空间的示例见 `compose.override.example.yaml`，通过 `EASYTIER_SERVICE` 指定原服务名称。已有 host 网络部署应使用适合自身的 Compose 配置，不能混用 service 网络。
- RPC 白名单应只允许可信来源；不要把原始 EasyTier 配置、网络密钥或 RPC 暴露到公网。

## 网页面板入口

1. 部署设置：主控 HTTPS origin（如 `https://head.example.com`）及可选虚拟 IP 映射。证书必须匹配域名，映射仅影响新 Node 的容器 DNS。
2. 设备 SSH 配置：登录账号、端口、密码或密钥、独立核实的主机指纹，以及可选 sudo。凭据加密保存，不回显。
3. 权限与宿主机管理：保存 Node 功能权限、受管 Node Docker、宿主机终端/文件/命令和明确授权的 Compose 目录；需要管理员二次认证。
4. 确认部署：仅创建受管 `~/enb/node`，其中 HOME 是 SSH 登录用户家目录，不是 sudo 后的 root HOME。现有旧部署或冲突项目会被拒绝，不自动覆盖。

更改设置不重写已经运行的 Node，也不替代 nginx、TLS、DNS、防火墙或宿主机网络的首次部署。

## 新部署与镜像获取

新部署强制读取官方 Node stable 发布清单，选择与 Head 和 linux/amd64 兼容的最高数字版本，不套用升级来源白名单；固定 digest 后执行。清单失败则停止，不静默安装旧镜像。

镜像获取先检查本地缓存，再尝试最多20秒拉取。失败后按当前发现的虚拟 IP 数值顺序尝试其他已授权设备；候选须有匹配当前地址的可信 SSH 凭据及 Node Docker 权限。命中镜像缓存直接传输，否则拉取也限20秒。

传输通过 SSH 经 Head 流式协调，不开放 Docker API；单次5分钟、2GiB上限。核验发布 digest 对应的 amd64 manifest/config 和导入镜像ID，Head仍需能访问官方 registry 的元数据接口。导入可能不保留RepoDigests，故使用验明config ID运行，且启动禁止再次pull。全部失败在注册和停止旧服务前结束，不尝试次新版本。动态选择和中转已经包含在 Head 0.0.4 中，但真实跨节点传输尚未验收，不保证端到端可用性。

## 宿主机流量

新受管 Node 使用 host 网络；安装脚本读取IPv4/IPv6默认路由，只选择带 `/sys/class/net/<接口>/device` 的出口并去重。物理出口与IPv6隧道并存时跳过隧道；只有隧道、桥接或没有可识别出口时拒绝。不统计所有接口以免重复计数；bond/VLAN/多出口/策略路由须人工核定。

所选接口写入受限 `.env` 的 `ENB_HOST_NICS`，通过 `AGENT_INCLUDE_NICS` 传给Node。面板在线采集配置如覆盖该值，应同步调整包含/排除规则。宿主机累计流量与用户内核用量是不同口径，不能将迁移后的累计跳差当作新流量。

host网络会直接占用宿主机端口。旧bridge部署不能为迁移流量口径而强制覆盖；应保留Token/快照，核定ports与IPv4/IPv6监听映射，安排维护窗口再手工修改和回退。

## 恢复、覆盖与升级

- 撤销仅停止固定受管项目，保留文件、Token、快照及面板关联；恢复使用原Compose，不套用最新安装模板。
- 强制覆盖仅作用于明确确认的受管目录，可能丢失原Node代理数据。它不是无损升级；镜像获取失败不停止旧服务，并不承诺覆盖后的自动数据回滚。
- 升级Node使用单独版本页，要求已保存Node Docker权限、二次认证与风险确认；停机快照与失败回滚边界见 `../updater/NODE.md`。
- 不接管旧 `~/enb-test`、其他Compose或自定义数据布局；需要单独规划保留数据迁移。

## 首次部署配置

Head监听端口、数据bind、网络模式、CLI路径、反向代理及systemd属于宿主机配置。更新器使用root受控目录，参数见 `../updater/config.example.json`。网页只提交审核发布版本，不提供修改root文件或执行任意安装命令的入口。

不得将实际域名、IP、密码、Token、私钥或运行数据库提交到仓库。历史Git内容需要另行审计，不能仅靠修改当前文档清除。
