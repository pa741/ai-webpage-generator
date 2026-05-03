"""
Generates pages for each WebGen-Bench task by hitting the running SvelteKit app.

For each task:
  1. Calls resetComponents on the Firebase functions endpoint to clear the
     component library (fresh slate per task).
  2. Derives a URL slug from the task's application_type field.
  3. GETs /{slug} from the app, saves the HTML and timing metadata.

Usage:
  python generate_pages.py \\
    --tasks /path/to/WebGen-Bench/data/test.jsonl \\
    --app-url http://localhost:5173 \\
    --functions-url http://localhost:5001/<project-id>/europe-southwest1 \\
    --out results/ \\
    [--limit 5] [--skip-reset]
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import requests
from tqdm import tqdm


def slug_from_task(task: dict) -> str:
    app_type = task.get("application_type", "").strip()
    if app_type:
        return re.sub(r"[^a-z0-9]+", "-", app_type.lower()).strip("-")
    # Fallback: first 6 meaningful words from instruction
    words = re.findall(r"[a-zA-Z]+", task.get("instruction", ""))
    skip = {"please", "implement", "a", "an", "the", "for", "and", "to", "of"}
    meaningful = [w.lower() for w in words if w.lower() not in skip]
    return "-".join(meaningful[:6]) or "page"


def reset_components(functions_url: str, id_token: str) -> None:
    url = f"{functions_url.rstrip('/')}/resetComponents"
    resp = requests.post(
        url,
        json={"data": {"confirm": "RESET"}},
        headers={"Authorization": f"Bearer {id_token}"},
        timeout=60,
    )
    resp.raise_for_status()


def fetch_page(app_url: str, slug: str, id_token: str) -> tuple[str, float]:
    url = f"{app_url.rstrip('/')}/{slug}"
    t0 = time.monotonic()
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {id_token}"},
        timeout=120,
    )
    elapsed = time.monotonic() - t0
    resp.raise_for_status()
    return resp.text, elapsed


def extract_generated_html(full_html: str) -> str:
    """Pull the AI-generated fragment out of the SvelteKit page."""
    # The generated HTML is injected into a <div id="generated-content"> or similar.
    # Try to find the inner content between the first <body> and </body>.
    match = re.search(r"<body[^>]*>(.*?)</body>", full_html, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return full_html


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tasks", required=True, help="Path to WebGen-Bench test.jsonl")
    parser.add_argument("--app-url", default="http://localhost:5173")
    parser.add_argument(
        "--functions-url",
        default=os.environ.get("FUNCTIONS_URL", ""),
        help="Firebase functions base URL (emulator or prod)",
    )
    parser.add_argument("--out", default="results")
    parser.add_argument("--limit", type=int, default=None, help="Max tasks to process")
    parser.add_argument(
        "--skip-reset",
        action="store_true",
        help="Skip component reset (useful for debugging single tasks)",
    )
    args = parser.parse_args()

    id_token = os.environ.get("BENCHMARK_ID_TOKEN", "").strip()
    if not id_token:
        sys.exit("BENCHMARK_ID_TOKEN env var is required")

    functions_url = args.functions_url
    if not args.skip_reset and not functions_url:
        sys.exit(
            "FUNCTIONS_URL env var or --functions-url is required for component reset. "
            "Use --skip-reset to bypass."
        )

    tasks_path = Path(args.tasks)
    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)

    tasks = []
    with open(tasks_path) as f:
        for line in f:
            line = line.strip()
            if line:
                tasks.append(json.loads(line))

    if args.limit:
        tasks = tasks[: args.limit]

    print(f"Processing {len(tasks)} task(s) → {out_root}/")

    errors = []
    for task in tqdm(tasks, desc="Generating pages"):
        task_id = task.get("id", "unknown")
        task_dir = out_root / task_id
        task_dir.mkdir(parents=True, exist_ok=True)

        html_path = task_dir / "page.html"
        meta_path = task_dir / "metadata.json"

        if html_path.exists() and meta_path.exists():
            tqdm.write(f"[{task_id}] already exists, skipping")
            continue

        slug = slug_from_task(task)

        # Reset component library before each task
        if not args.skip_reset:
            try:
                reset_components(functions_url, id_token)
            except Exception as exc:
                tqdm.write(f"[{task_id}] reset failed: {exc}")
                errors.append({"id": task_id, "stage": "reset", "error": str(exc)})
                continue

        # Fetch the generated page
        try:
            full_html, elapsed = fetch_page(args.app_url, slug, id_token)
        except Exception as exc:
            tqdm.write(f"[{task_id}] fetch failed ({slug}): {exc}")
            errors.append({"id": task_id, "stage": "fetch", "error": str(exc)})
            continue

        body_html = extract_generated_html(full_html)
        html_path.write_text(body_html, encoding="utf-8")

        metadata = {
            "id": task_id,
            "slug": slug,
            "app_url": f"{args.app_url}/{slug}",
            "instruction": task.get("instruction", ""),
            "application_type": task.get("application_type", ""),
            "category": task.get("Category", ""),
            "elapsed_s": round(elapsed, 2),
        }
        meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        tqdm.write(f"[{task_id}] {slug} — {elapsed:.1f}s, {len(body_html)} chars")

    if errors:
        err_path = out_root / "errors_generate.json"
        err_path.write_text(json.dumps(errors, indent=2))
        print(f"\n{len(errors)} error(s) written to {err_path}")

    print("Done.")


if __name__ == "__main__":
    main()
