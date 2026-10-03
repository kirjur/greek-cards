#!/usr/bin/env python3
"""Pack notes/*.md (with a tiny front matter) into data/notes.json."""
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
	return {"id": path.stem, "title": meta.get("title", path.stem), "lesson": meta.get("lesson", ""), "date": meta.get("date", ""), "md": body.strip() + "\n"}


def main(src, out):
	notes = [parse(p) for p in sorted(Path(src).glob("*.md"))]
	Path(out).write_text(json.dumps({"version": 1, "notes": notes}, ensure_ascii=False, indent=1), encoding="utf-8")
	print(len(notes), "notes")


if __name__ == "__main__":
	main(sys.argv[1] if len(sys.argv) > 1 else "notes", sys.argv[2] if len(sys.argv) > 2 else "../data/notes.json")
