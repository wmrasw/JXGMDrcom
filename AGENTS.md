# AGENTS.md

面向 AI coding agent 的项目说明。人类读者请看 [README.md](README.md)。

## 项目是什么

江西工业贸易职业技术学院 Dr.COM（城市热点）**ePortal 网页认证**的 OpenWrt LuCI 自动登录插件。
纯 shell + 前端 JS，不编译二进制；登录走 `curl`，常驻服务由 procd 托管。

目标固件：OpenWrt 24.10 及更早 / ImmortalWrt / Kwrt（opkg），OpenWrt 25.12+（apk）。
包本身 `arch=all`，与 CPU 无关。

## 目录结构

```
luci-app-jxgm-drcom/            包本体（可直接放进 OpenWrt 源码树）
├── Makefile                    标准 luci.mk；缺 luci.mk 时退回内置安装规则
├── po/en/*.po                  英文翻译源（msgid 是中文）
├── htdocs/luci-static/resources/
│   ├── drcom/common.js         页头、关于浮窗、PKG_VERSION（共享模块）
│   └── view/drcom/
│       ├── status.js           状态页（卡片 + 状态页设置）
│       ├── overview.js         设置页（状态、服务控制、配置）
│       └── log.js              日志页
└── root/
    ├── etc/config/drcom        UCI 默认值（conffile，600）
    ├── etc/init.d/drcom        procd 服务
    ├── etc/uci-defaults/95-drcom
    ├── usr/share/drcom/drcom.sh    全部认证逻辑
    ├── usr/share/luci/menu.d/*.json
    ├── usr/share/rpcd/acl.d/*.json
    └── usr/lib/lua/luci/i18n/*.lmo 由 po 编译，随包分发
tools/
├── mkipk.py       不依赖 SDK 生成 ipk
├── mkdeploy.py    生成手工部署 tar.gz
├── lmo.py         .po → LuCI .lmo 编译器（po2lmo 的 Python 实现）
├── build-i18n.py  重新生成 root 下的 .lmo
└── check-i18n.py  校验每条 UI 文案都有翻译
```

## 常用命令

```sh
python tools/mkipk.py        # dist/luci-app-jxgm-drcom_<ver>-r1_all.ipk
python tools/mkdeploy.py     # dist/luci-app-jxgm-drcom-deploy.tar.gz
python tools/build-i18n.py   # 改完 po 后必须执行，产物要一起提交
python tools/check-i18n.py   # CI 会跑，missing > 0 直接失败
```

OpenWrt 源码树内：

```sh
cp -r luci-app-jxgm-drcom package/
make package/luci-app-jxgm-drcom/compile V=s
```

## 版本与发布

版本号有**两处**，必须一致，CI 会校验：

- `luci-app-jxgm-drcom/Makefile` → `PKG_VERSION:=x.y.z`
- `htdocs/luci-static/resources/drcom/common.js` → `var PKG_VERSION = 'x.y.z';`

发布流程：

1. 改代码 + 在 `CHANGELOG.md` 顶部加 `## [x.y.z] - YYYY-MM-DD`（只写用户可感知的变化：功能、行为、安装方式、兼容性；纯文档/重构不写）；
2. 同步两处版本号；
3. 提交，打标签：`git tag -f -a vX.Y.Z -m "..."`，推 `main` 和标签；
4. GitHub Actions：`main` 只构建 ipk（点亮徽章），标签跑 ipk + apk + Release；
   Release 正文自动取 CHANGELOG 对应段落，附件只包含本包（依赖包会被过滤）。

## 文案与 i18n

- UI 文案用 `_('中文')`，**msgid 就是中文**；英文放 `po/en/luci-app-jxgm-drcom.po`；
- 新增/修改文案后：改 po → `python tools/build-i18n.py` → `python tools/check-i18n.py`；
- 日志（`drcom.sh` 里的 `log info/warn/error`）统一英文，**不翻译**；
- 门户返回的状态文案（如 `密码错误`）原样展示，不翻译。

## 代码约定

**Shell（drcom.sh）**

- POSIX sh / busybox ash：不用 bashism、不用数组、`local` 可用；
- 函数定义在最后的 `case "$1"` 分发之前；
- 会被前端解析输出的子命令（`discover` / `session` / `ip` / `mac` / `probe`）**stdout 必须干净**：
  用 `logq`（只写文件）而不是 `log`（同时打 stdout）；
