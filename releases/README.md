# ENB 版本目录

Head、Node 的 ENB 正式版本分别从 **0.0.1** 起步。旧 Lite/ENB 测试镜像仍保留真实旧版本，不改标签、不冒充0.0.1。

## 文件与发现

- 最新 Head 为 `0.0.2`，允许来源 `0.0.1`；更新与失败回滚已在隔离 Compose 验证，限制见 [0.0.2.md](0.0.2.md)。仅发布，不自动安装宿主机 updater 或更新线上。Node 仍为 `0.0.1`。

- `versions.json`：下一次构建的 Head/Node 版本，各自递增。
- `head-stable.json` / `node-stable.json`：已发布、已验证镜像目录，最新版本优先。
- 默认 HTTPS：`https://raw.githubusercontent.com/NodokaQwQ/EasyNetworkBuilder/master/releases/<head|node>-stable.json`。
- Head/Node `0.0.1` 镜像已发布，真实远端 digest 见 stable 清单，验收范围见 [0.0.1.md](0.0.1.md)。Head 仍为首次安装基线，同版本更新被拒绝；Node 已开放受管 `0.2.1-enb-permissions.1 → 0.0.1`（仅 `~/enb/node`），不支持旧 `~/enb-test` 直接覆盖。不自动升级线上。
- 部署必须先人工接入包含本协议的 Head/宿主机更新器。旧二进制不会因为 Git 新增文件而自动获得升级能力。
- Head 页面初始化、打开更新弹窗、每30～35分钟检查，支持“立即检查”；Node升级页轮询任务并使用后端30分钟目录缓存，可手动强制检查。未打开面板时没有前端定时检查，不进行无人值守自动升级。
- Head 与 Node 都动态读取 Git 清单，后续发布 Node 不必重发 Head。失败显示检查错误，不能当作“已是最新”；提交升级时重新取清单，冻结核验后的 digest，网络失效不阻止回滚。
- Head 的发现由后端HTTPS查询；实际执行由宿主机更新器独立读取自己的 `release_url` 再核验。两者必须指向相同受信目录。可用 `ENB_HEAD_RELEASE_URL`、`ENB_NODE_RELEASE_URL` 覆盖后端地址（只允许HTTPS），变更前核对 updater 配置。
- 仓库必须允许部署机器读取原始文件。私有仓库、404、限流或代理故障会显示检查失败；不要把访问Token放进URL/Compose/发布清单。

## 发布步骤（显式操作，不自动部署）

1. 开发、测试、审阅并提交源代码；修改 `versions.json`，第一次均为0.0.1，后续组件独立递增，例如0.0.2。已发布版本/digest不可覆盖。源码默认值也应与正在开发的版本同步，正式镜像通过构建参数强制写入版本。
2. `python3 scripts/release.py validate` 检查目录。GitHub Actions 在清单/脚本变动时执行同一检查，不保存Docker凭据、不自动推送。
3. 构建对应镜像，默认要求干净Git，hash为完整提交ID：

```sh
python3 scripts/release.py build head
python3 scripts/release.py build node
```

输出 `docker.io/nodokaqwq/enb:head-v0.0.1` / `node-v0.0.1`。仅linux/amd64；Head包含固定EasyTier CLI。不要把新镜像digest反填成旧镜像版本。测试脏构建必须显式 `--allow-dirty --hash <带dirty的构建标识>`，不应用作正式发布。

4. 运行隔离启动、版本、权限、代理配置、升级迁移和回滚验收。核对Head兼容、所有允许来源版本；不只是help成功。参照 `deploy/easytier/smoke-images.py` 和 `deploy/updater/` 文档。**发版脚本不代替验收。**
5. 单独显式推送版本镜像并取得远端digest：

```sh
python3 scripts/release.py push head
python3 scripts/release.py push node
```

6. 准备说明文件，验收通过后生成记录（以下占位符必须替换；重复 `--from-version` 列出每个实际验收来源）：

```sh
python3 scripts/release.py record head --hash COMMIT_ID --digest sha256:64_HEX_DIGEST \
  --from-version OLD_VER --notes /path/to/head-notes.md --verified
python3 scripts/release.py record node --hash COMMIT_ID --digest sha256:64_HEX_DIGEST \
  --from-version OLD_NODE_VER --min-head 0.0.1 --notes /path/to/node-notes.md --verified
```

脚本核对远端不可变版本tag的manifest digest，不能覆盖旧清单版本。`--verified`是操作人的验收声明，不是自动完成业务测试。尚无发布来源时先人工首次部署0.0.1；清单只列审核过的升级路径，不能用通配符。

7. 审阅生成diff，再提交并推送 `releases/` 到master；这是“让已部署实例发现新版”的发布动作。脚本不会自动Git提交/推送。等GitHub原始文件更新后，面板立即检查或等待周期检查。
8. 可选在稳定验收后人工移动 `head-latest` / `node-latest`。实际升级从清单固定digest读取，不依赖latest；本脚本故意不自动移动latest。

## 清单契约

`schema=1`、`component=head|node`。每条记录包括 `version`（严格x.y.z）、`hash`（精确构建标识）、`image`（`docker.io/nodokaqwq/enb@sha256:...`）、`platform`（目前仅linux/amd64）、`channel=stable`、`from_versions`、`published_at`、`notes`、`rollback`。Node另需 `min_head`。

- Head回滚为 `restore-data-v1`；Node为 `restore-nodemgt-v1`。
- 新ENB数字版本只允许升级，不同hash不能覆盖相同版本；修复必须递增版本号。
- 旧 `0.2.1-enb-*` 到0.0.1是一次显式版本体系迁移，必须逐项在 `from_versions` 列出旧标识；不能仅按数值大小判断。不接受普通数字0.2.1降级至0.0.1。
- Node必须满足 `min_head`；未知旧Head版本不自动认为兼容。
- Git清单控制权属于软件供应链信任边界。HTTPS/digest防传输与镜像漂移，但**尚无签名校验**。保护master与清单审阅权限，禁止把未审核镜像写入目录。
- 不删除旧镜像/快照来“维护版本树”。撤回坏版本可经审阅从可发现清单移除，保留Git历史与镜像供恢复；已启动事务使用冻结的release信息，不因目录撤回而失去回滚能力。
