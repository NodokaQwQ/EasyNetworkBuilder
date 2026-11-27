# ENB Node 升级（源码首版，未上线）

> 发布目录已改为动态读取 Git `releases/node-stable.json`，不再使用内置版本列表。Head/Node 新版本体系均从0.0.1开始，正式发版和兼容白名单以 `releases/README.md` 为准；下文内置目录描述为首版历史，已被取代。当前目录为空，不将旧permissions.1镜像冒充0.0.1。

入口：**虚拟内网 → 设备“升级 Node” → 二次认证 → Node 版本升级**；也可从“权限与宿主机管理”的新页签进入。

## 支持范围

- 只支持既有 SSH 凭据、固定主机指纹、受管 `~/enb/node`、`enb-managed-node` 单 node 服务、Linux amd64；Node 必须在线且未暂停，已保存“受管 Node Docker”权限，并启用站点远程管理。API Key 和未二次认证请求拒绝。
- **不接管旧 `~/enb-test`、自定义 Compose、其他项目，也不执行强制覆盖。** 不支持额外可写挂载；唯一可写 bind 必须是当前安装目录的 `nodemgt` → `/app/nodemgt`，不允许符号链接/特殊文件。
- 目标列表动态读取 Git `releases/node-stable.json`，检查来源版本白名单、平台、最低Head版本；提交时重新取清单。后续Node发布只需审核并推送清单，不需要重发Head。不接受任意digest、mutable node-latest或上游二进制自更新。
- ENB数字版本仅允许递增，拒绝同版本重发和降级；旧测试版本需显式列为来源。扩展发布版本前必须审核快照迁移、旧版本恢复以及Head兼容。

## 行为

1. 目标 digest 绑定风险勾选；用户确认断线、数据快照回滚后提交非重放 HTTP 请求，返回持久化任务和轮换授权。
2. 后台 SSH 任务复用既有 sudo 配置和 pinned host key，校验项目/架构/挂载，先 pull 及帮助参数检查、空间检查，不先停旧 Node。
3. 保存原 Compose/.env/permissions/版本 override，写事务标记并同步；停止 Node，保存整个 `nodemgt` 的停机快照，保留权限/所有权。
4. 新增 image-only `node-version.yaml`，**不改变启动命令、权限、网络、端口、Token 和环境**。仅 `up --no-deps --force-recreate --pull never node`，不 down、不删除其他部署。
5. 必须新 Agent 连接、新基本信息上报、目标版本、原远控开关与原权限完全一致；经 SSH 核对运行 image ID 后提交成功。只确认控制面/版本/权限，不保证所有代理入站或出口业务验收。
6. 失败尝试停止新 Node，保留 `failed-nodemgt`，复制停机快照恢复旧本地 image ID，等待旧 Agent 新回连并核对权限；完成才解除远端事务标记。备份不自动删除。

面板每 5 秒读取持久任务状态，刷新页面可重新看到任务。未完成事务及 `rollback_failed` 阻止重复升级；远端 `.enb-update-active` 阻止受管部署/权限/生命周期操作。重启 Head 不会丢失持久任务，但首版**不会自动恢复被 Head 重启打断的 SSH 升级**，需要宿主机检查；不要并行升级 Head 与 Node。

今后受管恢复及 Docker 操作包含 `node-version.yaml`，防止恢复时重新运行旧版本。权限应用显式选择镜像时同步该 override，防止旧覆盖文件把目标镜像盖回去。

## 风险及人工恢复

- 代理内核重启，现有连接断开；不是零停机更新。恢复停机快照会丢失升级期间本地新增数据；Head 上的统计/配置不是该本地快照的一部分，不承诺流量统计恰好一次。
- 维护期间不能外部修改 Compose、权限或数据，不能启动其他写入者。全局部署锁和远端 flock 只协调 ENB 管理操作，不阻止外部 root 手动操作。
- Head/SSH 崩溃或写盘失败时保留现场，不盲目继续升级。任务状态 `node_update_manual_recovery` / `rollback_failed` 或持续 running 时，在 SSH 登录用户的 `~/enb/node` 检查 `.enb-update-active` 与 `.enb-update-<任务ID>`。
- 需人工停容器、确认完全停止后恢复快照，切回 `old-image.yaml` 的镜像；保留失败数据。所有 Compose 操作显式包含已有 `permissions.yaml` 和 `node-version.yaml`。不要在容器运行时复制快照，不要为了重试直接删除 marker/job。核验旧 Agent/代理恢复后归档事务并修正任务状态。
- 原始配置可能含 Token，备份目录 0700/文件受 umask077 保护，不通过网页输出或审计保存；不要分享完整备份/日志。

## 验收边界

本地模拟 shell/Docker 测试覆盖保留配置、pull失败不重建、非法挂载/符号链接/活动事务拒绝、快照和失败数据保留、回滚及 marker 清理。发布前仍需隔离真实 Compose 与真实 SSH→面板 Agent 回连闭环验收；本轮不发布镜像或更新线上 Node。
