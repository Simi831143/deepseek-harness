"""Export the tables LiteParse finds in a PDF to an Excel workbook, one sheet per table.

Usage: pdf_tables.py <file.pdf> --out tables.xlsx [--pages 3-5] [--password-file FILE] [--keep-text] [--overwrite]

Numbers are stored as numbers unless --keep-text is given. Values that look like codes or IDs
(leading zeros, 11 or more digits, dates, mixed text) stay text so Excel cannot alter them.
The first sheet lists every table with its page and whether a header row was found.
"""

import argparse
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # the skill folder may be read-only application resources
sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I leaves the script folder off sys.path
from _common import new_output, read_password, utf8_stdio  # also adds vendor/
from liteparse import LiteParse
from liteparse.types import ParseError
from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

NUMBER = re.compile(r"^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$")


def to_cell(text: str):
    """Return (value, number_format) for one table cell."""
    raw = text.strip()
    if not raw:
        return None, None
    body, negative = raw, False
    if body.startswith("(") and body.endswith(")"):
        body, negative = body[1:-1].strip(), True
    percent = body.endswith("%")
    if percent:
        body = body[:-1].strip()
    match = NUMBER.match(body)
    if not match:
        return text, None
    integer_digits = re.sub(r"\D", "", body.split(".")[0])
    if len(integer_digits) > 1 and integer_digits.startswith("0"):
        return text, None  # codes such as 027140
    if match.group(1) is None and len(integer_digits) >= 11:
        return text, None  # phone, ID and account numbers
    if len(re.sub(r"\D", "", body)) > 15:
        return text, None  # beyond Excel's 15-digit precision
    decimals = len(match.group(1) or "")
    value = float(body.replace(",", "")) if decimals else int(body.replace(",", ""))
    if negative:
        value = -value
    grouping = "#,##0" if "," in body else "0"
    fmt = grouping + ("." + "0" * decimals if decimals else "")
    if percent:
        return value / 100, fmt + "%"
    return value, fmt


def main() -> int:
    utf8_stdio()
    parser = argparse.ArgumentParser(description="Export PDF tables to Excel (no OCR).")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--out", type=Path, required=True, help="new .xlsx file")
    parser.add_argument("--pages", help='pages to scan, e.g. "3-5" (default: all)')
    parser.add_argument("--password-file", type=Path)
    parser.add_argument("--keep-text", action="store_true", help="store every cell as text")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    pdf = args.pdf.resolve()
    if not pdf.is_file():
        print(f"File not found: {pdf}", file=sys.stderr)
        return 2
    out = new_output(args.out, args.overwrite, pdf)
    lp = LiteParse(
        ocr_enabled=False,
        output_format="markdown",
        extract_blocks=True,
        target_pages=args.pages,
        password=read_password(args.password_file),
        continue_on_page_error=True,
        quiet=True,
    )
    try:
        result = lp.parse(str(pdf))
    except ParseError as error:
        print(f"Could not parse {pdf.name}: {error}", file=sys.stderr)
        return 2

    tables = []  # (page number, table block, text of the block just above it)
    for page in result.pages:
        blocks = page.blocks or []
        for i, block in enumerate(blocks):
            if block.kind == "table" and block.rows:
                above = (getattr(blocks[i - 1], "text", "") or "").strip() if i else ""
                tables.append((page.page_num, block, " ".join(above.split())))
    if not tables:
        print(f"No tables were found in {pdf.name}. Tables drawn as images need a screenshot instead.")
        return 1

    book = Workbook()
    index = book.active
    index.title = "tables"
    index.append(["page", "table on page", "sheet", "rows", "columns", "header row found"])
    for cell in index[1]:
        cell.font = Font(bold=True)
    count_on_page: dict[int, int] = {}
    notes = []
    for page_num, block, above in tables:
        count_on_page[page_num] = count_on_page.get(page_num, 0) + 1
        name = f"p{page_num}-t{count_on_page[page_num]}"
        sheet = book.create_sheet(name)
        rows = ([block.header] if block.header else []) + block.rows
        widths: dict[int, int] = {}
        for r, row in enumerate(rows, start=1):
            for c, layout_cell in enumerate(row, start=1):
                text = layout_cell.text or ""
                value, fmt = (text or None, None) if args.keep_text else to_cell(text)
                cell = sheet.cell(row=r, column=c, value=value)
                if fmt:
                    cell.number_format = fmt
                if r == 1 and block.header:
                    cell.font = Font(bold=True)
                widths[c] = max(widths.get(c, 0), min(60, sum(2 if ord(ch) > 0x2E7F else 1 for ch in text)))
        for c, width in widths.items():
            sheet.column_dimensions[get_column_letter(c)].width = max(8, width + 2)
        if block.header:
            sheet.freeze_panes = "A2"
        columns = max(len(row) for row in rows)
        index.append([page_num, count_on_page[page_num], name, len(rows), columns, "yes" if block.header else "no"])
        if not block.header and above:
            notes.append(f"  {name}: no header row; the text just above the table, which may hold the scrambled column names, is: {above[:200]}")
        # A row with text in its first cell only is usually a group label from a merged column on the left.
        labels = [(r, (row[0].text or "").strip()) for r, row in enumerate(rows, start=1)
                  if columns >= 3 and (row[0].text or "").strip() and not any((c.text or "").strip() for c in row[1:])]
        if labels:
            listed = ", ".join(f"row {r} ({text})" for r, text in labels)
            notes.append(f"  {name}: {listed} hold text in the first cell only. These are probably group labels from a merged "
                         "column; the column itself is missing and a label may sit in the middle of its group, not above it.")

    book.save(out)
    print(f"Wrote {len(tables)} tables to {out}")
    for row in index.iter_rows(min_row=2, values_only=True):
        print(f"  page {row[0]} table {row[1]} -> sheet {row[2]}: {row[3]} rows x {row[4]} columns; header row found: {row[5]}")
    if any(row[5] == "no" for row in index.iter_rows(min_row=2, values_only=True)):
        print("Tables without a header row may have lost their column names or first column; check them against a screenshot of the page.")
    for note in notes:
        print(note)
    return 0


if __name__ == "__main__":
    sys.exit(main())
