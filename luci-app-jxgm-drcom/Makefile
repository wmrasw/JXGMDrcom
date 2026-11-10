# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 wmrasw
#
# LuCI support for JXGM DrCOM campus network auto login
#
# Target: Kwrt 25.12-SNAPSHOT (opkg/ipk, LuCI JS).  The same source also builds
# as .apk on trees that enable CONFIG_USE_APK.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for JXGM DrCOM campus network auto login
LUCI_DESCRIPTION:=Configure and supervise the JXGM DrCOM portal auto login service (curl based).
LUCI_DEPENDS:=+luci-base +curl +jsonfilter
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-jxgm-drcom
PKG_VERSION:=1.0.1
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE NOTICE
PKG_MAINTAINER:=wmrasw

# /etc files are NOT automatically treated as conffiles: they must be listed
# here, otherwise an upgrade overwrites the user's credentials.
define Package/luci-app-jxgm-drcom/conffiles
/etc/config/drcom
endef

# Locate luci.mk in whichever feed provides it (OpenWrt, ImmortalWrt, Kwrt and
# forks that do not name the luci feed directory "luci").
LUCI_MK:=$(firstword $(wildcard $(TOPDIR)/feeds/*/luci.mk))

ifneq ($(LUCI_MK),)
include $(LUCI_MK)
else
# Fallback for SDK images or trees without a luci feed: install the payload
# directly instead of failing on a missing luci.mk.
include $(INCLUDE_DIR)/package.mk

define Package/luci-app-jxgm-drcom
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=$(LUCI_TITLE)
  PKGARCH:=$(LUCI_PKGARCH)
  DEPENDS:=$(LUCI_DEPENDS)
  URL:=https://github.com/wmrasw/JXGMDrcom
endef

define Package/luci-app-jxgm-drcom/description
  $(LUCI_DESCRIPTION)
endef

define Package/luci-app-jxgm-drcom/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/init.d $(1)/etc/uci-defaults
	$(INSTALL_CONF) ./root/etc/config/drcom $(1)/etc/config/drcom
	$(INSTALL_BIN) ./root/etc/init.d/drcom $(1)/etc/init.d/drcom
	$(INSTALL_BIN) ./root/etc/uci-defaults/95-drcom $(1)/etc/uci-defaults/95-drcom
	$(INSTALL_DIR) $(1)/usr/share/drcom
	$(INSTALL_BIN) ./root/usr/share/drcom/drcom.sh $(1)/usr/share/drcom/drcom.sh
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-jxgm-drcom.json $(1)/usr/share/luci/menu.d/luci-app-jxgm-drcom.json
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-jxgm-drcom.json $(1)/usr/share/rpcd/acl.d/luci-app-jxgm-drcom.json
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/drcom
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/drcom/overview.js $(1)/www/luci-static/resources/view/drcom/overview.js
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/drcom/log.js $(1)/www/luci-static/resources/view/drcom/log.js
endef

define Package/luci-app-jxgm-drcom/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
rm -rf /tmp/luci-indexcache.* /tmp/luci-modulecache/
chmod 600 /etc/config/drcom 2>/dev/null
/etc/init.d/drcom enable 2>/dev/null
/etc/init.d/rpcd reload 2>/dev/null
exit 0
endef

$(eval $(call BuildPackage,luci-app-jxgm-drcom))
endif

# luci.mk (when present) installs htdocs/ and root/, minifies JS, and refreshes
# the LuCI caches in postinst. No further rule is needed here.
