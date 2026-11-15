"""Verify the tiny public CMU ARCTIC probe corpus; download only with --download.

No application settings, private recordings or model-provider calls are used.
Original recordings remain in the git-ignored models/evaluation-corpus directory.
"""

import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "docs/improvements/evaluations/human-corpus-v1.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    corpus = json.loads(MANIFEST.read_text())
    cache = ROOT / "models/evaluation-corpus"
    fetched = 0
    for source in corpus["files"]:
        destination = cache / source["relative_path"]
        if not destination.exists():
            if not args.download:
                raise RuntimeError("Missing public corpus file; pass --download explicitly")
            with urllib.request.urlopen(source["url"], timeout=20) as response:
                data = response.read(source["bytes"] + 1)
            if len(data) != source["bytes"] or hashlib.sha256(data).hexdigest() != source["sha256"]:
                raise RuntimeError("Downloaded corpus file does not match the pinned source")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            fetched += 1
        if hashlib.sha256(destination.read_bytes()).hexdigest() != source["sha256"]:
            raise RuntimeError("Cached corpus file differs; refusing to overwrite it")
    print(
        json.dumps({"files_verified": len(corpus["files"]), "files_downloaded": fetched, "provider_calls": 0})
    )


if __name__ == "__main__":
    main()
