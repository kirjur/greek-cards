#!/usr/bin/env python3
"""Pack notes/*.md and homework/*.md (with a tiny front matter) into data/notes.json and data/homework.json."""
import json
import sys
from pathlib import Path


def parse(path):
	text = path.read_text(encoding="utf-8")
	meta = {}
	if text.startswith("---\n"):
		head, body = text[4:].split("\n---\n", 1)
		for line in head.splitlines():
			k, _, v = line.partition(":")
			meta[k.strip()] = v.strip()
	else:
		body = text
	return {**meta, "id": path.stem, "title": meta.get("title", path.stem), "lesson": meta.get("lesson", ""), "date": meta.get("date", ""), "md": body.strip() + "\n"}


def build(src, out, key):
	items = [parse(p) for p in sorted(src.glob("*.md"))]
	out.write_text(json.dumps({"version": 1, key: items}, ensure_ascii=False, indent=1), encoding="utf-8")
	print(len(items), key)


def main(root, data):
	build(root / "notes", data / "notes.json", "notes")
	build(root / "homework", data / "homework.json", "homework")


if __name__ == "__main__":
	main(Path(sys.argv[1] if len(sys.argv) > 1 else "."), Path(sys.argv[2] if len(sys.argv) > 2 else "../data"))
