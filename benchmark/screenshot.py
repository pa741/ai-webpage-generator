"""
Takes screenshots of saved generated HTML pages using Playwright.

For each task directory that has a page.html but no shot.png, this script
wraps the HTML fragment in a minimal full-page shell and renders it in a
headless Chromium browser, saving the result as shot.png.

Usage:
  python screenshot.py --out results/ [--width 1280] [--height 900]
"""

import argparse
from pathlib import Path

from tqdm import tqdm

# Minimal HTML shell that loads Tailwind (matches the live app environment)
_SHELL = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Benchmark Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body {{ margin: 0; }}</style>
</head>
<body>
{body}
</body>
</html>
"""


def screenshot_task(task_dir: Path, width: int, height: int, page) -> None:
    html_path = task_dir / "page.html"
    shot_path = task_dir / "shot.png"

    body = html_path.read_text(encoding="utf-8")
    full_html = _SHELL.format(body=body)

    # Use data URI so no HTTP server is needed
    import base64
    encoded = base64.b64encode(full_html.encode()).decode()
    page.goto(f"data:text/html;base64,{encoded}")
    page.wait_for_load_state("networkidle", timeout=15_000)
    page.set_viewport_size({"width": width, "height": height})
    page.screenshot(path=str(shot_path), full_page=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="results")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument(
        "--force", action="store_true", help="Re-screenshot even if shot.png exists"
    )
    args = parser.parse_args()

    out_root = Path(args.out)
    task_dirs = sorted(
        d for d in out_root.iterdir() if d.is_dir() and (d / "page.html").exists()
    )

    if not task_dirs:
        print("No task directories with page.html found.")
        return

    pending = [d for d in task_dirs if args.force or not (d / "shot.png").exists()]
    print(f"Screenshotting {len(pending)}/{len(task_dirs)} task(s)…")

    from playwright.sync_api import sync_playwright

    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        for task_dir in tqdm(pending, desc="Screenshots"):
            try:
                screenshot_task(task_dir, args.width, args.height, page)
            except Exception as exc:
                tqdm.write(f"[{task_dir.name}] screenshot failed: {exc}")
                errors.append({"id": task_dir.name, "error": str(exc)})
        browser.close()

    if errors:
        import json
        err_path = out_root / "errors_screenshot.json"
        err_path.write_text(json.dumps(errors, indent=2))
        print(f"\n{len(errors)} error(s) written to {err_path}")

    print("Done.")


if __name__ == "__main__":
    main()
