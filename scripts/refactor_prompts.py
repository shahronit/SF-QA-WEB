"""Idempotent refactor of backend/core/prompts/prompts.py for the SF/General split.

Steps performed (each is a no-op if already applied):
1.  Drop the dead duplicate keys (bug_report / smoke / estimation / regression /
    automation_plan + dead test_strategy / test_plan aliases) that originally
    lived between the closing of the testcase prompt and the start of
    copado_script.  Python silently kept only the later copies, so this is dead
    code today.
2.  Rename ``PROMPTS: dict[str, str] = {`` → ``PROMPTS_SF: dict[str, str] = {``.
3.  Strip the ``{_QA_MODE}`` interpolation from the now-SF-only prompt bodies
    (the constant itself is left in place for any external caller that still
    references it).
4.  Insert ``PROMPTS = PROMPTS_SF`` backward-compat alias right before
    ``def format_bug_report_form(``.

Run from repo root:  ``py -3 scripts/refactor_prompts.py``
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = ROOT / "backend" / "core" / "prompts" / "prompts.py"


def main() -> int:
    text = TARGET.read_text(encoding="utf-8")
    original_len = len(text)

    # ------------------------------------------------------------------
    # Step 1 — drop the dead duplicate block (5 keys + 2 dead aliases).
    # We slice from the FIRST occurrence of `"bug_report":` (the dead copy
    # that immediately follows the testcase prompt) up to (but not including)
    # the FIRST occurrence of `"copado_script":` (which is unique and lives
    # right after the dead block).
    # ------------------------------------------------------------------
    bug_marker = '    "bug_report": f"""You are a **Salesforce Certified Expert QA Engineer**'
    copado_marker = '    "copado_script": f"""You are a **Salesforce Certified Expert QA Engineer**'

    if text.count(bug_marker) >= 2:
        first_bug = text.index(bug_marker)
        first_copado = text.index(copado_marker)
        if not (first_bug < first_copado):
            print("ERR: dead bug_report not before live copado_script.", file=sys.stderr)
            return 1
        text = text[:first_bug] + text[first_copado:]
        print(f"  dropped dead duplicate block ({first_copado - first_bug:,} chars)")
    else:
        print("  dead duplicates already removed (skip)")

    # ------------------------------------------------------------------
    # Step 2 — rename PROMPTS dict literal to PROMPTS_SF.
    # ------------------------------------------------------------------
    needle = "PROMPTS: dict[str, str] = {"
    if needle in text:
        text = text.replace(needle, "PROMPTS_SF: dict[str, str] = {", 1)
        print("  renamed PROMPTS -> PROMPTS_SF")
    else:
        print("  rename already applied (skip)")

    # ------------------------------------------------------------------
    # Step 3 — strip ``{_QA_MODE}`` interpolations from prompt f-strings.
    # The pattern is always:
    #     {_SCOPE_ONLY}\n
    #     \n
    #     {_QA_MODE}\n
    #     \n
    #     {_INFER_BLANKS}
    # We collapse to:
    #     {_SCOPE_ONLY}\n
    #     \n
    #     {_INFER_BLANKS}
    # ------------------------------------------------------------------
    pattern = re.compile(r"\n\{_QA_MODE\}\n\n", flags=re.MULTILINE)
    text, n_strip = pattern.subn("\n", text)
    if n_strip:
        print(f"  stripped {{_QA_MODE}} from {n_strip} prompt bodies")
    else:
        print("  {_QA_MODE} already stripped (skip)")

    # ------------------------------------------------------------------
    # Step 4 — insert PROMPTS = PROMPTS_SF alias (idempotent).
    # ------------------------------------------------------------------
    if "\nPROMPTS = PROMPTS_SF\n" not in text:
        closing_marker = "}\n\n\ndef format_bug_report_form("
        insertion = (
            "}\n\n"
            "# Backward-compat alias — older callers (project_manager, custom-prompt API,\n"
            "# legacy imports) still do ``from core.prompts.prompts import PROMPTS``.\n"
            "PROMPTS = PROMPTS_SF\n\n"
            "\n"
            "def format_bug_report_form("
        )
        if closing_marker not in text:
            print("ERR: could not find dict-closing marker before format_bug_report_form().", file=sys.stderr)
            return 1
        text = text.replace(closing_marker, insertion, 1)
        print("  inserted PROMPTS = PROMPTS_SF alias")
    else:
        print("  PROMPTS alias already present (skip)")

    if len(text) == original_len:
        print(f"OK: no changes applied ({len(text):,} chars)")
    else:
        TARGET.write_text(text, encoding="utf-8")
        print(f"OK: rewrote {TARGET} ({original_len:,} -> {len(text):,} chars)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
