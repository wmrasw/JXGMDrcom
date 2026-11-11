#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 wmrasw
"""Compile po/<lang>/*.po into the package tree.

LuCI looks up translations in /usr/lib/lua/luci/i18n/<name>.<lang>.lmo and
falls back to the msgid when no catalog is installed. The source strings are
Chinese, so Chinese works out of the box and English comes from po/en.

The generated .lmo files live under root/ so that every packaging path
(luci.mk, tools/mkipk.py, tools/mkdeploy.py) ships them.

Usage:
    python tools/build-i18n.py
"""

import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from lmo import compile_po  # noqa: E402

ROOT = os.path.dirname(HERE)
PKG = os.path.join(ROOT, "luci-app-jxgm-drcom")
I18N = os.path.join(PKG, "root", "usr", "lib", "lua", "luci", "i18n")
NAME = "luci-app-jxgm-drcom"


def main():
    sources = sorted(glob.glob(os.path.join(PKG, "po", "*", "*.po")))

    if not sources:
        raise SystemExit("no po files found")

    os.makedirs(I18N, exist_ok=True)

    for po in sources:
        lang = os.path.basename(os.path.dirname(po))
        out = os.path.join(I18N, "%s.%s.lmo" % (NAME, lang))
        count = compile_po(po, out)
        print("%s -> %s (%d entries)" % (po, out, count))


if __name__ == "__main__":
    main()
