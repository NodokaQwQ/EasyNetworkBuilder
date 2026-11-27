# Permissions 镜像发布

两镜像平台目前仅 `linux/amd64`，不代表 arm64 支持。发布不自动部署任何服务器。

## 已推送（2026-11-27）

| 镜像 | OCI index digest |
| --- | --- |
| `nodokaqwq/enb:head-permissions-20261127-1` | `sha256:b0336d37058f25e8a1816f405490c582662d63e2d180b6611622140564360f24` |
| `nodokaqwq/enb:node-permissions-20261127-1` | `sha256:218003521e37d3b7bab117532447cbcd040f9a86fa4a0d6a7387d25c51ecd1bb` |

两个远端 manifest 均已核实 linux/amd64；版本 `0.2.1-enb-permissions.1`。Head 构建标识 `d2c5e8e-permissions.1-dirty`，如实表示包含未提交源码。线上仍维持原版本；未自动部署，也未覆盖 latest。

## 构建

在仓库根目录执行；使用已有 Docker 登录，不把凭据复制进构建上下文。

```sh
docker buildx build --platform linux/amd64 \
  -f deploy/easytier/Node.Dockerfile \
  --build-arg ENB_VERSION=0.2.1-enb-permissions.1 \
  -t nodokaqwq/enb:node-permissions-20261127-1 --load .
python3 deploy/easytier/smoke-images.py node nodokaqwq/enb:node-permissions-20261127-1
docker push nodokaqwq/enb:node-permissions-20261127-1
docker buildx imagetools inspect nodokaqwq/enb:node-permissions-20261127-1
```

本次 Node digest 为 `sha256:218003521e37d3b7bab117532447cbcd040f9a86fa4a0d6a7387d25c51ecd1bb`，已更新 `lite-plus/virtualnet/ssh.go` 的 `NodeImage`；`LegacyNodeImage` 保留旧安装兼容。此变更只影响未来部署和显式权限应用，不自动改动已有 Node。

```sh
docker buildx build --platform linux/amd64 \
  -f deploy/easytier/Dockerfile \
  --build-arg EASYTIER_IMAGE=easytier/easytier@sha256:387f48e84d4ef0896ef4c1d9be03876535a59f0ebdf8251adf581ea39b950f20 \
  --build-arg ENB_VERSION=0.2.1-enb-permissions.1 \
  --build-arg ENB_REVISION=permissions.1 \
  -t nodokaqwq/enb:head-permissions-20261127-1 --load .
python3 deploy/easytier/smoke-images.py head nodokaqwq/enb:head-permissions-20261127-1
docker push nodokaqwq/enb:head-permissions-20261127-1
docker buildx imagetools inspect nodokaqwq/enb:head-permissions-20261127-1
```

Head 使用与既有 core 匹配的 EasyTier CLI 2.6.4。先升级 Head，再通过网页确认升级／应用 Node 权限；新 Agent 的 `remote_permissions` 基础信息字段不保证兼容旧 Head。

## 本次验证

- Node：`linux/amd64`，Go1.27.3，CGO0，`with_quic,with_utls`；本地只读/无网络容器 help、四种合法白名单配置校验及非法白名单拒绝通过。
- Head：`linux/amd64`，Go1.27.3 Alpine musl 静态 CGO；空数据本地容器启动和安装向导门禁、嵌入前端 HTML、匿名管理入口不可用、EasyTier CLI2.6.4、重启次数0通过。安装未完成时 `/ping` 重定向 `/install`，不误判为业务接口已验收。
- Head 全仓测试跳过 `TestMmdb/TestIpApi/TestGeojs/TestIpInfo` 四项外网 GeoIP 后通过；相关包竞态和全仓 vet、前端753测试/build/eslint、Agent cmd/terminal/server及权限专项竞态通过。
- 真实 Compose 配置合并、原环境/挂载保留、单行/多行JSON启动参数防覆盖检查通过。未操作真实远端，未验收登录网页→SSH PTY→Agent重建回报完整闭环。
- 仅按授权清理本机未使用构建缓存；未删镜像、容器或卷，临时 smoke 容器除外。未更新 latest 标签或推送 Git。

## 验证范围

- 前端 753 测试、构建、相关 ESLint。
- Head 全仓测试（显式跳过 `TestMmdb/TestIpApi/TestGeojs/TestIpInfo` 四个外网查询）、相关包竞态测试及全仓 vet。
- Agent cmd、terminal、server 测试，权限相关竞态测试。
- `ENB_PERMISSIONS_COMPOSE_TEST=1 go test ./virtualnet` 验证真实 Compose 参数覆盖及原字段保留，不启动真实业务。
- 本机隔离镜像 smoke；不是线上代理／浏览器 SSH PTY／真实 Node 权限回报闭环验收。

`.dockerignore` 排除本地环境、密钥、日志、数据库及数据目录。空间不足时只在授权范围清理 unused build cache，不删除镜像、容器、卷或远端数据。
