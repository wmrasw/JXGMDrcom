# JXGMDrcom

江西工业贸易职业技术学院 **DrCOM 校园网自动登录** 的 OpenWrt / Kwrt LuCI 插件。
认证走 `curl`（eportal 网页认证），纯脚本 + 前端包（`PKGARCH=all`），不编译二进制。

目标环境：**Kwrt 25.12-SNAPSHOT（内核 6.12），opkg / ipk**。

## 目录

```
JXGMDrcom/
├── LICENSE                  # Apache License 2.0 全文
├── NOTICE                   # 版权与商标声明
├── docs/
│   ├── 01-规范调研.md      # 软件包 / LuCI UI / 打包规范调研结论
│   └── 02-设计方案.md      # 认证逻辑、UCI 模型、页面设计
├── tools/mkdeploy.py        # 生成手工部署用的 tar.gz
└── luci-app-jxgm-drcom/     # 可直接放进 OpenWrt/Kwrt 源码树的包目录
    ├── LICENSE
    ├── NOTICE
    ├── Makefile
    ├── htdocs/luci-static/resources/view/drcom/
    │   ├── overview.js      # 状态 + 立即登录 + 启停 + 配置
    │   └── log.js           # 日志（5s 轮询）
    └── root/
        ├── etc/config/drcom           # 默认配置（conffile，600）
        ├── etc/init.d/drcom           # procd 服务
        ├── etc/uci-defaults/95-drcom  # 安装时收紧权限
        ├── usr/share/drcom/drcom.sh   # 登录逻辑
        ├── usr/share/luci/menu.d/luci-app-jxgm-drcom.json
        └── usr/share/rpcd/acl.d/luci-app-jxgm-drcom.json
```

## 功能

- **procd 常驻服务**：定时探测外网（204），掉线才登录；失败按重试间隔重试，连续失败进入冷静期
- **完整可配的门户请求**：门户地址、运营商后缀、设备类型（账号前缀 + `terminal_type` 自动配对）、`v` 参数、User-Agent、真实/占位 MAC
- **状态与日志**：`/var/run/drcom.state`（状态、上次登录、最近结果）+ `/var/log/drcom.log`（自动轮转）
- **LuCI 页面**：运行状态、立即登录/重启/停止、配置三个分页、日志页（可暂停刷新、清除日志）
- **门户诊断**：连通性检测地址改完自动探测并显示结果；上行 IP、上行端口 MAC 直接展示
- **可选改 MAC**：把上行端口的 MAC 写入 `/etc/config/network` 并重载网络（带二次确认）

## 命令

```sh
/usr/share/drcom/drcom.sh run          # 常驻：检测 → 掉线登录 → 间隔再检测
/usr/share/drcom/drcom.sh once         # 检测，离线才登录（已在线直接返回）
/usr/share/drcom/drcom.sh login        # 跳过 204 检测，直接向门户发一次登录请求
/usr/share/drcom/drcom.sh check        # 在线 exit 0，离线 exit 1
/usr/share/drcom/drcom.sh probe <url>  # 打印 URL 的 HTTP 状态码（000=不可达）
/usr/share/drcom/drcom.sh ip           # 打印上行 IPv4 地址
/usr/share/drcom/drcom.sh mac          # 打印上行网卡的真实 MAC
/usr/share/drcom/drcom.sh set-mac <mac>  # 写入 /etc/config/network 并重载网络（会短暂断网）
```

## 安装

### 方式一：下载 Release（推荐）