- 读 UCI 一律 `config_get` + 默认值，老配置里没有新选项时要能跑。

**LuCI JS**

- `'use strict';` + 逐条 `'require …';`，风格跟 LuCI 官方一致（tab 缩进、`E()` 建节点、`form.Map`/`section.option`）；
- 共享模块必须 `return baseclass.extend({...})`——LuCI 会 `new` 它，返回普通对象会报
  `factory yields invalid constructor`；
- 自定义样式全部 scope 在 `.drcom-*` 类下，通过 `<style>` 注入，不改主题文件；
- 标题统一走 `common.title()` / `common.header()`（含 `vt-repeat` 主题兼容）；
- 轮询用 `setTimeout` 自循环并在每轮重读间隔，避免保存后不生效。

## 踩过的坑（改代码前务必看）

1. **procd 的 `respawn` 不是「崩溃才重启」**：进程正常退出也会被拉起（日志里 5 秒一次）。
   所以「配置错误就停服务」不能靠 `exit 0`，现在是**暂停**：写 `status=config-error`，
   `wait_config_change` 循环等 `/etc/config/drcom` 变化，页面显示「已暂停」。
   勾选 `ignore_config_error` 时退回普通重试。
2. **手工部署不要解 `etc/config/drcom`**：那是空模板，会覆盖用户账号密码。
3. **改了 menu.d 要清缓存**：`rm -rf /tmp/luci-indexcache.* /tmp/luci-modulecache/ && /etc/init.d/rpcd reload`；
   只改 JS/CSS 则强刷即可。
4. **门户状态页（:9002）的流量是按计费周期汇总的**，不是实时值，UI 已标注「可能滞后」；
   `sec` 才是实时的。单位：`sec` 秒，`uf/df` KB。
5. **门户地址探测只在未登录时有效**：登录后没有 302 拦截，探测必然失败。
   探测顺序：从跳转页取 `v4serip`/`ss6` → 逐端口探测 `801, 80, 8080, 8081, 8000, 8090`。
6. **退出登录用 `/portal/mac/unbind`**，账号是**不带** `,0,` 前缀的裸账号，`wlan_user_ip` 是十进制 IP；
   已下线时门户返回「在线信息数据为空」，按成功处理。
7. **登录成功判定**：`result=1`，或 msg 含「在线」；失败时若响应不是 JSON 会打
   `unexpected portal response` 提示。
8. **默认 MAC 是全 0**（`use_real_mac=0`），这也是 unbind 时用的 MAC。

## 验证方式

本机没有浏览器和路由器，能做的检查：

```sh
node --check luci-app-jxgm-drcom/htdocs/luci-static/resources/drcom/common.js
node --check luci-app-jxgm-drcom/htdocs/luci-static/resources/view/drcom/*.js
sh -n luci-app-jxgm-drcom/root/usr/share/drcom/drcom.sh
python -c "import json;json.load(open('luci-app-jxgm-drcom/root/usr/share/luci/menu.d/luci-app-jxgm-drcom.json'))"
python tools/check-i18n.py
python tools/mkipk.py && python tools/mkdeploy.py
```

路由器上验证（需人工）：

```sh
/usr/share/drcom/drcom.sh check; echo $?    # 0 在线 / 1 离线
/usr/share/drcom/drcom.sh session            # sec uf df
/usr/share/drcom/drcom.sh discover           # 未登录时才有输出
ubus call service list '{"name":"drcom"}'
tail -20 /var/log/drcom.log
```

## 安全与数据

- 仓库里的 `etc/config/drcom` 是空模板，**不要提交真实账号密码**；
- `logout` / `discover` 都会让当前设备掉线，测试前确认可以接受；
- 只对学校门户主机做探测，不要扫描网段。

## 许可

- 代码（包目录、`tools/`、`.github/`）：Apache-2.0，新文件要加 SPDX 头；
- 文档与截图：CC BY 4.0；
- 两份全文在 `LICENSES/`。

## 不要做

- 不要提交 `dist/`（已 gitignore）；
- 不要给日志文案做翻译；
- 不要引入多 WAN / 多账号 / 旧 `ACSetting` 接口——没有测试条件，等有真实需求再加；
- 不要为了让页面更好看而改 LuCI 主题文件或全局样式。
