"""Replay captured public model reports through the deterministic listening-decision policy.

No model requests, settings, re-generation, audio re-analysis or private recordings.
"""

import argparse
import hashlib
import json
from pathlib import Path

from app.coaching import INTENT_POLICY_VERSION, listening_intent_policy

ROOT = Path(__file__).resolve().parent
CAPTURES = [
    "live-human-keep-v3-2026-11-15.json",
    "live-human-split-v3-2026-11-15.json",
    "live-human-undecided-v3-2026-11-15.json",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = {
        "schema_version": "intent-policy-replay-v1",
        "policy_version": INTENT_POLICY_VERSION,
        "api_calls": 0,
        "scope": "user_action_policy_only_not_auditory_validation",
        "cases": [],
    }
    for filename in CAPTURES:
        path = ROOT / "docs/improvements/evaluations" / filename
        raw = json.loads(path.read_text())
        result["cases"].append(
            {
                "source_artifact": filename,
                "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "source_prompt_version": raw["prompt_version"],
                "intent": raw["practice_intent"],
                "effective_report": listening_intent_policy(raw["report"], raw["practice_intent"]),
            }
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"cases": len(result["cases"]), "api_calls": 0, "artifact": str(args.output)}))


if __name__ == "__main__":
    main()