从 [Releases](https://github.com/wmrasw/JXGMDrcom/releases) 下载对应格式的包：

```sh
# opkg（OpenWrt 24.10 及更早、Kwrt 等仍用 opkg 的固件）
opkg install /tmp/luci-app-jxgm-drcom_1.0.1-r1_all.ipk

# apk（OpenWrt 25.12 及更新版本）
apk add --allow-untrusted /tmp/luci-app-jxgm-drcom-1.0.1-r1.apk

/etc/init.d/drcom enable
/etc/init.d/drcom start
```

装完进 LuCI：**服务 → JXGM DrCOM**，填学号（如 `T202XXXXX`）、密码、运营商，勾「开机自启」，保存并应用。

### 方式二：作为 feed 编进固件

```sh
echo 'src-git jxgmdrcom https://github.com/wmrasw/JXGMDrcom.git' >> feeds.conf.default
./scripts/feeds update jxgmdrcom
./scripts/feeds install -a -p jxgmdrcom
make menuconfig      # LuCI -> Applications -> luci-app-jxgm-drcom
make -j$(nproc)
```

### 方式三：直接放进源码树 / SDK

```sh
./scripts/feeds update -a && ./scripts/feeds install -a
cp -r luci-app-jxgm-drcom package/
make package/luci-app-jxgm-drcom/compile V=s
# 产物：bin/packages/<arch>/luci/luci-app-jxgm-drcom_1.0.1-r1_all.ipk
```

> Makefile 用 `$(TOPDIR)/feeds/*/luci.mk` 搜索 luci feed，Kwrt 这类改了 feed 目录名的树也能编译。
> 同一份源码在开启 `CONFIG_USE_APK` 的树上会自动产出 `.apk`，不需要改。

### 方式四：不用 SDK 直接出 ipk

仓库里的 `tools/mkipk.py` 按 opkg 格式打包，只需要 Python：

```sh
python tools/mkipk.py
# dist/luci-app-jxgm-drcom_1.0.1-r1_all.ipk
```

## 配置项

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | 0 | 开机自启；手动「启动/重启」不受影响 |
| `username` | 空 | 学号，如 `T202XXXXX` |
| `password` | 空 | 密码 |
| `operator` | 空 | `unicom` / `cmcc` / `telecom`，可自定义；**留空则不加 `@` 及后缀** |
| `iface` | `wan` | 上行网卡（设备名，页面里下拉选择） |
| `portal_url` | 学校门户 | eportal 登录地址 |
| `check_url` | miui 204 | 连通性探测地址；修改后页面会自动测一次 |
| `interval` | 300 | 检测间隔（秒） |
| `retry_interval` | 15 | 单次失败后的重试间隔（秒） |
| `max_attempts` | 3 | 连续失败多少次后进入冷静期 |
| `cooldown` | 300 | 冷静期时长（秒） |
| `connect_timeout` | 5 | 请求超时（秒） |
| `use_real_mac` | `0` | 勾选后发送上行接口真实 MAC，否则全 0 |
| `device_type` | `pc` | `pc`=`,0,` + terminal_type 1；`mobile`=`,1,` + 2 |
| `v` | `7911` | 门户请求的 v 参数，固定值即可 |
| `v_random` | `0` | 勾选后每次登录随机生成四位 v |
| `user_agent` | 空 | 留空用 curl 默认 UA（页面提示里显示），填写则覆盖 |
| `log_level` | `info` | error / warn / info / debug |

## 相关项目

- [mchome/dogcom](https://github.com/mchome/dogcom) —— DrCOM 802.1X 协议的 C 实现
- [drcoms/drcom-generic](https://github.com/drcoms/drcom-generic) —— 协议参数与抓包资料
- [sweetcornna/jlu_drcom](https://github.com/sweetcornna/jlu_drcom) —— OpenWrt 上的 DrCOM 服务化打包参考
- [Barabama/RuijieEportal](https://github.com/Barabama/RuijieEportal) —— 锐捷 ePortal 网页认证脚本
- [ken-arch/drcom-](https://github.com/ken-arch/drcom-) —— 简易 DrCOM 自动登录脚本

本项目面向网页认证（ePortal），与上述项目没有代码依赖关系。

## 真机验证

已在 Kwrt 25.12-SNAPSHOT（内核 6.12）上验证：

- 掉线后自动登录（门户返回 `Portal协议认证成功!`）
- 手动「立即登录」「重启」「停止」
- 重启路由器后服务自动恢复
- 配置变更后 procd 自动重启实例

## 已知限制

- 手工部署的文件不在 opkg 数据库里，刷固件后需要重新安装。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

本项目以 [Apache License 2.0](LICENSE) 发布，同时附带 [NOTICE](NOTICE) 文件。

- 这是一个**非官方**插件，与 Dr.COM / ePortal 的厂商、以及任何学校的网络中心均无关联；
- “DrCOM”“ePortal”等名称仅用于说明兼容性，相关商标归其所有者。
