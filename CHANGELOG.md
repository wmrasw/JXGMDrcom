# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，
版本号遵循语义化版本（`MAJOR.MINOR.PATCH`）。

只记录用户可感知的变化：功能、行为、安装方式、兼容性。纯文档措辞、排版、
截图、内部重构不写在这里。

## [1.0.3] - 2026-11-12

### Added

- 「退出登录」按钮与 `drcom.sh logout`：先停止服务，再调用门户的 `/portal/mac/unbind` 下线当前账号，
  方便换号或处理「IP 已在线」
- 「配置错误时继续重试」选项（`ignore_config_error`）

### Changed

- 密码错误、账号不存在、未选运营商等配置错误默认暂停：不再向门户发请求，页面显示「已暂停」，
  保存配置后自动恢复

### Fixed

- 关于按钮在非 bootstrap 主题下被拉成椭圆

## [1.0.2] - 2026-11-12

### Added

- 界面支持英文：随包内置 `po/en` 编译出的 `.lmo`，跟随系统语言自动切换（中文无需额外包）
- 页面右上角新增「关于」按钮，浮窗显示名称、版本、许可证、作者与实测信息

### Changed

- 共享检测被强制下线时，日志与「最近结果」显示剩余秒数，不再混在「登录被拒」里

## [1.0.1] - 2026-11-10

### Added

- 通过 OpenWrt 25.12 官方 SDK 构建 `apk` 包，Release 同时提供 `ipk` 与 `apk`
- `CHANGELOG.md`，发版时自动提取对应版本段落作为 Release 说明

### Changed

- 版本号 `1.0.0` → `1.0.1`
- 提供 Release、feed、源码树、免 SDK 四种安装方式

## [1.0.0] - 2026-11-10

首个正式版本。

### Added

- procd 常驻服务：定时探测外网（HTTP 204），掉线后才登录，支持崩溃重启
- 门户登录参数完整可配：门户地址、账号、密码、运营商后缀、`v` 参数、User-Agent、MAC
- 设备类型选项：自动配对账号前缀与 `terminal_type`（电脑 `,0,` + 1、手机 `,1,` + 2）
- 登录失败处理：重试间隔、连续失败次数、冷静期
- 状态文件 `/var/run/drcom.state`（状态 / 上次登录 / 最近结果）
- 日志 `/var/log/drcom.log`，带大小轮转
- LuCI 页面：运行状态、立即登录 / 重启 / 停止、基本 / 门户 / 高级三页配置
- 日志页：可暂停刷新、清除日志，切到后台自动停止轮询
- 上行 IP、上行端口 MAC 展示；可选修改上行端口 MAC（写入 `/etc/config/network`）
- 连通性检测地址改完自动探测并显示结果
- `drcom.sh` 子命令：`run` / `once` / `login` / `check` / `probe` / `ip` / `mac` / `ua` / `set-mac`
- Apache-2.0 许可，含 `LICENSE`、`NOTICE` 与全部源文件 SPDX 标识

[1.0.3]: https://github.com/wmrasw/JXGMDrcom/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/wmrasw/JXGMDrcom/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/wmrasw/JXGMDrcom/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/wmrasw/JXGMDrcom/releases/tag/v1.0.0
