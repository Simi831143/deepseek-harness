"""Parse a PDF into one Markdown file per page with the bundled LiteParse, with OCR off.

Usage: pdf_read.py <file.pdf> [--pages 1-5,8] [--out DIR] [--password-file FILE] [--print]

--print writes the pages' Markdown to stdout instead of files, for sessions that cannot write.

Writes page-0001.md, page-0002.md, ... and summary.json to DIR (default: ./.pdf-cache/<name>-<hash>)
and prints a summary of the requested pages: pages with little or no text, tables, and figures.
Pages already parsed from the same unchanged file are reused; only missing pages are parsed.
"""

import argparse
import hashlib
import json
import re
import sys
from importlib.metadata import version
from pathlib import Path
from typing import NamedTuple

sys.dont_write_bytecode = True  # the skill folder may be read-only application resources
sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I leaves the script folder off sys.path
from _common import compact_ranges, parse_pages, ranges, read_password, utf8_stdio  # also adds vendor/
from liteparse import LiteParse
from liteparse.types import ParseError

CACHE_FORMAT = 5
# A page with fewer visible characters than this is reported as having little or no text layer.
LOW_TEXT_CHARS = 50
# Images covering less of the page than this are logos, icons and the like.
SMALL_IMAGE_SHARE = 0.015
IMAGE_PLACEHOLDER = re.compile(r"!\[[^\]]*\]\(img_p(\d+)_(\d+)\.\w+\)")
# Charts drawn as vector graphics are not images; their caption is the only trace in the text.
FIGURE_CAPTION = re.compile(r"^\s*(?:图|圖|Figure|Fig\.|Chart|Exhibit)\s*\d+", re.IGNORECASE)
# Table-of-contents lines list captions too; their dot leaders tell them apart.
TOC_LEADER = re.compile(r"\.{5,}|…{2,}|·{5,}")


def caption_count(text: str) -> int:
    return sum(1 for line in text.splitlines() if FIGURE_CAPTION.match(line) and not TOC_LEADER.search(line))


class PageImage(NamedTuple):
    ids: set[str]  # ids the Markdown may use for it; a repeated image, such as a logo, keeps the id of its first use
    share: float  # share of the page area it covers
    region: str  # where it sits, as percentages of the page width and height, for cropping a screenshot


def page_images(result) -> dict[int, list[PageImage]]:
    """Map each page number to the embedded images placed on it."""
    sizes = {p.page_num: (p.width or 0, p.height or 0) for p in result.pages}
    images: dict[int, list[PageImage]] = {}
    for image in result.images:
        width, height = sizes.get(image.page, (0, 0))
        if width and height:
            box = image.bbox
            region = (f"x {100 * box.x / width:.0f}-{100 * (box.x + box.width) / width:.0f}%, "
                      f"y {100 * box.y / height:.0f}-{100 * (box.y + box.height) / height:.0f}%")
            ids = {image.id} | ({image.duplicate_of} if image.duplicate_of else set())
            images.setdefault(image.page, []).append(PageImage(ids, box.width * box.height / (width * height), region))
    return images


def page_markdown(page, images: list[PageImage]) -> str:
    by_id = {i: image for image in images for i in image.ids}

    def placeholder(m: re.Match) -> str:
        # A repeated image keeps the id of its first page; name it without that misleading page number.
        name = f"image p{m.group(1)}-{m.group(2)}" if m.group(1) == str(page.page_num) else "image"
        image = by_id.get(f"p{m.group(1)}_{m.group(2)}")
        if image and image.share < SMALL_IMAGE_SHARE:
            return f"[small {name}, such as a logo]"
        where = f" It covers {image.region} of the page." if image else ""
        return f"[{name}: not in the text; screenshot page {page.page_num} to see it.{where}]"

    markdown = IMAGE_PLACEHOLDER.sub(placeholder, page.markdown)
    # LiteParse can fold an image into a table or other block and leave no reference to it in the Markdown.
    placed = {f"p{a}_{b}" for a, b in IMAGE_PLACEHOLDER.findall(page.markdown)}
    for image in images:
        if image.share >= SMALL_IMAGE_SHARE and not image.ids & placed:
            markdown += (f"\n\n[image on this page but missing from the text above; it may hold a table or chart. "
                         f"Screenshot page {page.page_num} to see it. It covers {image.region} of the page.]")
    return markdown


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_stem(name: str) -> str:
    stem = re.sub(r"[^\w\-]+", "_", name).strip("_")
    return stem[:40] or "pdf"


def load_cache(path: Path, key: dict) -> dict | None:
    if not path.is_file():
        return None
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:  # unreadable cache: parse again and replace it
        print(f"Ignoring unreadable {path}: {error}", file=sys.stderr)
        return None
    return cached if cached.get("key") == key else None


