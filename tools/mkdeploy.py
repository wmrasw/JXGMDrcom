#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 wmrasw
"""Build a deployment tarball for manual testing on the router.

The package is pure shell + JavaScript, so it can be deployed without the
OpenWrt SDK: extract the tarball at "/" and restart rpcd.

Usage:
    python tools/mkdeploy.py

Output:
    dist/luci-app-jxgm-drcom-deploy.tar.gz
"""

import os
import tarfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, "luci-app-jxgm-drcom")
OUT_DIR = os.path.join(ROOT, "dist")
OUT = os.path.join(OUT_DIR, "luci-app-jxgm-drcom-deploy.tar.gz")

# (source relative to the package, target path on the router, mode)
FILES = [
    ("root/etc/config/drcom", "etc/config/drcom", 0o600),
    ("root/etc/init.d/drcom", "etc/init.d/drcom", 0o755),
    ("root/etc/uci-defaults/95-drcom", "etc/uci-defaults/95-drcom", 0o755),
    ("root/usr/share/drcom/drcom.sh", "usr/share/drcom/drcom.sh", 0o755),
    ("root/usr/share/luci/menu.d/luci-app-jxgm-drcom.json",
     "usr/share/luci/menu.d/luci-app-jxgm-drcom.json", 0o644),
    ("root/usr/share/rpcd/acl.d/luci-app-jxgm-drcom.json",
     "usr/share/rpcd/acl.d/luci-app-jxgm-drcom.json", 0o644),
    ("root/usr/lib/lua/luci/i18n/luci-app-jxgm-drcom.en.lmo",
     "usr/lib/lua/luci/i18n/luci-app-jxgm-drcom.en.lmo", 0o644),
    ("htdocs/luci-static/resources/view/drcom/overview.js",
     "www/luci-static/resources/view/drcom/overview.js", 0o644),
    ("htdocs/luci-static/resources/view/drcom/status.js",
     "www/luci-static/resources/view/drcom/status.js", 0o644),
    ("htdocs/luci-static/resources/drcom/common.js",
     "www/luci-static/resources/drcom/common.js", 0o644),
    ("htdocs/luci-static/resources/view/drcom/log.js",
     "www/luci-static/resources/view/drcom/log.js", 0o644),
]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    if os.path.exists(OUT):
        os.unlink(OUT)

    with tarfile.open(OUT, "w:gz", format=tarfile.GNU_FORMAT) as tar:
        for src, dst, mode in FILES:
            path = os.path.join(PKG, src)
            if not os.path.isfile(path):
                raise SystemExit("missing file: %s" % path)

            info = tar.gettarinfo(path, arcname=dst)
            info.mode = mode
            info.uid = info.gid = 0
            info.uname = info.gname = "root"

            with open(path, "rb") as fh:
                tar.addfile(info, fh)

    print("built %s (%d files, %d bytes)"
          % (OUT, len(FILES), os.path.getsize(OUT)))


if __name__ == "__main__":
    main()
