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
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE NOTICE
PKG_MAINTAINER:=wmrasw

# /etc files are NOT automatically treated as conffiles: they must be listed
# here, otherwise an upgrade overwrites the user's credentials.
define Package/luci-app-jxgm-drcom/conffiles
/etc/config/drcom
endef

# Locate luci.mk in whichever feed provides it, so the package also builds on
# forks (e.g. Kwrt) that do not name the luci feed directory "luci".
LUCI_MK:=$(firstword $(wildcard $(TOPDIR)/feeds/*/luci.mk))
ifeq ($(LUCI_MK),)
$(error luci feed not found, run "./scripts/feeds update -a && ./scripts/feeds install -a" first)
endif
include $(LUCI_MK)

# luci.mk installs htdocs/ and root/, minifies JS, and refreshes the LuCI
# caches in postinst. No further rule is needed here.
