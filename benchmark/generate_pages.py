"""
Generates pages for each WebGen-Bench task by navigating the live SvelteKit
app with Playwright, then saving the rendered HTML and a screenshot.

Using Playwright against the real app URL (rather than re-rendering saved HTML)
ensures web component <script> tags load with a proper HTTP origin so custom
elements initialise before the screenshot is taken.

For each task:
  1. Calls resetComponents on the Firebase functions endpoint (fresh slate).
  2. Derives a URL slug from application_type.
  3. Playwright navigates to /{slug}, waits for network idle (LLM generation
     + component script loading both complete before this fires).
  4. Saves screenshot as shot.png and body HTML as page.html.

Usage:
  python generate_pages.py \\
    --tasks /path/to/WebGen-Bench/data/test.jsonl \\
    --app-url http://localhost:5173 \\
    --functions-url http://localhost:5001/<project-id>/europe-southwest1 \\
    --out results/ \\
    [--limit 5] [--skip-reset] [--width 1280] [--height 900]
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


def reset_components(functions_url: str) -> None:
    url = f"{functions_url.rstrip('/')}/resetComponents"
    resp = requests.post(url, json={"data": {"confirm": "RESET"}}, timeout=60)
    resp.raise_for_status()


def process_task(
    task: dict,
    app_url: str,
    out_root: Path,
    width: int,
    height: int,
    id_token: str,
    page,
) -> dict:
    task_id = task.get("id", "unknown")
    task_dir = out_root / task_id
    task_dir.mkdir(parents=True, exist_ok=True)

    slug = slug_from_task(task)
    url = f"{app_url.rstrip('/')}/{slug}"

    if id_token:
        page.context.add_cookies([
            {"name": "authToken", "value": id_token, "url": app_url}
        ])

    t0 = time.monotonic()
    # LLM generation is server-side (SSR), so the full HTML is in the initial
    # HTTP response. networkidle then waits for component scripts to load.
    page.goto(url, timeout=180_000, wait_until="networkidle")
    elapsed = time.monotonic() - t0

    page.set_viewport_size({"width": width, "height": height})
    page.screenshot(path=str(task_dir / "shot.png"), full_page=True)

    body_html = page.inner_html("body")
    (task_dir / "page.html").write_text(body_html, encoding="utf-8")

    metadata = {
        "id": task_id,
        "slug": slug,
        "app_url": url,
        "instruction": task.get("instruction", ""),
        "application_type": task.get("application_type", ""),
        "category": task.get("Category", ""),
        "elapsed_s": round(elapsed, 2),
    }
    (task_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return metadata


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
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--skip-reset", action="store_true")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=900)
    args = parser.parse_args()

    id_token = os.environ.get("BENCHMARK_ID_TOKEN", "").strip()

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
    with open(tasks_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                tasks.append(json.loads(line))
    if args.limit:
        tasks = tasks[: args.limit]

    print(f"Processing {len(tasks)} task(s) → {out_root}/")

    from playwright.sync_api import sync_playwright

    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context()
        page = context.new_page()

        for task in tqdm(tasks, desc="Generating pages"):
            task_id = task.get("id", "unknown")
            task_dir = out_root / task_id

            if (task_dir / "page.html").exists() and (task_dir / "shot.png").exists():
                tqdm.write(f"[{task_id}] already exists, skipping")
                continue

            if not args.skip_reset:
                try:
                    reset_components(functions_url)
                except Exception as exc:
                    tqdm.write(f"[{task_id}] reset failed: {exc}")
                    errors.append({"id": task_id, "stage": "reset", "error": str(exc)})
                    continue

            try:
                meta = process_task(
                    task, args.app_url, out_root,
                    args.width, args.height, id_token, page,
                )
                tqdm.write(
                    f"[{task_id}] {meta['slug']} — {meta['elapsed_s']}s, "
                    f"{len((task_dir / 'page.html').read_text())} chars"
                )
            except Exception as exc:
                tqdm.write(f"[{task_id}] failed: {exc}")
                errors.append({"id": task_id, "stage": "generate", "error": str(exc)})

        browser.close()

    if errors:
        err_path = out_root / "errors_generate.json"
        err_path.write_text(json.dumps(errors, indent=2))
        print(f"\n{len(errors)} error(s) written to {err_path}")

    print("Done.")


if __name__ == "__main__":
    main()
