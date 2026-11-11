#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 wmrasw
"""Build an opkg-installable .ipk without the OpenWrt SDK.

An OpenWrt .ipk is a gzip-compressed tar archive containing three members:

    ./debian-binary      "2.0\n"
    ./control.tar.gz     control, conffiles, postinst
    ./data.tar.gz        the files themselves

This is the same layout ipkg-build produces, so `opkg install` accepts it.

Usage:
    python tools/mkipk.py

Output:
    dist/luci-app-jxgm-drcom_<version>_all.ipk
"""

import io
import os
import re
import tarfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, "luci-app-jxgm-drcom")
OUT_DIR = os.path.join(ROOT, "dist")

# (source relative to the package, path inside the ipk, mode)
FILES = [
    ("root/etc/config/drcom", "etc/config/drcom", 0o600),
    ("root/etc/init.d/drcom", "etc/init.d/drcom", 0o755),
    ("root/etc/uci-defaults/95-drcom", "etc/uci-defaults/95-drcom", 0o755),
    ("root/usr/share/drcom/drcom.sh", "usr/share/drcom/drcom.sh", 0o755),
    ("root/usr/share/luci/menu.d/luci-app-jxgm-drcom.json",
     "usr/share/luci/menu.d/luci-app-jxgm-drcom.json", 0o644),
    ("root/usr/share/rpcd/acl.d/luci-app-jxgm-drcom.json",
     "usr/share/rpcd/acl.d/luci-app-jxgm-drcom.json", 0o644),
    ("htdocs/luci-static/resources/view/drcom/overview.js",
     "www/luci-static/resources/view/drcom/overview.js", 0o644),
    ("root/usr/lib/lua/luci/i18n/luci-app-jxgm-drcom.en.lmo",
     "usr/lib/lua/luci/i18n/luci-app-jxgm-drcom.en.lmo", 0o644),
    ("htdocs/luci-static/resources/view/drcom/log.js",
     "www/luci-static/resources/view/drcom/log.js", 0o644),
]

CONFFILES = ["/etc/config/drcom"]

POSTINST = """#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0

# LuCI caches the menu and the compiled view modules; drop them so the new
# menu entry and ACL show up without a reboot.
rm -rf /tmp/luci-indexcache.* /tmp/luci-modulecache/ /tmp/luci-*.json

chmod 600 /etc/config/drcom 2>/dev/null
/etc/init.d/drcom enable 2>/dev/null
/etc/init.d/rpcd reload 2>/dev/null

exit 0
"""


def read_makefile():
    with io.open(os.path.join(PKG, "Makefile"), encoding="utf-8") as fh:
        text = fh.read()

    def field(name, default=None):
        m = re.search(r"^%s:=\s*(.*)$" % re.escape(name), text, re.M)
        return m.group(1).strip() if m else default

    version = field("PKG_VERSION", "0.0.0")
    release = field("PKG_RELEASE", "1")
    depends = field("LUCI_DEPENDS", "")
    maintainer = field("PKG_MAINTAINER", "unknown")
    title = field("LUCI_TITLE", "LuCI app")
    description = field("LUCI_DESCRIPTION", title)

    deps = [d.lstrip("+") for d in depends.split() if d.startswith("+")]

    return {
        "package": "luci-app-jxgm-drcom",
        "version": "%s-r%s" % (version, release),
        "depends": ", ".join(deps),
        "maintainer": maintainer,
        "title": title,
        "description": description,
    }


def add_bytes(tar, name, data, mode=0o644):
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = mode
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    info.mtime = 0
    tar.addfile(info, io.BytesIO(data))


def make_control(meta, installed_size):
    lines = [
        "Package: %s" % meta["package"],
        "Version: %s" % meta["version"],
        "Depends: %s" % meta["depends"],
        "Section: luci",
        "Category: LuCI",
        "Architecture: all",
        "Installed-Size: %d" % installed_size,
        "Maintainer: %s" % meta["maintainer"],
        "Description: %s" % meta["description"],
    ]
    return ("\n".join(lines) + "\n").encode("utf-8")


def make_control_tar(meta, installed_size):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as tar:
        add_bytes(tar, "./control", make_control(meta, installed_size))
        add_bytes(tar, "./conffiles",
                  ("\n".join(CONFFILES) + "\n").encode("utf-8"))
        add_bytes(tar, "./postinst", POSTINST.encode("utf-8"), 0o755)
    return buf.getvalue()


def data_dirs():
    """All parent directories of the payload, parents before children.

    opkg does not create missing parent directories, so a data tarball with
    bare file entries fails with "wfopen: ... No such file or directory".
    """
    dirs = set()

    for _, dst, _ in FILES:
        parts = dst.split("/")[:-1]
        for i in range(1, len(parts) + 1):
            dirs.add("/".join(parts[:i]))

    return sorted(dirs, key=lambda d: (d.count("/"), d))


def make_data_tar():
    buf = io.BytesIO()
    total = 0

    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as tar:
        for d in data_dirs():
            info = tarfile.TarInfo("./" + d)
            info.type = tarfile.DIRTYPE
            info.mode = 0o755
            info.uid = info.gid = 0
            info.uname = info.gname = "root"
            info.mtime = 0
            tar.addfile(info)

        for src, dst, mode in FILES:
            path = os.path.join(PKG, src)
            if not os.path.isfile(path):
                raise SystemExit("missing file: %s" % path)

            with open(path, "rb") as fh:
                data = fh.read()

            total += len(data)
            add_bytes(tar, "./" + dst, data, mode)

    return buf.getvalue(), total


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    meta = read_makefile()
    data_tar, total = make_data_tar()
    control_tar = make_control_tar(meta, max(1, total // 1024))

    out = os.path.join(
        OUT_DIR,
        "%s_%s_all.ipk" % (meta["package"], meta["version"]))

    if os.path.exists(out):
        os.unlink(out)

    with tarfile.open(out, "w:gz", format=tarfile.GNU_FORMAT) as ipk:
        add_bytes(ipk, "./debian-binary", b"2.0\n")
        add_bytes(ipk, "./control.tar.gz", control_tar)
        add_bytes(ipk, "./data.tar.gz", data_tar)

    print("built %s (%d bytes)" % (out, os.path.getsize(out)))
    print("  package: %s  version: %s" % (meta["package"], meta["version"]))
    print("  depends: %s" % meta["depends"])


if __name__ == "__main__":
    main()
