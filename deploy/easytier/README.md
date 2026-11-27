# EasyTier 只读发现 / SSH 部署（首版）

这是待集成验证的源码功能，不是线上已发布镜像。不会修改已有 EasyTier 配置。

## 接口与权限

- 页面 `/admin/virtualnet`；RPC `admin:virtualnet.*` 仅管理员登录会话可调用，拒绝 API Key。
- Head 内安装与 core 匹配的 `easytier-cli`，固定执行 `-p <portal> -o json -v [--instance-name <name>] route`。
- `ENB_EASYTIER_RPC`：部署时指定 RPC 地址；`ENB_EASYTIER_CLI`：CLI 路径；`ENB_EASYTIER_INSTANCE`：可选实例名。首版要求选择单一实例。
- 支持当前 verbose JSON 的 `node_info` / `peer_routes` 格式。仅输出白名单字段，绝不透传 `node_info.config`、网络密钥或原始错误输出。未知版本明确报错，不猜测文本表格。
- `ENB_NODE_CONTROL_URL`：通过虚拟网络可达的 HTTPS 主控地址。需要有效证书和虚拟网络 DNS／地址解析，不能仅填写无证书的内网 IP。
- SSH 目标必须是本次发现的远端虚拟 IPv4/IPv6，排除本机；子网代理公告不是部署目标。主机指纹需要独立核实，探测指纹不会自动信任。
- SSH 密码、私钥、口令与 sudo 密码通过现有实例密钥加密入库，不返回浏览器；必须一并保护数据库和 `lite-instance.key`，备份同样视为敏感信息。

## Compose 与 RPC 的边界

`compose.override.example.yaml` 示意在**同一个 Compose 项目**中让 Head 使用现有 EasyTier 服务网络命名空间。CLI 在 Head 内运行，通过 loopback RPC 查询，而不是 `docker exec`；不需要 Docker Socket、Docker 管理权限或网络密钥。示例中的服务名需要按实际修改。

共享网络命名空间时，端口发布属于 EasyTier 服务；Head 不能再写 `ports`/`networks`。现有 EasyTier 若使用 host 网络，不应直接照抄：可评估 Head host 网络并严格限定监听，或单独受限 RPC 地址与 Docker 到虚拟网的路由；变更前确认端口与防火墙，不能开放公网 RPC。不能仅用普通 Compose bridge 就假定 Head 能访问另一容器里的 TUN。

RPC 通常不提供应用级只读权限。ENB 固定查询命令只是应用约束，不能把有权访问 RPC 的 Head 进程视为无权修改 core。更强隔离需以后增加只读查询代理。首版不暴露任意 CLI 执行接口。

构建示例要求 `EASYTIER_IMAGE` 固定为与 core 匹配的 digest，并核对镜像内 CLI 路径及 Alpine 兼容性。先构建前端并复制其 dist 到 `lite-plus/web/public/systemUI/dist`，再在根目录运行 Compose 构建。本仓库保留嵌套源码仓库，不会自动同步前端产物。

## 部署行为与局限

1. 发现 → 配置 SSH / 指纹 → 测试 → 用户确认部署。
2. 仅 Linux amd64、已安装且有权限访问 Docker Compose 的机器。不会安装 Docker，不获取任意 shell 输出。
3. 后台任务创建独立面板节点及凭据，在 `/opt/enb/node` **新建**目录，通过 SSH stdin 写入权限受限 Compose，使用固定 Node digest、关闭自更新并持久化 `/app/nodemgt`。
4. 检测常见已有 Agent 容器且拒绝覆盖现有目录；不自动迁移代理、不启动入站、不停旧服务、不修改防火墙。
5. 最多单任务执行，等待 Agent 真正上线才标记成功。失败或 Head 重启保留现场和面板关联，不自动重复安装。人工确认／清理后才重新接入，避免产生重复 Node。
6. 删除凭据仅移除主控 SSH 配置，不卸载远程服务。远程 `/opt/enb/node/compose.yaml` 含 Node Token，需保护。
7. 现有 HK/MY 不应用此自动安装测试替换：它们已有手动部署及运行中代理。

上线前还需隔离 SSH/Compose 端到端测试、浏览器验收及实际容器网络测试。本轮没有更改线上 EasyTier 或更新线上 Head。
