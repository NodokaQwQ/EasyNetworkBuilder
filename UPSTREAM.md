# 上游来源

以下目录自 2026-11-27 起作为普通源码目录，由 ENB 根仓库统一管理，不再是嵌套 Git 仓库或子模块。二次开发改动与 ENB 一起提交。

| 目录 | 原始上游 | 导入基线提交 |
| --- | --- | --- |
| `lite-plus/` | https://github.com/nuomiiiii/Lite-Plus | `fb4fa1d2a8536630ca91abd94854bd7c61082021` |
| `lite-plus-agent/` | https://github.com/nuomiiiii/Lite-Plus-agent | `2e33a53227a15640390a78ef261cfd6b055351c9` |
| `lite-plus-web/` | https://github.com/nuomiiiii/Lite-Plus-web | `d34e60a37544ecdfdfba9dbbf4e897c828585ef2` |

基线不是当前完整源码状态：包含后续 ENB 内核升级与虚拟内网管理等改动。各目录保留原许可证和版权声明，依赖组件仍遵守其各自许可证；统一存储不改变这些义务。

本机转换前的三个 `.git` 目录及状态清单位于根仓库 `.git/nested-repo-backups/20261127-094024/`，不随源码提交或推送。若需长期保留完整上游历史，请另行备份该目录。后续同步上游应显式导入／审阅，不再在这三个目录运行面向上游的 `git push`。