def print_summary(summary: dict, requested: list[int], folder: Path, parsed_now: list[int]) -> None:
    pages = [p for p in summary["pages"] if p["page"] in set(requested)]
    print(f"PDF: {summary['source']} ({summary['total_pages']} pages)")
    print(f"Folder: {folder}")
    print("  One file per page: page-0001.md, page-0002.md, ... (the number in the file name is the page number)")
    print(f"Requested pages: {ranges(requested)}; parsed now: {ranges(parsed_now)}; reused: {ranges(sorted(set(requested) - set(parsed_now)))}")
    print(f"Characters of text: {sum(p['chars'] for p in pages):,}")
    print(f"Pages with little or no text (scanned or image-only): {ranges([p['page'] for p in pages if p['low_text']])}")
    print(f"Pages with tables: {ranges([p['page'] for p in pages if p['tables']])}")
    print(f"Pages with chart or figure captions (图1, Figure 1, ...): {ranges([p['page'] for p in pages if p['captions']])}")
    print(f"Pages with pictures (embedded images larger than a logo): {ranges([p['page'] for p in pages if p['images']])}")
    errors = [e for e in summary["page_errors"] if e["page"] in set(requested)]
    print("Page errors: " + ("none" if not errors else "; ".join(f"page {e['page']}: {e['message']}" for e in errors)))


def main() -> int:
    utf8_stdio()
    parser = argparse.ArgumentParser(description="Parse a PDF into per-page Markdown files (no OCR).")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--pages", help='pages to parse, e.g. "1-5,8" (default: all)')
    parser.add_argument("--out", type=Path, help="output folder (default: ./.pdf-cache/<name>-<hash>)")
    parser.add_argument("--password-file", type=Path, help="file whose first line is the PDF password")
    parser.add_argument("--print", action="store_true", help="print the Markdown instead of writing files")
    args = parser.parse_args()

    pdf = args.pdf.resolve()
    if not pdf.is_file():
        print(f"File not found: {pdf}", file=sys.stderr)
        return 2
    digest = file_digest(pdf)
    folder = (args.out or Path.cwd() / ".pdf-cache" / f"{safe_stem(pdf.stem)}-{digest[:8]}").resolve()
    key = {"format": CACHE_FORMAT, "sha256": digest, "liteparse": version("liteparse")}
    summary_path = folder / "summary.json"
    summary = None if args.print else load_cache(summary_path, key)

    target = args.pages
    if summary is not None:
        try:
            requested = parse_pages(args.pages, summary["total_pages"]) if args.pages else list(range(1, summary["total_pages"] + 1))
        except ValueError as error:
            print(error, file=sys.stderr)
            return 2
        missing = sorted(set(requested) - {p["page"] for p in summary["pages"]})
        if not missing:
            print_summary(summary, requested, folder, [])
            return 0
        target = compact_ranges(missing)

    lp = LiteParse(
        ocr_enabled=False,
        output_format="markdown",
        extract_blocks=True,
        extract_images=True,  # image placements; costs a few milliseconds per page
        target_pages=target,
        password=read_password(args.password_file),
        continue_on_page_error=True,
        quiet=True,
    )
    try:
        result = lp.parse(str(pdf))
    except ParseError as error:
        print(f"Could not parse {pdf.name}: {error}", file=sys.stderr)
        print("If the PDF is password-protected, ask the user for the password and pass it with --password-file.", file=sys.stderr)
        return 2

    all_images = page_images(result)
    if args.print:
        print(f"PDF: {pdf} ({result.total_pages} pages)")
        for page in result.pages:
            print(f"\n===== page {page.page_num} of {result.total_pages} =====\n{page_markdown(page, all_images.get(page.page_num, []))}")
        return 0

    try:
        folder.mkdir(parents=True, exist_ok=True)
        ignore = folder.parent / ".gitignore"
        if folder.parent.name == ".pdf-cache" and not ignore.exists():
            ignore.write_text("*\n", encoding="utf-8")
    except OSError as error:
        print(f"Cannot write {folder}: {error}", file=sys.stderr)
        print('Rerun with --print --pages "<a few pages>" to get the text without saving files.', file=sys.stderr)
        return 2
    if summary is None:
        for old in folder.glob("page-*.md"):
            old.unlink()
        summary = {"key": key, "source": str(pdf), "total_pages": result.total_pages, "pages": [], "page_errors": []}

    parsed_now = []
    by_page = {p["page"]: p for p in summary["pages"]}
    for page in result.pages:
        images = all_images.get(page.page_num, [])
        label = f" (printed page label: {page.page_label})" if page.page_label else ""
        header = f"<!-- {pdf.name} | page {page.page_num} of {result.total_pages}{label} -->\n\n"
        (folder / f"page-{page.page_num:04d}.md").write_text(header + page_markdown(page, images), encoding="utf-8")
        chars = len(re.sub(r"\s+", "", page.text))
        by_page[page.page_num] = {
            "page": page.page_num,
            "label": page.page_label,
            "chars": chars,
            "low_text": chars < LOW_TEXT_CHARS,
            "tables": sum(1 for b in page.blocks or [] if b.kind == "table"),
            "captions": caption_count(page.text),
            "images": sum(1 for image in images if image.share >= SMALL_IMAGE_SHARE),
        }
        parsed_now.append(page.page_num)
    summary["pages"] = [by_page[n] for n in sorted(by_page)]
    summary["page_errors"] = [e for e in summary["page_errors"] if e["page"] not in parsed_now]
    summary["page_errors"] += [{"page": e.page_num, "message": e.message} for e in result.page_errors]
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")

    try:
        requested = parse_pages(args.pages, result.total_pages) if args.pages else list(range(1, result.total_pages + 1))
    except ValueError:  # LiteParse accepted a spec this script cannot list; report what was parsed
        requested = sorted(parsed_now)
    print_summary(summary, requested, folder, sorted(parsed_now))
    return 0


if __name__ == "__main__":
    sys.exit(main())
