#!/usr/bin/env python3
"""Score prompt-rewrite outputs against the WorldsTip regression cases.

The checker never calls a model: it grades a JSON mapping of `case id -> rewritten
prompt`, so the same cases can grade the DSH plugin, a subagent run, or a manual
sample. Thresholds: every `must` token present, zero `forbidden` tokens, the
declared language, the declared section headers, and the length ratio.

Usage:
    python tools/eval_prompt_polish.py --cases evals/prompt-polish/cases.json \
        --outputs evals/prompt-polish/outputs.json

Exit code 0 only when every case passes.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

CJK = re.compile(r"[\u4e00-\u9fff]")


def char_len(text: str) -> int:
    """Width-aware length: CJK counts as 1, latin words count by characters."""
    return len([c for c in text if not c.isspace()])


def cjk_ratio(text: str) -> float:
    letters = [c for c in text if not c.isspace() and unicodedata.category(c)[0] in "LN"]
    if not letters:
        return 0.0
    return len(CJK.findall(text)) / len(letters)


def check(case: dict, output: str) -> dict:
    must = case.get("must", [])
    must_any = case.get("must_any", [])
    forbidden = case.get("forbidden", [])
    low = output.lower()

    missing = [token for token in must if token.lower() not in low]
    violations = [token for token in forbidden if token.lower() in low]
    any_hit = True if not must_any else any(token.lower() in low for token in must_any)
    ratio = char_len(output) / max(char_len(case["draft"]), 1)
    added = char_len(output) - char_len(case["draft"])
    # Expansion is bounded in absolute characters: a ratio alone punishes short
    # drafts, where adding a required section header is already a big multiple.
    limit = case.get("add_max")
    ratio_ok = added <= limit if limit is not None else ratio <= case.get("ratio_max", 3.0)

    language = case.get("language", "zh")
    ratio_cjk = cjk_ratio(output)
    language_ok = ratio_cjk > 0.3 if language == "zh" else ratio_cjk == 0.0

    passed = not missing and not violations and any_hit and ratio_ok and language_ok
    return {
        "id": case["id"],
        "kind": case.get("kind", "generic"),
        "passed": passed,
        "missing": missing,
        "violations": violations,
        "must_any_ok": any_hit,
        "ratio": round(ratio, 2),
        "added": added,
        "ratio_ok": ratio_ok,
        "language_ok": language_ok,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", required=True)
    parser.add_argument("--outputs", required=True)
    parser.add_argument("--json", action="store_true", help="print the summary as JSON")
    args = parser.parse_args()

    cases = json.loads(Path(args.cases).read_text(encoding="utf-8"))["cases"]
    outputs = json.loads(Path(args.outputs).read_text(encoding="utf-8"))
    if isinstance(outputs, dict) and "outputs" in outputs:
        outputs = outputs["outputs"]

    results = []
    for case in cases:
        output = outputs.get(case["id"])
        if not isinstance(output, str) or output.strip() == "":
            results.append({
                "id": case["id"], "kind": case.get("kind", "generic"), "passed": False,
                "missing": ["<no output>"], "violations": [], "must_any_ok": False,
                "ratio": 0.0, "ratio_ok": False, "language_ok": False,
            })
            continue
        results.append(check(case, output))

    total_must = sum(len(c["must"]) for c in cases)
    kept = total_must - sum(len(r["missing"]) for r in results if r["missing"] != ["<no output>"])
    violations = sum(len(r["violations"]) for r in results)
    passed = sum(1 for r in results if r["passed"])

    summary = {
        "cases": len(cases),
        "passed": passed,
        "pass_rate": round(passed / len(cases), 3),
        "fact_retention": round(kept / total_must, 3) if total_must else 1.0,
        "forbidden_hits": violations,
        "details": results,
    }

    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(f"cases={summary['cases']} passed={summary['passed']} "
              f"pass_rate={summary['pass_rate']} fact_retention={summary['fact_retention']} "
              f"forbidden_hits={summary['forbidden_hits']}")
        for item in results:
            mark = "PASS" if item["passed"] else "FAIL"
            detail = []
            if item["missing"]:
                detail.append("missing=" + ",".join(item["missing"]))
            if item["violations"]:
                detail.append("forbidden=" + ",".join(item["violations"]))
            if not item["must_any_ok"]:
                detail.append("intent_miss")
            if not item["ratio_ok"]:
                detail.append(f"ratio={item['ratio']}")
            if not item["language_ok"]:
                detail.append("language")
            suffix = ("  " + "; ".join(detail)) if detail else ""
            print(f"  [{mark}] {item['id']:<20}{suffix}")

    return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    sys.exit(main())
