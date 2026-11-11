#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 wmrasw
"""Check that every UI string has a translation entry.

Extracts `_('...')` / `_("...")` literals from the view scripts and compares
them with the msgids of po/en. Missing translations fail the check; unused
catalog entries are only reported, since they usually linger briefly after
a wording change.

Usage:
    python tools/check-i18n.py
"""

import glob
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from lmo import parse_po  # noqa: E402

ROOT = os.path.dirname(HERE)
VIEWS = os.path.join(ROOT, "luci-app-jxgm-drcom", "htdocs", "luci-static",
                     "resources", "view", "drcom")
PO = os.path.join(ROOT, "luci-app-jxgm-drcom", "po", "en",
                  "luci-app-jxgm-drcom.po")

PATTERN = re.compile(r"""_\(\s*(['"])((?:\\.|(?!\1).)*)\1""")


def sources():
    found = {}

    for path in sorted(glob.glob(os.path.join(VIEWS, "*.js"))):
        text = io.open(path, encoding="utf-8").read()

        for m in PATTERN.finditer(text):
            s = m.group(2).replace("\\'", "'").replace('\\"', '"')
            found.setdefault(s, os.path.basename(path))

    return found


def main():
    using = sources()
    catalog = {k for k, _ in parse_po(PO)}

    # Strings that intentionally have no translation: proper nouns and the
    # trivially translatable ones already present in luci-base.
    ignore = {'JXGM DrCOM', 'User-Agent', 'Apache-2.0', 'wmrasw',
              'luci-app-jxgm-drcom', 'ePortal is cheap, show me the network.'}

    missing = sorted(k for k in using if k not in catalog and k not in ignore)
    unused = sorted(catalog - set(using))

    for s in missing:
        print("MISSING %-8s %s" % (using[s], s))

    for s in unused:
        print("UNUSED           %s" % s)

    print("strings: %d, catalog: %d, missing: %d, unused: %d"
          % (len(using), len(catalog), len(missing), len(unused)))

    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
