#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 wmrasw
"""Compile gettext .po catalogs into LuCI .lmo archives.

LuCI loads translations from /usr/lib/lua/luci/i18n/*.lmo. The format is
produced by the C tool `po2lmo` (modules/luci-base/src/po2lmo.c) and is:

    <translated strings, each padded to 4 bytes>
    <index: N x (key_id, val_id, offset, length), sorted by key_id>
    <uint32 idx_offset, pointing at the start of the index>

All integers are big-endian. Keys are hashed with the Paul Hsieh "super fast
hash" over a whitespace-normalised msgid, with the hash seeded by the key
length. This module reimplements both sides so the plugin can ship catalogs
without the OpenWrt build system.

Usage:
    python tools/lmo.py input.po output.lmo
"""

import io
import struct
import sys

M32 = 0xFFFFFFFF
SPACE = frozenset(b" \t\n\r\v\f")


def _get16(data, off):
    return data[off] | (data[off + 1] << 8)


def sfh_hash(data, init):
    """Paul Hsieh's hash, as used by LuCI's lmo implementation."""
    h = init & M32
    length = len(data)
    rem = length & 3
    blocks = length >> 2
    off = 0

    for _ in range(blocks):
        h = (h + _get16(data, off)) & M32
        tmp = ((_get16(data, off + 2) << 11) ^ h) & M32
        h = ((h << 16) ^ tmp) & M32
        off += 4
        h = (h + (h >> 11)) & M32

    if rem == 3:
        h = (h + _get16(data, off)) & M32
        h = (h ^ ((h << 16) & M32)) & M32
        c = data[off + 2]
        c = c - 256 if c > 127 else c
        h = (h ^ ((c << 18) & M32)) & M32
        h = (h + (h >> 11)) & M32
    elif rem == 2:
        h = (h + _get16(data, off)) & M32
        h = (h ^ ((h << 11) & M32)) & M32
        h = (h + (h >> 17)) & M32
    elif rem == 1:
        c = data[off]
        c = c - 256 if c > 127 else c
        h = (h + c) & M32
        h = (h ^ ((h << 10) & M32)) & M32
        h = (h + (h >> 1)) & M32

    h = (h ^ ((h << 3) & M32)) & M32
    h = (h + (h >> 5)) & M32
    h = (h ^ ((h << 4) & M32)) & M32
    h = (h + (h >> 17)) & M32
    h = (h ^ ((h << 25) & M32)) & M32
    h = (h + (h >> 6)) & M32

    return h


def _canon(data):
    """Collapse whitespace runs and drop a trailing space, like lmo_canon_hash."""
    out = bytearray()
    prev = 0x20

    for c in data:
        if c in SPACE:
            if prev not in SPACE:
                out.append(0x20)
        else:
            out.append(c)

        prev = c

    if out and out[-1] == 0x20:
        out.pop()

    return bytes(out)


def key_hash(msgid):
    data = _canon(msgid.encode("utf-8"))
    return sfh_hash(data, len(data))


def _unescape(text):
    out = []
    i = 0

    while i < len(text):
        c = text[i]

        if c == "\\" and i + 1 < len(text):
            n = text[i + 1]
            out.append({"n": "\n", "t": "\t", "r": "\r",
                        '"': '"', "\\": "\\"}.get(n, n))
            i += 2
            continue

        out.append(c)
        i += 1

    return "".join(out)


def parse_po(path):
    """Return [(msgid, msgstr)] skipping the header and fuzzy entries."""
    entries = []
    cur = {}
    field = None
    fuzzy = False

    with io.open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()

    def flush():
        if "msgid" in cur and cur.get("msgstr") and not fuzzy:
            entries.append((cur["msgid"], cur["msgstr"]))
        cur.clear()

    for line in lines:
        line = line.rstrip("\r")

        if not line.strip():
            if cur:
                flush()
            field = None
            fuzzy = False
            continue

        if line.startswith("#"):
            if "fuzzy" in line:
                fuzzy = True
            continue

        if line.startswith("msgid "):
            if "msgstr" in cur:
                flush()
            field = "msgid"
            cur["msgid"] = _unescape(line[len("msgid "):].strip().strip('"'))
        elif line.startswith("msgstr "):
            field = "msgstr"
            cur["msgstr"] = _unescape(line[len("msgstr "):].strip().strip('"'))
        elif line.startswith('"'):
            if field:
                cur[field] = cur.get(field, "") + _unescape(line.strip().strip('"'))

    if cur:
        flush()

    return [(k, v) for k, v in entries if k]


def compile_po(po_path, lmo_path):
    pairs = parse_po(po_path)

    body = bytearray()
    index = []

    for msgid, msgstr in pairs:
        key_id = key_hash(msgid)
        val = msgstr.encode("utf-8")
        # po2lmo hashes the raw translation, not the normalised one.
        val_id = sfh_hash(val, len(val))

        if key_id == val_id:
            # po2lmo drops entries whose translation hashes to the msgid.
            continue

        offset = len(body)
        body += val
        body += b"\0" * ((4 - (len(val) % 4)) % 4)
        index.append((key_id, 1, offset, len(val)))

    if not index:
        raise SystemExit("nothing to compile in %s" % po_path)

    index.sort(key=lambda e: e[0])

    out = bytearray(body)
    for entry in index:
        out += struct.pack(">IIII", *entry)
    out += struct.pack(">I", len(body))

    with open(lmo_path, "wb") as fh:
        fh.write(out)

    return len(index)


def main(argv):
    if len(argv) != 3:
        raise SystemExit("usage: %s input.po output.lmo" % argv[0])

    count = compile_po(argv[1], argv[2])
    print("%s -> %s (%d entries)" % (argv[1], argv[2], count))


if __name__ == "__main__":
    main(sys.argv)
