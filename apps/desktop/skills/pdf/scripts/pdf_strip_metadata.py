"""Remove document metadata from a PDF: every Info entry (title, author, producer, dates, custom keys) and XMP.

Usage: pdf_strip_metadata.py <in.pdf> <out.pdf> [--overwrite]

Page content, bookmarks, form fields, annotations and attachments are kept; it prints what was removed.
The file is repacked with pdfcpu so it stays as compact as the input, and the Producer and dates that
pdfcpu writes are blanked afterwards. Encrypted PDFs must be decrypted first.
"""

import argparse
import os
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # the skill folder may be read-only application resources
sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I leaves the script folder off sys.path
from _common import new_output, repack, utf8_stdio  # also adds vendor/
from pypdf import PdfReader, PdfWriter
from pypdf.generic import IndirectObject, NameObject


def blank_info(path: Path) -> bool:
    """Overwrite the Info dictionary's entries with spaces, keeping every byte offset; True if none remain."""
    reader = PdfReader(str(path))
    ref = reader.trailer.raw_get("/Info") if "/Info" in reader.trailer else None
    if ref is None:
        return True
    if not isinstance(ref, IndirectObject):
        return False
    offset = reader.xref.get(ref.generation, {}).get(ref.idnum)
    if not isinstance(offset, int):
        return False  # stored inside an object stream; it cannot be edited in place
    data = bytearray(path.read_bytes())
    start = re.compile(rb"\s*%d\s+%d\s+obj\s*<<" % (ref.idnum, ref.generation)).match(data, offset)
    if not start:
        return False
    end = data.find(b"endobj", start.end())
    close = data.rfind(b">>", start.end(), end) if end > 0 else -1
    if close < 0:
        return False
    data[start.end():close] = b" " * (close - start.end())
    path.write_bytes(data)
    return not dict(PdfReader(str(path)).metadata or {})


def human(n: int) -> str:
    return f"{n / 1024:,.0f} KB" if n < 1 << 20 else f"{n / (1 << 20):,.2f} MB"


def main() -> int:
    utf8_stdio()
    parser = argparse.ArgumentParser(description="Remove Info and XMP metadata from a PDF.")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    pdf = args.pdf.resolve()
    if not pdf.is_file():
        sys.exit(f"File not found: {pdf}")
    out = new_output(args.out, args.overwrite, pdf)
    reader = PdfReader(str(pdf))
    if reader.is_encrypted:
        sys.exit("This PDF is encrypted. Decrypt it to a new file with pdfcpu first, then strip that file.")

    removed = sorted(str(k) for k in (reader.metadata or {}))
    had_xmp = "/Metadata" in reader.trailer["/Root"]
    writer = PdfWriter(clone_from=reader)
    writer.pdf_header = reader.pdf_header
    writer.metadata = None
    writer._root_object.pop(NameObject("/Metadata"), None)

    stage = out.with_name(out.stem + ".stage.pdf")  # pdfcpu only reads files named .pdf
    tmp = out.with_name(out.stem + ".tmp.pdf")
    note = None
    try:
        for leftover in (stage, tmp):
            leftover.unlink(missing_ok=True)
        with stage.open("wb") as f:
            writer.write(f)
        error = repack(stage, tmp)
        if error:
            note = f"pdfcpu could not repack the file ({error}); it was written by pypdf alone and may be larger."
            os.replace(stage, tmp)
        elif not blank_info(tmp):
            note = "pdfcpu stored its Producer entry where it cannot be blanked; the uncompacted copy was kept instead."
            os.replace(stage, tmp)
        os.replace(tmp, out)
    finally:
        for leftover in (stage, tmp):
            leftover.unlink(missing_ok=True)

    check = PdfReader(str(out))
    left = sorted(str(k) for k, v in (check.metadata or {}).items() if v)
    print(f"Wrote {out}")
    print("Removed Info entries: " + (", ".join(removed) if removed else "none present"))
    print("Removed XMP metadata: " + ("yes" if had_xmp else "none present"))
    print("Info entries left: " + (", ".join(left) if left else "none") + f"; XMP left: {'yes' if '/Metadata' in check.trailer['/Root'] else 'no'}")
    print(f"Pages: {len(reader.pages)} -> {len(check.pages)}; size: {human(pdf.stat().st_size)} -> {human(out.stat().st_size)}; header: {check.pdf_header}")
    if note:
        print(note)
    return 0


if __name__ == "__main__":
    sys.exit(main())
