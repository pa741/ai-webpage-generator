"""
Scores generated pages for visual appearance using a VLM.

For each task directory that has a shot.png but no appearance.json, this script
sends the screenshot + the original instruction to Claude (or GPT-4o as fallback)
and asks it to rate the page on the WebGen-Bench 4-criteria rubric (1–5).

Usage:
  python score_appearance.py --out results/ [--model claude-sonnet-4-6] [--workers 4]
"""

import argparse
import base64
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from tqdm import tqdm

# WebGen-Bench appearance rubric (adapted from src/grade_appearance_webgen/prompt.py)
APPEARANCE_PROMPT = """\
You are evaluating the visual quality of a generated webpage.

The page was created from the following instruction:
---
{instruction}
---

Evaluate the screenshot against these four criteria:
1. **Successful Rendering** — colours, fonts, and components display correctly with no broken layout.
2. **Content Relevance** — content matches the stated purpose; functional elements are logically placed.
3. **Layout Harmony** — the page is balanced, intuitive, and well-organised.
4. **Modernness & Beauty** — the design follows contemporary web trends and is aesthetically pleasing.

Write 2–4 paragraphs addressing all four criteria with specific observations about the screenshot.
Then on a final line output exactly: SCORE: <integer from 1 to 5>

Grading scale:
1 = Poor — major rendering issues, chaotic layout, outdated design
2 = Below average — partial rendering, poorly organised, very basic
3 = Average — mostly rendered correctly, functional but unremarkable
4 = Good — rendered well, logically organised, modern
5 = Excellent — flawless rendering, intuitive layout, cutting-edge design
"""


def load_image_b64(path: Path) -> str:
    return base64.standard_b64encode(path.read_bytes()).decode()


def score_with_claude(instruction: str, image_b64: str, model: str) -> dict:
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    prompt = APPEARANCE_PROMPT.format(instruction=instruction)

    message = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )
    text = message.content[0].text
    return {"reasoning": text, "score": _parse_score(text)}


def score_with_openai(instruction: str, image_b64: str, model: str) -> dict:
    from openai import OpenAI

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    prompt = APPEARANCE_PROMPT.format(instruction=instruction)

    response = client.chat.completions.create(
        model=model,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )
    text = response.choices[0].message.content or ""
    return {"reasoning": text, "score": _parse_score(text)}


def _parse_score(text: str) -> int | None:
    match = re.search(r"SCORE:\s*([1-5])", text)
    if match:
        return int(match.group(1))
    # Fallback: last standalone digit 1-5
    digits = re.findall(r"\b([1-5])\b", text)
    return int(digits[-1]) if digits else None


def score_task(task_dir: Path, model: str, use_openai: bool) -> dict:
    meta = json.loads((task_dir / "metadata.json").read_text())
    instruction = meta.get("instruction", meta.get("application_type", ""))
    image_b64 = load_image_b64(task_dir / "shot.png")

    if use_openai:
        result = score_with_openai(instruction, image_b64, model)
    else:
        result = score_with_claude(instruction, image_b64, model)

    result["id"] = task_dir.name
    result["model"] = model
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="results")
    parser.add_argument(
        "--model",
        default=os.environ.get("APPEARANCE_MODEL", "claude-sonnet-4-6"),
    )
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument(
        "--force", action="store_true", help="Re-score even if appearance.json exists"
    )
    args = parser.parse_args()

    use_openai = "gpt" in args.model.lower() or "o1" in args.model.lower()
    if use_openai and not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY is required for OpenAI models")
    if not use_openai and not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY is required for Anthropic models")

    out_root = Path(args.out)
    task_dirs = sorted(
        d
        for d in out_root.iterdir()
        if d.is_dir()
        and (d / "shot.png").exists()
        and (d / "metadata.json").exists()
    )

    pending = [
        d for d in task_dirs if args.force or not (d / "appearance.json").exists()
    ]
    print(f"Scoring appearance for {len(pending)}/{len(task_dirs)} task(s) with {args.model}…")

    errors = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(score_task, d, args.model, use_openai): d for d in pending
        }
        for future in tqdm(as_completed(futures), total=len(futures), desc="Appearance"):
            task_dir = futures[future]
            try:
                result = future.result()
                (task_dir / "appearance.json").write_text(
                    json.dumps(result, indent=2), encoding="utf-8"
                )
                score = result.get("score")
                tqdm.write(f"[{task_dir.name}] score={score}")
            except Exception as exc:
                tqdm.write(f"[{task_dir.name}] scoring failed: {exc}")
                errors.append({"id": task_dir.name, "error": str(exc)})

    if errors:
        err_path = out_root / "errors_appearance.json"
        err_path.write_text(json.dumps(errors, indent=2))
        print(f"\n{len(errors)} error(s) written to {err_path}")

    print("Done.")


if __name__ == "__main__":
    main()
