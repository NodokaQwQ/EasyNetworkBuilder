# Node 权限与宿主机管理

入口：虚拟内网 → 设备 → **权限与宿主机管理**。先配置并独立核实 SSH 指纹、保存凭据，再在弹窗用管理员密码／两步验证码／通行密钥重新验证。站点「允许远程管理」必须开启；API Key 不可使用。

## 权限分层

- **Node 容器内**：终端、文件管理、命令、MCP、防火墙、服务保护独立选择。MCP 操作还需对应终端／文件／命令权限。Agent 用本地 `--remote-permissions=terminal,files,exec,mcp,firewall,protection` 白名单控制，`none` 全禁用，总开关关闭优先；未配置白名单保持旧行为。
- **宿主机**：网页 SSH 终端、SFTP 文件、SSH 命令独立控制入口，使用保存的 SSH 登录账号，不自动 sudo。root 登录就是 root 权限。
- **受管 Node Docker**：固定 `enb-managed-node` 项目，状态／最多 200 行日志／启动／重启／停止，可使用原先明确配置的部署 sudo。
- **其他 Compose 项目**：逐行指定 `项目名 /绝对目录`，只使用该目录的 `compose.yaml`，校验容器项目工作目录。不自动 sudo、不 pull/up/down、不删除数据，仅状态／日志／启动／重启／停止。SSH 账号须已有直接 Docker 访问权限；Docker 权限通常等同 root。

这些是**功能入口授权，不是操作系统隔离**。开放终端或任意命令后，用户仍可用 shell 读写该账号可访问的文件或执行 Docker；关闭文件按钮不能阻止这些 shell 操作。未增加 Docker Socket、privileged、宿主目录挂载或系统权限。

## 应用 Node 权限

1. 先升级包含此功能的 Head。已发布 Node `node-permissions-20261127-1`，digest `sha256:218003521e37d3b7bab117532447cbcd040f9a86fa4a0d6a7387d25c51ecd1bb`；尚未部署至服务器。
2. 勾选 Node 权限、「通过 SSH 应用 Node 权限并重建容器」及风险确认。镜像 digest 留空使用本次 Head 固定的新版 Node；也可明确填写同仓库不可变 digest。
3. 后端通过固定指纹 SSH 连接，检查现有受管项目及原固定镜像、原启动命令；只接受自动部署的 `~/enb/node`，不覆盖手工改过的启动参数。
4. 先检查镜像帮助是否支持 `--remote-permissions`，旧镜像拒绝，原配置不变。
5. 在安装目录原子写入 `permissions.yaml` 覆盖文件，然后以 `-f compose.yaml -f permissions.yaml` 重建 Node。原 Compose／`.env`／Token／端口／网络模式／快照保持不变，代理短暂中断。
6. 核对应用之后 Agent 新连接及新上报的总开关、精确白名单，确认后才保存授权状态。Head 必须先升级支持 `remote_permissions` 数据字段；新 Agent 不保证兼容旧 Head。

以后面板恢复部署会保留并显式使用 `permissions.yaml`。手工启动同样必须显式带上两个 `-f`，单独运行原 `compose.yaml` 不会使用该文件。强制覆盖安装仍会清除目录和原授权配置，需重新应用。

## 宿主机行为与失败处理

- 宿主机授权保存前验证 SSH 连接；不修改 `sshd`、用户权限、sudoers 或防火墙，仅由 Head 对授权入口执法。无需为宿主机功能重建 Node。
- SSH 身份／凭据修改或删除后，撤销宿主机授权并使终端失效，避免旧授权转移到新目标。
- 终端使用一次性、绑定登录与权限版本的票据，不放 URL，最长 10 分钟；站点开关关闭、登录失效、权限撤销后终止连接。
- SFTP 单文件上限 8 MiB；上传不覆盖现有文件，权限 0600。不支持自动提权、删除及大文件分片；文件访问范围等同 SSH 账号。
- 命令上限 64 KiB，运行上限 45 秒，输出上限 1 MiB。超时关闭 SSH 不保证远端自行后台化的进程终止，重试前核实状态。
- 变更期间先关闭宿主机入口；应用失败或状态保存失败时保持关闭，不声称 Node 已生效，刷新读取 Agent 最近上报并检查远端后重试。覆盖文件写入后启动失败会保留现场，不自动回滚或重新执行。
- 非幂等请求用单次 HTTP，不使用 RPC 客户端的 WebSocket 自动重放。命令、文件内容、认证凭据不记录到审计事件；返回的命令／Docker 日志仍可能包含业务秘密，应由操作者自行保护。

## 验证范围

已覆盖默认拒绝、独立白名单、MCP 依赖、files-only 无 shell、API Key／匿名拒绝、票据重放与登录绑定、撤销、旧 Agent 拒绝、符号链接拒绝、原配置文件保留，以及本地真实 SSH exec/SFTP 上传下载与主机指纹。

发布前复查补充：兼容旧固定 Node digest；启动参数检查兼容真实 Compose JSON 的多行、单行和末尾逗号，拒绝额外参数；应用后要求新 Agent 连接，避免旧在线状态误报成功。真实 Docker Compose 配置合并验证通过；Node amd64 镜像启动、权限参数与非法白名单拒绝检查通过。构建方法见 `RELEASE.md`。

前端 753 项测试、构建和相关 ESLint 通过；Head 相关包竞态测试及全仓 vet 通过，全仓测试跳过四项外网 GeoIP 查询后通过；Agent cmd/terminal/server 测试和权限专项竞态测试通过（未执行 Agent 全仓权限相关系统测试）。

尚未执行线上 Node 权限变更、真实 Docker 新 Agent 重建／回报闭环、浏览器 SSH PTY 端到端或生产验收；不能仅凭单元测试视为已上线。
