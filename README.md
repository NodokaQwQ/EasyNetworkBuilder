# ENB — Easy Network Builder

基于 Lite-Plus 二次开发的节点、代理内核和有限宿主机运维管理面板。上游来源、许可证与版权见 [UPSTREAM.md](UPSTREAM.md) 及各组件的许可证；当前许可证整理尚未完成，不应将本仓库解释为已完成统一 GPLv3 发行审查。

## 组件

- `lite-plus/`：Head 管理后端。
- `lite-plus-web/`：管理前端。
- `enb-theme/`：公共监控大屏 Material Design 3 主题（`ENB Material You`）。
- `lite-plus-agent/`：Node，包含 Xray / sing-box 集成。
- `deploy/updater/`：独立宿主机 Head 更新器。
- `releases/`：官方稳定版本清单和发布说明。

官方镜像仓库为 `docker.io/nodokaqwq/enb`，官方发布源为本仓库 `master/releases/`。部署固定版本 digest，不直接运行可变 latest。

当前已发布 Head 0.0.4（通用化部署设置与受控 Node 镜像获取，允许从 0.0.3 手动更新），Node 保持 0.0.1；镜像 digest、验证范围与限制见 [Head 0.0.4 发布说明](releases/0.0.4.md)。不自动更新线上服务或移动 latest。

## 配置入口

| 参数 | 配置方式 |
| --- | --- |
| 新 Node 主控 HTTPS 地址与可选虚拟 IP 映射 | 虚拟内网 → 部署设置 |
| 现有 EasyTier RPC 地址与实例名 | 虚拟内网 → 部署设置；留空使用环境配置 |
| 节点 SSH 用户、端口、凭据、指纹与部署 sudo | 虚拟内网 → 对应设备 SSH 配置 |
| Node 功能、宿主机管理与 Compose 目录授权 | 对应设备 → 权限与宿主机管理 |
| 节点入站、出站、端口、路由与订阅 | 节点管理相应页面 |
| Head 监听地址、持久数据 bind、EasyTier 服务名、CLI 文件路径 | 宿主机 Compose / 环境变量 |
| Head 更新器项目路径、数据目录、Socket、systemd | root 管理的更新器配置，见 `deploy/updater/README.md` |

网页不能安装 EasyTier、创建网络命名空间、修改宿主机 root 文件或 nginx；这些属于管理员首次部署工作，不通过网页开放任意路径/命令执行。

## 部署与更新

参见 [EasyTier 接入](deploy/easytier/README.md)、[权限边界](deploy/easytier/PERMISSIONS.md)、[Head 更新器](deploy/updater/README.md) 和 [发布流程](releases/README.md)。请先核对数据布局并自行安排备份与维护窗口。

- 新部署从官方 Git 清单选择当前 Head 与平台兼容的最新 stable Node，固定 digest；失败不回退旧版。该动态部署及镜像中转功能尚为未发布源码。
- 镜像中转：目标拉取20秒，失败后按虚拟 IP 数值排序尝试有可信 SSH 凭据和 Node Docker 授权的设备；命中缓存直接传输。Head 需能访问官方 registry manifest 以验证镜像身份。真实跨节点流式传输尚未验收。
- 已有部署恢复保留原 Compose、镜像及数据；升级必须满足精确来源白名单。旧自定义安装不自动迁移。
- Head 更新器独立于容器，不向 Head 开放 Docker Socket。更新有短时中断，失败恢复停机快照可能丢失升级期间写入。
- 权限控制是入口授权，不是系统沙箱；宿主机终端、文件和命令受 SSH 账号本身权限约束。

## 开发验证

Head 使用 Go；前端使用 Node/npm。发布前应运行相关单元测试、竞态检查、vet、前端测试和生产构建，并按发布说明进行隔离镜像及迁移验收。模拟测试不代表代理业务或真实远程部署已通过验收。

本仓库不附带个人服务器配置、真实凭据或运行数据。过去提交可能仍含历史部署说明；当前文件清理不等于清除 Git 历史。
