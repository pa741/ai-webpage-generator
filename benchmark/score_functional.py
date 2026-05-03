"""
Scores generated pages for functional completeness using an LLM.

For each task directory that has page.html and metadata.json (containing
ui_instruct), this script sends the HTML + each ui_instruct task to an LLM
and asks it to judge whether the static HTML satisfies the requirement.

Verdicts:
  YES     — the HTML clearly satisfies the task
  PARTIAL — the HTML partially satisfies the task
  NO      — the HTML does not satisfy the task
  NA      — the task requires live browser interaction and cannot be evaluated
             from static HTML (e.g. form submission, dynamic data fetch)

Usage:
  python score_functional.py \\
    --tasks /path/to/WebGen-Bench/data/test.jsonl \\
    --out results/ [--model claude-haiku-4-5] [--workers 4]
"""

import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from tqdm import tqdm

FUNCTIONAL_SYSTEM = """\
You are evaluating a generated webpage by reading its static HTML source.
For each test task you are given, decide whether the HTML satisfies the requirement.

Respond with a JSON object for each task:
{
  "verdict": "YES" | "PARTIAL" | "NO" | "NA",
  "reasoning": "<one sentence>"
}

Use NA when the task can only be verified by interacting with a live, running
application (e.g. submitting a form, receiving real API data, watching a dynamic
chart update, drag-and-drop reordering). Static HTML cannot demonstrate these.

Use YES, PARTIAL, or NO for tasks that are checkable from HTML alone:
- structural presence (does a navigation bar exist?)
- visual/design intent (is a colour scheme referenced in class names or styles?)
- content labels (does the page include headings for the expected sections?)
- form elements (are the right input fields present in the markup?)
"""

FUNCTIONAL_USER = """\
## Instruction (what the page was supposed to implement)
{instruction}

## Test task
{task}

## Expected result
{expected_result}

## HTML source
```html
{html}
```

Respond with a single JSON object.
"""

# Truncate HTML to avoid huge token counts; most structural info is in the first ~400 lines
_HTML_CHAR_LIMIT = 40_000


def call_claude(system: str, user: str, model: str) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    msg = client.messages.create(
        model=model,
        max_tokens=256,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return msg.content[0].text


def call_openai(system: str, user: str, model: str) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    resp = client.chat.completions.create(
        model=model,
        max_tokens=256,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return resp.choices[0].message.content or ""


def parse_verdict(text: str) -> dict:
    # Try JSON block first
    match = re.search(r"\{[^{}]+\}", text, re.DOTALL)
    if match:
        try:
            obj = json.loads(match.group())
            verdict = obj.get("verdict", "").upper()
            if verdict in ("YES", "PARTIAL", "NO", "NA"):
                return {"verdict": verdict, "reasoning": obj.get("reasoning", "")}
        except json.JSONDecodeError:
            pass
    # Fallback: require whole-word match to avoid "NO" firing inside "NOT", etc.
    for v in ("YES", "PARTIAL", "NO", "NA"):
        if re.search(rf"\b{v}\b", text, re.IGNORECASE):
            return {"verdict": v, "reasoning": text.strip()}
    return {"verdict": "NO", "reasoning": text.strip()}


def score_task(task_dir: Path, ui_instructs: list[dict], model: str, use_openai: bool) -> list[dict]:
    raw_html = (task_dir / "page.html").read_text(encoding="utf-8")
    if len(raw_html) > _HTML_CHAR_LIMIT:
        print(f"  [warn] {task_dir.name}: HTML truncated ({len(raw_html)} → {_HTML_CHAR_LIMIT} chars)")
    html = raw_html[:_HTML_CHAR_LIMIT]
    meta = json.loads((task_dir / "metadata.json").read_text())
    instruction = meta.get("instruction", "")

    results = []
    for item in ui_instructs:
        task_text = item.get("task", "")
        expected = item.get("expected_result", "")

        user_prompt = FUNCTIONAL_USER.format(
            instruction=instruction,
            task=task_text,
            expected_result=expected,
            html=html,
        )

        try:
            if use_openai:
                raw = call_openai(FUNCTIONAL_SYSTEM, user_prompt, model)
            else:
                raw = call_claude(FUNCTIONAL_SYSTEM, user_prompt, model)
            verdict_obj = parse_verdict(raw)
        except Exception as exc:
            verdict_obj = {"verdict": "NO", "reasoning": f"Scoring error: {exc}"}

        results.append(
            {
                "task": task_text,
                "expected_result": expected,
                **verdict_obj,
            }
        )
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tasks", required=True, help="Path to WebGen-Bench test.jsonl")
    parser.add_argument("--out", default="results")
    parser.add_argument(
        "--model",
        default=os.environ.get("FUNCTIONAL_MODEL", "claude-haiku-4-5-20251001"),
    )
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument(
        "--force", action="store_true", help="Re-score even if functional.json exists"
    )
    args = parser.parse_args()

    use_openai = "gpt" in args.model.lower() or "o1" in args.model.lower()
    if use_openai and not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY is required for OpenAI models")
    if not use_openai and not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY is required for Anthropic models")

    # Load ui_instruct per task_id from the benchmark data
    tasks_path = Path(args.tasks)
    ui_by_id: dict[str, list[dict]] = {}
    with open(tasks_path) as f:
        for line in f:
            line = line.strip()
            if line:
                task = json.loads(line)
                task_id = task.get("id", "")
                ui_by_id[task_id] = task.get("ui_instruct", [])

    out_root = Path(args.out)
    task_dirs = sorted(
        d
        for d in out_root.iterdir()
        if d.is_dir()
        and (d / "page.html").exists()
        and (d / "metadata.json").exists()
    )

    pending = [
        d for d in task_dirs if args.force or not (d / "functional.json").exists()
    ]
    # Only score tasks that have ui_instruct data
    pending = [d for d in pending if d.name in ui_by_id and ui_by_id[d.name]]
    print(f"Scoring functional for {len(pending)}/{len(task_dirs)} task(s) with {args.model}…")

    errors = []

    def _work(task_dir: Path):
        ui_instructs = ui_by_id.get(task_dir.name, [])
        return task_dir, score_task(task_dir, ui_instructs, args.model, use_openai)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(_work, d): d for d in pending}
        for future in tqdm(as_completed(futures), total=len(futures), desc="Functional"):
            task_dir = futures[future]
            try:
                _, results = future.result()
                yes = sum(1 for r in results if r["verdict"] == "YES")
                partial = sum(1 for r in results if r["verdict"] == "PARTIAL")
                no = sum(1 for r in results if r["verdict"] == "NO")
                na = sum(1 for r in results if r["verdict"] == "NA")
                output = {
                    "id": task_dir.name,
                    "model": args.model,
                    "counts": {"yes": yes, "partial": partial, "no": no, "na": na},
                    "tasks": results,
                }
                (task_dir / "functional.json").write_text(
                    json.dumps(output, indent=2), encoding="utf-8"
                )
                tqdm.write(
                    f"[{task_dir.name}] yes={yes} partial={partial} no={no} na={na}"
                )
            except Exception as exc:
                tqdm.write(f"[{task_dir.name}] scoring failed: {exc}")
                errors.append({"id": task_dir.name, "error": str(exc)})

    if errors:
        err_path = out_root / "errors_functional.json"
        err_path.write_text(json.dumps(errors, indent=2))
        print(f"\n{len(errors)} error(s) written to {err_path}")

    print("Done.")


if __name__ == "__main__":
    main()
