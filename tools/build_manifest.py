#!/usr/bin/env python3
"""Scan content/*.md and write manifest.json at the repo root.

Title is taken from the first level-1 heading (`# ...`); otherwise the
filename (without extension) is used. Run from the repo root:

    python3 tools/build_manifest.py
"""

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT_DIR = os.path.join(ROOT, "content")
MANIFEST = os.path.join(ROOT, "manifest.json")

H1 = re.compile(r"^\s*#\s+(.+?)\s*$")


def title_for(path: str, fallback: str) -> str:
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                m = H1.match(line)
                if m:
                    return m.group(1)
    except OSError:
        pass
    return fallback


def main():
    files = []
    if os.path.isdir(CONTENT_DIR):
        for name in sorted(os.listdir(CONTENT_DIR)):
            if not name.lower().endswith(".md"):
                continue
            full = os.path.join(CONTENT_DIR, name)
            files.append({
                "name": name,
                "path": f"content/{name}",
                "title": title_for(full, os.path.splitext(name)[0]),
                "size": os.path.getsize(full),
            })

    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump({"files": files}, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"Wrote {MANIFEST} with {len(files)} file(s).")


if __name__ == "__main__":
    main()
