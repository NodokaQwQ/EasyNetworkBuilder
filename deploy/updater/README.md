# ENB Head Docker 更新器（源码首版，未部署）

> 正式版本与动态Git清单维护见 `releases/README.md`，Head/Node均从0.0.1起步；样例配置默认指向仓库master的head-stable.json。严格数字版本不可同版本不同hash覆盖，旧版发布契约示例不表示已发布。

面板手动确认 → 宿主机独立 Python 服务 → 固定 Docker Hub digest → 停机快照 → Compose 重建 → 数据库就绪与版本检查 → 失败回滚。**不是零停机热更新**。不自动更新 Node、nginx、EasyTier、Docker 或其他 Compose 服务。

## 边界与首次接入

- Linux + systemd + Python 3.10+ + Docker Compose v2。需人工首次安装；旧 Head 必须先升级到包含本功能的镜像，不能通过旧 Lite 更新入口引导。
- 配置/程序/Compose/.env/状态目录及其父目录必须由 root 控制，不能组/其他用户可写。现有用户家目录部署不满足时，不自动迁移；安排维护窗口人工迁移并核实原网络、端口、实例密钥和数据。**不要直接按样例覆盖现有部署**。
- 首版只支持单实例 Head，主 SQLite、指标 SQLite、实例密钥及其他持久数据均在 `/app/data` 对应的一个 bind 目录。不能共享该数据目录给其他写入者。拒绝额外可写挂载、Compose build、特权容器、符号链接/特殊文件、外部数据库。操作人须确认无外部写入及此布局，再设置 `local_sqlite_layout_confirmed=true`。
- Head 只挂载更新器 socket 所在目录（只读），**不挂 Docker Socket**。socket 有提交受管 Head 升级的权限，并非无权限接口，不能开放给其他应用或公网。
- 首版发布源为管理员在 root 配置指定的 HTTPS JSON；其控制权属于软件供应链信任边界。只允许 `docker.io/nodokaqwq/enb@sha256:...`、stable、精确匹配平台及来源版本。HTTPS/digest 不等于发布者签名，当前未实现签名验证。
- 更新器进程独立于 Head。持久 journal 在停机前写盘，更新器重启发现中断则尝试恢复旧镜像/数据；恢复失败进入 `rollback_failed` 并拒绝再次更新，需宿主机人工处理。
- 快照含敏感数据，仅保存在宿主机受限目录，网页不返回原始配置/命令输出。**不会自动删除备份、旧镜像、失败数据或卷**，须定期人工管理磁盘。

## 安装（人工核对后执行）

1. 构建并通过隔离验收包含此功能的 Head 镜像，人工接入现有 Compose；确认数据布局和 `/api/version` 的 `enb_update_ready=true`。这是首次引导，不由旧更新器执行。
2. 将 `enb-updater.py` 安装至 `/usr/local/lib/enb-updater/enb-updater.py`，root:root、0755；配置复制至 `/etc/enb-updater/config.json`，root:root、0600。先建立 root 控制的项目目录和 `/var/lib/enb-updater`，逐项修改配置，尤其 Compose 项目名必须与现有项目一致。
3. 配置有效 ENB HTTPS 发布源（下面格式）。示例 feed 故意为空，没有虚构可升级版本。
4. 安装 `enb-updater.service` 至 `/etc/systemd/system/`，执行 `systemctl daemon-reload`、`systemctl enable --now enb-updater`。这些是部署步骤，本次开发不会自动执行。
5. 原 Head Compose 增加以下配置，不改动原端口/网络/启动参数/数据目录；非 root Head 需要配置专用 socket GID、socket 父目录组和 `group_add`，并核实权限。默认样例仅 root Head 可访问。

```yaml
services:
  head:
    environment:
      ENB_UPDATER_SOCKET: /run/enb-updater/control.sock
    volumes:
      - /run/enb-updater:/run/enb-updater:ro
```

6. 挂载**目录**而不是单个 socket，避免更新器重启后旧 socket inode 失效。首次重建 Head 后在面板检查升级能力。更新弹窗要求显式勾选中断/回滚风险。

## 发布契约

构建镜像时，将 `utils.CurrentVersion` 和 `utils.VersionHash` 编入准确值。先推不可变版本标签并核对平台及 digest、验证迁移和回滚，再原子更新 HTTPS 清单；只有稳定版才移动 `head-latest`。Node 发布独立。

```json
{
  "schema": 1,
  "releases": [{
    "version": "0.3.0",
    "hash": "REPLACE_WITH_EXACT_BUILD_HASH",
    "image": "docker.io/nodokaqwq/enb@sha256:REPLACE_WITH_64_LOWERCASE_HEX_DIGEST",
    "platform": "linux/amd64",
    "channel": "stable",
    "rollback": "restore-data-v1",
    "from_versions": ["0.2.1-enb-updater.1"],
    "published_at": "2026-11-27T00:00:00Z",
    "notes": "本版本说明及数据库迁移/兼容性限制"
  }]
}
```

上例含占位符，**不是可用发布记录**。`from_versions` 是显式迁移白名单，不做基于 Lite 版本号的推测。同版本但不同 hash 可以作为已审核修复；不要把降级放进来源白名单。列表按最新优先排序；不同架构分别列出，只发布实际验证过的平台。

拉取以清单固定 digest 为准，不直接将 mutable latest 用于运行。新镜像必须保留本更新协议和 socket 配置，且支持就绪报告；否则更新器会回退。超时检查失败也会回退。

## 事务与恢复

1. 从清单重新核验版本/hash，持久化任务并互斥（同时还有进程级 flock）。
2. 校验 Compose、实际容器、数据挂载、就绪状态、来源版本及备份磁盘空间；拉取 digest 并检查镜像架构，旧 Head 继续运行。
3. 停止且核实 Head 已退出，保存原 Compose 和已有 override，复制整个数据树并同步磁盘。
4. 写 `enb-update.override.json`（仅 Head image），`compose up -d --no-deps --pull never head`，保留原配置。
5. 检查容器运行/健康状态与 `/api/version` 的完整版本/hash、数据库及布局就绪，成功才报告完成。
6. 失败则停止 Head，把失败数据目录改名保留，将快照复制并恢复原目录、权限与 uid/gid，锁定原运行 image ID 后重建并复核。停机备份前失败不换数据。更新器中断后优先回滚，不盲目继续升级。

日后手工管理必须始终带 override：

```sh
docker compose -p enb-head -f /opt/enb/head/compose.yaml -f /opt/enb/head/enb-update.override.json up -d --no-deps head
```

否则原 compose 的旧镜像会被重新使用。不要在更新时运行其他 Compose 操作、镜像 prune 或修改配置。升级健康检查期间新 Head 可能接受写入；回滚恢复停机快照会丢失这些写入，面板明确提示此风险。长连接会断开，需要客户端重连；不保证 Node 业务零影响。

`rollback_failed` 时保留现场，从 `/var/lib/enb-updater/task.json` 核对原 image ID 和任务 ID、备份目录及 `.enb-failed-*`。停止 Head 后人工恢复完整数据与镜像并检查；不要在运行时复制 SQLite，不要直接删除 journal 来绕过失败门槛。恢复确认后将 journal 归档再启动更新器。

## 本地验证

```sh
python3 -m unittest discover -s deploy/updater -p 'test_*.py' -v
```

模拟 Docker 事务测试不等同真实 Docker/线上验收。发布前还需隔离真实 Compose 测试成功、错误镜像、迁移失败、拉取失败、磁盘不足及更新器中断恢复；之后再做真实面板到宿主机维护窗口验收。
