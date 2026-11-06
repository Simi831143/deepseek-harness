"""Shrink a PDF by re-encoding its embedded images as JPEG, then repacking it with pdfcpu.

Usage: pdf_compress.py <in.pdf> <out.pdf> [--quality 60] [--max-px 1600] [--overwrite]

This is lossy for images; text and vector graphics are unchanged. Images with transparency,
bilevel images, and images that would not shrink are left as they are. Encrypted PDFs must be
decrypted first. The input file is never modified; if the result is not smaller, no file is written.
It first prints how the file's bytes split between images, fonts, and the rest, so a PDF whose size
comes from fonts or vector content is recognized before anything is tried.
"""

import argparse
import os
import sys
from io import BytesIO
from pathlib import Path

sys.dont_write_bytecode = True  # the skill folder may be read-only application resources
sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I leaves the script folder off sys.path
from _common import new_output, repack, utf8_stdio  # also adds vendor/
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import IndirectObject, StreamObject

# Replace an image only when the re-encoded copy saves at least this share of its bytes.
MIN_SAVING = 0.10
# Below this share of the file, image re-encoding cannot make a noticeable difference.
IMAGE_SHARE_WORTH_TRYING = 0.15


def human(n: int) -> str:
    return f"{n / 1024:,.0f} KB" if n < 1 << 20 else f"{n / (1 << 20):,.2f} MB"


def composition(reader: PdfReader) -> tuple[int, int]:
    """Stored bytes of image streams and embedded font files; every stream is a top-level object."""
    images = fonts = 0
    for generation, objects in reader.xref.items():
        for idnum in objects:
            try:
                obj = IndirectObject(idnum, generation, reader).get_object()
            except Exception:  # an unreadable object is simply not counted
                continue
            if not isinstance(obj, StreamObject):
                continue
            size = len(obj._data or b"")
            if obj.get("/Subtype") == "/Image":
                images += size
            elif "/Length1" in obj or obj.get("/Subtype") in ("/Type1C", "/CIDFontType0C", "/OpenType"):
                fonts += size
    return images, fonts


def main() -> int:
    utf8_stdio()
    parser = argparse.ArgumentParser(description="Re-encode PDF images to make the file smaller (lossy).")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--quality", type=int, default=60, help="JPEG quality 30-95 (default 60)")
    parser.add_argument("--max-px", type=int, help="also downscale images whose longer side exceeds this many pixels")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    if not 30 <= args.quality <= 95:
        sys.exit("--quality must be between 30 and 95.")

    pdf = args.pdf.resolve()
    if not pdf.is_file():
        sys.exit(f"File not found: {pdf}")
    out = new_output(args.out, args.overwrite, pdf)
    reader = PdfReader(str(pdf))
    if reader.is_encrypted:
        sys.exit("This PDF is encrypted. Decrypt it to a new file with pdfcpu first, then compress that file.")

    size_in = pdf.stat().st_size
    image_bytes, font_bytes = composition(reader)
    print(f"{pdf.name}: {human(size_in)}; images {human(image_bytes)} ({image_bytes / size_in:.0%}), "
          f"embedded fonts {human(font_bytes)} ({font_bytes / size_in:.0%}), "
          f"page content and the rest {human(max(0, size_in - image_bytes - font_bytes))}")
    if image_bytes < size_in * IMAGE_SHARE_WORTH_TRYING:
        print("Images are a small part of this file, so re-encoding them cannot shrink it much. "
              "Fonts and vector content are kept as they are.")

    writer = PdfWriter(clone_from=reader)
    writer.pdf_header = reader.pdf_header
    seen: set[int] = set()
    replaced = skipped = failed = 0
    for page in writer.pages:
        for image in page.images:
            ref = image.indirect_reference
            if ref is None or ref.idnum in seen:
                continue
            seen.add(ref.idnum)
            try:
                obj = ref.get_object()
                before = len(getattr(obj, "_data", b"") or obj.get_data())
                picture = image.image
                if picture.mode in ("1", "RGBA", "LA", "PA") or "/SMask" in obj or "/Mask" in obj:
                    skipped += 1
                    continue
                if picture.mode not in ("RGB", "L"):
                    picture = picture.convert("RGB")
                if args.max_px and max(picture.size) > args.max_px:
                    picture.thumbnail((args.max_px, args.max_px), Image.LANCZOS)
                trial = BytesIO()
                picture.save(trial, "JPEG", quality=args.quality)
                if trial.tell() > before * (1 - MIN_SAVING):
                    skipped += 1
                    continue
                image.replace(picture, quality=args.quality)
                replaced += 1
            except Exception as error:  # one undecodable image must not stop the rest; it is counted and left as is
                failed += 1
                print(f"  left one image unchanged ({type(error).__name__}: {error})", file=sys.stderr)
        page.compress_content_streams(level=9)
    writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)

    stage = out.with_name(out.stem + ".stage.pdf")  # pdfcpu only reads files named .pdf
    tmp = out.with_name(out.stem + ".tmp.pdf")
    try:
        for leftover in (stage, tmp):
            leftover.unlink(missing_ok=True)
        with stage.open("wb") as f:
            writer.write(f)
        error = repack(stage, tmp)
        if error:
            print(f"pdfcpu could not repack the file ({error}); using pypdf's output as is.", file=sys.stderr)
            os.replace(stage, tmp)
        size_out = tmp.stat().st_size
        print(f"Images re-encoded: {replaced}; left unchanged: {skipped}; could not be decoded: {failed}")
        if size_out >= size_in:
            print(f"No reduction ({human(size_in)} -> {human(size_out)}); no file was written.")
            return 1
        os.replace(tmp, out)
    finally:
        for leftover in (stage, tmp):
            leftover.unlink(missing_ok=True)
    print(f"{human(size_in)} -> {human(size_out)} ({(1 - size_out / size_in):.0%} smaller): {out}")
    if replaced:
        print(f"Images were re-encoded as JPEG quality {args.quality}" + (f" and limited to {args.max_px} px" if args.max_px else "") + "; check image sharpness before sending.")
    else:
        print("No image was changed; the saving comes from lossless repacking only.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
