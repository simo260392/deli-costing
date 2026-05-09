#!/usr/bin/env python3
"""
Parse an invoice PDF (or image) and output structured JSON.
Usage: python3 parse_invoice.py <file_path> [original_filename]

Supported input types: PDF, JPG/JPEG, PNG, TIFF, BMP, GIF, WEBP
Images are auto-converted to PDF before parsing.
Always outputs valid JSON — never crashes with a traceback.

Line-item extraction strategies (tried in order):
  1. pdfplumber table extraction (works for structured tables)
  2. Wing Hong text-line regex
  3. Word-bbox column reconstruction (handles PDFs where tables have no borders,
     words are position-based only — Kakulas, Sugar Rush, Little Home Bakery, etc.)
  4. Costco in-warehouse receipt format (CODE Nx PRICE TOTAL GST_FLAG pattern)
  5. MarketBase/Etherington format (printed webmail, CTN/DOZ pattern)
  6. Simple price-pair fallback
"""
import sys, json, re, os, tempfile
from datetime import datetime

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def respace_text(s):
    """
    Re-insert spaces into concatenated words produced by PDFs with broken
    character spacing (e.g. 'BananaBread' -> 'Banana Bread',
    'Mango&CoconutBananaBread' -> 'Mango & Coconut Banana Bread').
    Splits on: CamelCase boundaries, & and / characters.
    """
    if not s:
        return s
    # Insert spaces before uppercase letters that follow lowercase or digit
    # e.g. BananaBread -> Banana Bread, MangoCoconut -> Mango Coconut
    s = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', s)
    # Insert spaces around & and / if not already spaced
    s = re.sub(r'\s*&\s*', ' & ', s)
    s = re.sub(r'(?<=[a-zA-Z])/(?=[a-zA-Z])', ' / ', s)
    # Collapse multiple spaces
    s = re.sub(r'  +', ' ', s).strip()
    return s


def clean_num(s):
    """Extract first valid number from a string (handles 'GSTFree', '82.25 GSTFree', etc.)"""
    if s is None: return None
    # Try to find first number pattern in the string
    m = re.search(r'-?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d+|\d+)', str(s).replace(',', ''))
    if m:
        try: return float(m.group(1).replace(',', ''))
        except: return None
    return None

def parse_date(raw):
    raw = raw.strip()
    for fmt in ["%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y",
                "%m/%d/%y", "%d-%b-%Y", "%d %b %Y", "%d/%b/%Y", "%d %B %Y",
                "%d-%b-%y", "%d %b %y",
                "%d.%m.%Y", "%d.%m.%y",   # Etherington: 13.04.2026
                "%d%b%Y", "%d%B%Y"]:       # Sugar Rush: 14Oct2025 (no spaces)
        try: return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except: pass
    return raw

def image_to_pdf(img_path):
    """Convert image file to PDF using img2pdf, fallback to PIL."""
    tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
    tmp.close()
    try:
        import img2pdf
        with open(tmp.name, 'wb') as f:
            f.write(img2pdf.convert(img_path))
        return tmp.name
    except Exception:
        pass
    try:
        from PIL import Image
        img = Image.open(img_path)
        if img.mode in ('RGBA', 'P', 'LA'):
            img = img.convert('RGB')
        img.save(tmp.name, 'PDF', resolution=200)
        return tmp.name
    except Exception:
        return None

def detect_file_type(file_path, original_filename=None):
    """Detect if file is PDF or image based on magic bytes and filename."""
    try:
        with open(file_path, 'rb') as f:
            header = f.read(8)
        if header[:4] == b'%PDF':
            return 'pdf'
        if header[:2] == b'\xff\xd8': return 'image'   # JPEG
        if header[:8] == b'\x89PNG\r\n\x1a\n': return 'image'  # PNG
        if header[:2] in (b'II', b'MM'): return 'image'  # TIFF
        if header[:2] == b'BM': return 'image'           # BMP
        if header[:3] == b'GIF': return 'image'          # GIF
        if header[:4] == b'RIFF': return 'image'         # WEBP
    except Exception:
        pass
    if original_filename:
        ext = os.path.splitext(original_filename.lower())[1]
        if ext == '.pdf': return 'pdf'
        if ext in ('.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.gif', '.webp'):
            return 'image'
    return 'unknown'



# ─────────────────────────────────────────────────────────────────────────────
# Vision OCR: use Claude to extract text from image-based PDFs/photos
# ─────────────────────────────────────────────────────────────────────────────

def ocr_image_with_vision(image_path):
    """
    Use Claude vision API to OCR an image (or image converted from PDF).
    Returns plain text. Falls back to empty string on error.
    """
    try:
        import anthropic, base64, mimetypes
        # Determine media type
        ext = os.path.splitext(image_path)[1].lower()
        mime_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                    '.gif': 'image/gif', '.webp': 'image/webp'}
        media_type = mime_map.get(ext, 'image/jpeg')
        with open(image_path, 'rb') as f:
            img_data = base64.standard_b64encode(f.read()).decode('utf-8')
        client = anthropic.Anthropic()
        msg = client.messages.create(
            model='claude-haiku-4-5',
            max_tokens=2000,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": img_data},
                    },
                    {
                        "type": "text",
                        "text": (
                            "This is a receipt or invoice photo. Please transcribe ALL text exactly as it appears, "
                            "line by line, preserving the layout. Include every item description, quantity, price, "
                            "date, supplier name, and total. Do not summarise — output raw text only."
                        )
                    }
                ],
            }]
        )
        return msg.content[0].text if msg.content else ""
    except Exception as e:
        return ""


def extract_line_items_via_vision(image_path):
    """
    Use Claude vision API to directly extract structured line items from a receipt/invoice image.
    Returns a list of line item dicts, or empty list on error.
    This bypasses regex parsing and works for any thermal receipt photo.
    """
    try:
        import anthropic, base64
        ext = os.path.splitext(image_path)[1].lower()
        mime_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                    '.gif': 'image/gif', '.webp': 'image/webp'}
        media_type = mime_map.get(ext, 'image/jpeg')
        with open(image_path, 'rb') as f:
            img_data = base64.standard_b64encode(f.read()).decode('utf-8')
        client = anthropic.Anthropic()
        prompt = (
            "You are extracting line items from a supplier receipt or invoice image for an Australian catering business.\n"
            "Extract EVERY purchased item from this receipt. For each item output a JSON object with:\n"
            "  - description: the product name/description (string)\n"
            "  - quantity: how many units/kg were purchased (number)\n"
            "  - unitPrice: price per unit (number, e.g. if 4 each@$5.49 then unitPrice=5.49)\n"
            "  - lineTotal: total line amount (number)\n"
            "  - unit: the unit of measure — 'each', 'kg', 'L', 'g', 'ml', 'pack', etc.\n\n"
            "IMPORTANT RULES:\n"
            "- Some items span 2 lines: the description is on line 1, quantity/price on line 2 (e.g. '4 each@12.99   51.96 Z')\n"
            "- For weight items: 'NET 2.780kg@$3.99/kg' means quantity=2.780, unitPrice=3.99, unit='kg'\n"
            "- For count items: '15 each@12.99' means quantity=15, unitPrice=12.99, unit='each'\n"
            "- Single-line items ending in a unit word (eac/each/kg) and price on same line\n"
            "- Ignore header, total, payment, and footer lines\n"
            "- Do NOT skip any product lines — include ALL items\n\n"
            "Return ONLY a JSON array of line item objects, no other text. Example:\n"
            '[{"description":"QF FROZEN MIXED BERRIES","quantity":1,"unitPrice":8.99,"lineTotal":8.99,"unit":"each"},\n'
            ' {"description":"DORSOGNA BACON SHORT","quantity":15,"unitPrice":12.99,"lineTotal":194.85,"unit":"each"}]'
        )
        msg = client.messages.create(
            model='claude-haiku-4-5',
            max_tokens=3000,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": img_data}},
                    {"type": "text", "text": prompt}
                ],
            }]
        )
        raw = (msg.content[0].text if msg.content else "").strip()
        # Extract JSON array from response
        arr_start = raw.find('[')
        arr_end = raw.rfind(']')
        if arr_start != -1 and arr_end != -1:
            parsed = json.loads(raw[arr_start:arr_end + 1])
            # Normalise fields
            items = []
            for item in parsed:
                items.append({
                    "description": str(item.get("description", "")).strip(),
                    "quantity": float(item.get("quantity") or 1),
                    "unitPrice": float(item.get("unitPrice") or 0),
                    "lineTotal": float(item.get("lineTotal") or 0),
                    "unit": str(item.get("unit") or "each").lower(),
                })
            return [i for i in items if i["description"]]
        return []
    except Exception:
        return []

# ─────────────────────────────────────────────────────────────────────────────
# Strategy: Fresh Express Produce (GRN invoice format)
# Fixed-width PDF with columns: Lot No | P/Order No | Cont | Qty | Description |
#   Grade/Day | Wt/Ct | Price | Extension
# Lot No column (x≈36) contains 6-digit numbers like "475093-00" for real lines.
# Crate Deposits have no Lot No and should be excluded.
# ─────────────────────────────────────────────────────────────────────────────
# Strategy: B&E Foods Perth (columnar table, cells contain newline-joined values)
# pdfplumber merges all rows into one cell per column — split by \n and zip.
# Format: ItemCode | ItemDescription | Ordered | Shipped | UOM | ShipDoc+UnitUOM | ItemPrice | GST | LineTotal
# ─────────────────────────────────────────────────────────────────────────────

def extract_be_foods_format(all_tables):
    """
    B&E Foods PDFs: pdfplumber merges all rows into one cell per column.
    Each column cell contains newline-joined values for all items.
    Use fixed column indices (confirmed from invoice structure):
      col 0: ItemCode, col 1: ItemDescription, col 4: Shipped qty,
      col 5: UOM, col 8: ItemPrice, col 12: GST, col 13: LineTotal
    Skip Fuel Levy and other surcharges.
    """
    try:
        SKIP_DESCS = re.compile(r'fuel\s*levy|delivery\s*charge|freight|surcharge|crate\s*deposit', re.IGNORECASE)
        items = []
        for table in all_tables:
            for row in table:
                if len(row) < 14:
                    continue
                codes_cell = str(row[0] or '').strip()
                desc_cell  = str(row[1] or '').strip()
                # Skip header row and non-data rows
                if re.match(r'^(ItemCode|Item\s*Code)', codes_cell, re.IGNORECASE):
                    continue
                # Must have description content with newlines (the merged B&E format)
                if not desc_cell or ('\n' not in desc_cell and '\n' not in codes_cell):
                    continue

                codes   = [c.strip() for c in codes_cell.split('\n') if c.strip()]
                descs_raw = [d.strip() for d in desc_cell.split('\n') if d.strip()]
                shipped = [s.strip() for s in str(row[4] or '').split('\n') if s.strip()]
                uoms    = [u.strip() for u in str(row[5] or '').split('\n') if u.strip()]
                prices  = [p.strip() for p in str(row[8] or '').split('\n') if p.strip()]
                totals  = [t.strip() for t in str(row[13] or '').split('\n') if t.strip()]

                if not codes or not descs_raw:
                    continue

                # Merge continuation description lines into their parent item.
                # Primary lines look like real product names (start with letter, >= 4 chars).
                # Continuation lines are short modifiers like 'S/OFF15KG', 'R/W', 'FROZEN'.
                def looks_primary(line):
                    return bool(re.match(r'^[A-Z][A-Z0-9]{3,}', line)) and not re.match(r'^[A-Z]/[A-Z]', line)

                merged = []
                for d in descs_raw:
                    if looks_primary(d) and len(merged) < len(codes):
                        merged.append(d)
                    elif merged:
                        merged[-1] = merged[-1] + ' ' + d
                    else:
                        merged.append(d)

                for i, desc in enumerate(merged):
                    if SKIP_DESCS.search(desc):
                        continue
                    qty   = clean_num(shipped[i] if i < len(shipped) else None)
                    uom   = (uoms[i] if i < len(uoms) else 'each').lower()
                    price = clean_num(prices[i] if i < len(prices) else None)
                    total = clean_num(totals[i] if i < len(totals) else None)
                    if qty and price and not total:
                        total = round(qty * price, 2)
                    if qty and total and not price:
                        price = round(total / qty, 4)
                    items.append({
                        'description': desc,
                        'quantity': qty,
                        'unitPrice': price,
                        'lineTotal': total,
                        'unit': uom if uom in ('kg','g','l','ml','each','ea','ctn','pkt','doz') else 'each',
                    })
        return items
    except Exception as e:
        return []


def extract_fresh_express_format(pdf_path):
    """
    Parse Fresh Express Produce invoices using word-position extraction.
    Groups words by Y row, identifies produce lines by Lot No column, and
    assembles description + pricing from the fixed column layout.
    """
    try:
        import pdfplumber as _plumber
        items = []
        with _plumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                words = page.extract_words()
                # Group words by approximate Y row (bucket to 3pt)
                rows = {}
                for w in words:
                    y = round(w['top'] / 3) * 3
                    rows.setdefault(y, []).append(w)

                for y in sorted(rows.keys()):
                    row_words = sorted(rows[y], key=lambda w: w['x0'])

                    # A produce line has a Lot No at x < 80 matching \d{6}-\d{2}
                    lot_words = [w for w in row_words if w['x0'] < 80 and re.match(r'\d{6}-\d{2}', w['text'])]
                    if not lot_words:
                        continue

                    # Description words: x between 220 and 420
                    desc_words = [w for w in row_words if 220 <= w['x0'] <= 420]
                    # Skip the leading "*" marker if present
                    desc_parts = [w['text'] for w in desc_words if w['text'] != '*']
                    description = ' '.join(desc_parts).strip()

                    # Skip if no description
                    if not description:
                        continue

                    # Skip surcharge / non-produce lines
                    desc_upper = description.upper()
                    if 'SURCHARGE' in desc_upper or 'CRATE' in desc_upper or 'DEPOSIT' in desc_upper:
                        continue

                    # Qty: x between 190 and 220
                    qty_words = [w for w in row_words if 190 <= w['x0'] <= 220]
                    qty = None
                    for qw in qty_words:
                        try:
                            qty = float(qw['text'])
                            break
                        except ValueError:
                            pass

                    # Wt/Ct (pack size / weight per unit): x between 440 and 490
                    wt_words = [w for w in row_words if 440 <= w['x0'] <= 490]
                    wt_ct = None
                    for ww in wt_words:
                        try:
                            wt_ct = float(ww['text'])
                            break
                        except ValueError:
                            pass

                    # Price (unit price): x between 490 and 540
                    price_words = [w for w in row_words if 490 <= w['x0'] <= 540]
                    unit_price = None
                    for pw in price_words:
                        try:
                            unit_price = float(pw['text'])
                            break
                        except ValueError:
                            pass

                    # Extension (line total): x > 540
                    ext_words = [w for w in row_words if w['x0'] > 540]
                    line_total = None
                    for ew in ext_words:
                        try:
                            line_total = float(ew['text'])
                            break
                        except ValueError:
                            pass

                    # If only one price column populated (no wt_ct, no unit_price)
                    # it means item is priced per "each" with only extension shown
                    if unit_price is None and line_total is not None and qty:
                        unit_price = round(line_total / qty, 4)
                    elif unit_price is None and wt_ct is None and line_total is not None:
                        unit_price = line_total

                    items.append({
                        "description": description,
                        "quantity": qty or 1.0,
                        "unitPrice": unit_price or 0.0,
                        "lineTotal": line_total,
                        "unit": "each",
                    })
        return items
    except Exception as e:
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Strategy: Brownes / embedded-column format
# Handles invoices where pdfplumber collapses all row data into a single cell,
# with each line like: "DESCRIPTION UOM QTY LIST_PRICE DISCOUNT NETT_PRICE TOTAL GST"
# ─────────────────────────────────────────────────────────────────────────────

def extract_brownes_format(all_tables):
    """
    For Brownes-style invoices where all rows are concatenated in one table cell.
    Detects by: table has 'Nett Unit Price' or 'Extended Price' in header, but
    all numeric columns are None in the data row.
    Each description line is: NAME UOM QTY LIST_PRICE DISCOUNT NETT_UNIT EXTENDED GST_FLAG
    """
    UOM_PAT = re.compile(
        r'^(.+?)\s+(EA|KG|L|ML|EACH|PK|CS|CTN|DOZ|BOX|G|LT)\s+'
        r'(\d+(?:\.\d+)?)\s+'        # QTY
        r'([\d]+\.\d+)\s+'           # Unit List Price
        r'(-[\d]+\.\d+)\s+'          # Discount (negative)
        r'([\d]+\.\d+)\s+'           # Nett Unit Price
        r'([\d]+\.\d+)\s*'
        r'[YN]?\s*$',                 # Extended Price + GST flag
        re.IGNORECASE
    )
    items = []
    for table in all_tables:
        if not table or len(table) < 2: continue
        # Check if this looks like a Brownes product table
        header_str = " ".join(str(c or "").lower() for c in table[0])
        if not ("nett unit" in header_str or "extended price" in header_str): continue
        # Find product description column (index of 'product description')
        desc_col = None
        for j, c in enumerate(table[0]):
            if c and "product description" in str(c).lower():
                desc_col = j
                break
        if desc_col is None: continue
        # Process data rows
        for row in table[1:]:
            if not row or desc_col >= len(row): continue
            cell = str(row[desc_col] or "").strip()
            if not cell: continue
            for line in cell.split("\n"):
                line = line.strip()
                m = UOM_PAT.match(line)
                if m:
                    items.append({
                        "description": m.group(1).strip(),
                        "quantity":    float(m.group(3)),
                        "unitPrice":   float(m.group(6)),   # Nett Unit Price
                        "lineTotal":   float(m.group(7)),   # Extended Price
                        "unit":        m.group(2).upper(),
                    })
    return items



# ─────────────────────────────────────────────────────────────────────────────
# Strategy: Spud Shed / thermal receipt format
# Lines are either:
#   DESCRIPTION   eac   PRICE Z/G          (single qty)
#   DESCRIPTION                            (start of multi-line item)
#     N each@UNIT_PRICE   TOTAL Z          (continuation — qty line)
#     NET X.XXXkg@$X.XX/kg   TOTAL Z      (continuation — weight line)
#   DESCRIPTION_OF_DISCOUNT               (indented discount label)
#     -AMOUNT                             (discount amount, no Z/G)
# ─────────────────────────────────────────────────────────────────────────────

def extract_spudshed_format(lines):
    """
    Parse Spud Shed thermal receipt lines into line items.
    Handles single-line items, multi-line (qty continuation), weight items,
    and discount lines (which are skipped as they reduce the parent item total).
    """
    # Single-line item: DESCRIPTION  eac  PRICE  Z
    single_pat = re.compile(
        r"^([A-Z].{3,50}?)\s{2,}"
        r"(?:eac|each|kg|g|L|ml|pk|pkt)\s+"
        r"([\d,]+\.\d{2})\s*[ZGzg]?\s*$",
        re.IGNORECASE
    )
    # Qty continuation: "N each@UNIT_PRICE   TOTAL Z"
    qty_cont_pat = re.compile(
        r"^\s*(\d+(?:\.\d+)?)\s+each@([\d.]+)\s+([\d,]+\.\d{2})\s*[ZGzg]?\s*$",
        re.IGNORECASE
    )
    # Weight continuation: "NET X.XXXkg@$X.XX/kg   TOTAL Z"
    weight_cont_pat = re.compile(
        r"^\s*NET\s+([\d.]+)kg@\$?([\d.]+)/kg\s+([\d,]+\.\d{2})\s*[ZGzg]?\s*$",
        re.IGNORECASE
    )
    # Discount: starts with - and a price, no Z/G
    discount_pat = re.compile(r"^\s*-(\d+\.\d{2})\s*$")

    SKIP = {"total", "eftpos", "mastercard", "debit card", "visa", "number of items",
            "gst%", "net.amt", "please retain", "for all refunds", "thank you",
            "spud shed", "spudshed", "fresh food market", "open 24", "abn",
            "phone", "tax invoice", "slip:", "staff:", "date:", "trans:",
            "description", "amount", "total savings"}

    items = []
    pending_desc = None

    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        low = line.lower()
        # Skip header/footer lines
        if any(low.startswith(s) for s in SKIP) or any(s == low for s in SKIP):
            pending_desc = None
            continue
        # Skip lines that are just a total number (e.g. "184.54")
        if re.match(r"^-?[\d,]+\.\d{2}\s*$", line):
            pending_desc = None
            continue

        # Check for discount continuation (skip — reduces parent item but we already have total)
        if discount_pat.match(line):
            pending_desc = None
            continue

        # Qty continuation
        m = qty_cont_pat.match(line)
        if m and pending_desc:
            qty = float(m.group(1))
            unit_price = float(m.group(2))
            total = clean_num(m.group(3))
            items.append({
                "description": pending_desc,
                "quantity": qty,
                "unitPrice": unit_price,
                "lineTotal": total,
                "unit": "each",
            })
            pending_desc = None
            continue

        # Weight continuation
        m = weight_cont_pat.match(line)
        if m and pending_desc:
            qty = float(m.group(1))        # net kg
            unit_price = float(m.group(2)) # $/kg
            total = clean_num(m.group(3))
            items.append({
                "description": pending_desc,
                "quantity": qty,
                "unitPrice": unit_price,
                "lineTotal": total,
                "unit": "kg",
            })
            pending_desc = None
            continue

        # Single-line item (has price on same line)
        m = single_pat.match(line)
        if m:
            desc = m.group(1).strip()
            price = clean_num(m.group(2))
            items.append({
                "description": desc,
                "quantity": 1.0,
                "unitPrice": price,
                "lineTotal": price,
                "unit": "each",
            })
            pending_desc = None
            continue

        # Lines with price at end but NO unit word — could be single item with different format
        # e.g. "POTATO SWEET GOLD (O    5.02 Z"
        m2 = re.match(r"^([A-Z].{3,50}?)\s{2,}([\d,]+\.\d{2})\s*[ZGzg]\s*$", line)
        if m2:
            desc = m2.group(1).strip()
            price = clean_num(m2.group(2))
            items.append({
                "description": desc,
                "quantity": 1.0,
                "unitPrice": price,
                "lineTotal": price,
                "unit": "each",
            })
            pending_desc = None
            continue

        # Description-only line (no price) — may have continuation on next line
        # Accept if it looks like a product name: starts uppercase, no weird chars
        if re.match(r"^[A-Z][A-Z0-9 /\(\)&\'\-\.%]{3,50}$", line) and not re.search(r"\d{6,}", line):
            pending_desc = line
            continue

        # If nothing matched and we had a pending desc, clear it
        pending_desc = None

    # Consolidate duplicate descriptions (same item bought multiple times)
    seen = {}
    for item in items:
        key = item["description"].lower()[:40]
        if key in seen:
            seen[key]["quantity"] = round(seen[key]["quantity"] + item["quantity"], 4)
            seen[key]["lineTotal"] = round((seen[key]["lineTotal"] or 0) + (item["lineTotal"] or 0), 2)
        else:
            seen[key] = dict(item)

    return list(seen.values())

# ─────────────────────────────────────────────────────────────────────────────
# Strategy 3: Word-bbox column reconstruction
# ─────────────────────────────────────────────────────────────────────────────

def extract_by_word_bbox(pages_words):
    """
    Groups PDF words by y-position into rows, then detects column layout from
    a header row, and reconstructs line items from data rows beneath it.

    Works for invoices where pdfplumber table extraction fails because there
    are no visible borders (e.g. Kakulas Brothers, Sugar Rush, Little Home Bakery).
    """
    HEADER_KEYWORDS = {
        'qty': ['qty', 'qty.', 'quantity', 'qtydelivered', 'qtyordered',
                'delivered', 'del', 'ordered'],
        'description': ['description', 'item', 'product', 'article', 'name', 'details'],
        'unit_price': ['unitprice', 'unit price', 'price', 'rate', 'cost', 'unit\nprice'],
        'line_total': ['amount', 'amountaud', 'total', 'ext.price', 'extprice',
                       'ext. price', 'linetotal', 'line total', 'extended'],
        'unit': ['unit', 'uom', 'type'],
        'code': ['code', 'sku', 'item#', 'item no', 'itemno'],
    }

    SKIP_DESC = {"total", "subtotal", "gst", "tax", "terms", "note:", "please",
                 "thank", "instructions", "payment", "bank", "bsb", "signed",
                 "received", "signature", "lic no", "page ", "email",
                 "acc #", "ph:", "fax:", "abn", "delivery", "contact",
                 "invoice to", "bill to", "deliver to", "head office",
                 "http", "www.", "due date", "reference", "subtotal"}

    def group_words_by_row(words, y_tolerance=3):
        """Group words into rows by y proximity."""
        rows = {}
        for w in words:
            y = w['top']
            matched_y = None
            for existing_y in rows:
                if abs(existing_y - y) <= y_tolerance:
                    matched_y = existing_y
                    break
            if matched_y is None:
                matched_y = y
            rows.setdefault(matched_y, []).append(w)
        # Sort each row's words by x
        return {y: sorted(ws, key=lambda w: w['x0'])
                for y, ws in sorted(rows.items())}

    def row_text(words):
        return ' '.join(w['text'] for w in words).lower().strip()

    def find_header_row(rows):
        """Find the row that looks like a column header."""
        for y, words in rows.items():
            txt = row_text(words)
            # Must have at least a description/item column AND qty/price column
            has_desc = any(k in txt for k in ['description', 'item', 'article', 'product'])
            has_num = any(k in txt for k in ['qty', 'quantity', 'price', 'amount', 'total'])
            if has_desc and has_num:
                return y, words
        return None, None

    def assign_columns_from_header(header_words):
        """
        Map column roles to x-ranges based on header word positions.
        Handles multi-word column names like "UNIT PRICE", "EXT. PRICE", "EXT PRICE".
        Returns dict: role -> (x_min, x_max)
        """
        page_width = max(w['x1'] for w in header_words) + 50

        # First, merge adjacent words that form compound column names
        # (within 20px x-distance of each other)
        merged = []
        used = set()
        sorted_hwords = sorted(header_words, key=lambda w: w['x0'])
        i = 0
        while i < len(sorted_hwords):
            if i in used:
                i += 1
                continue
            w = sorted_hwords[i]
            # Try to merge with next word if close enough
            if i + 1 < len(sorted_hwords):
                nw = sorted_hwords[i + 1]
                gap = nw['x0'] - w['x1']
                combined = (w['text'] + ' ' + nw['text']).lower()
                # Known compound headers
                if gap < 25 and any(k in combined for k in [
                    'unit price', 'ext price', 'ext. price', 'ext.price',
                    'amount aud', 'line total', 'unit total'
                ]):
                    merged.append({
                        'text': w['text'] + ' ' + nw['text'],
                        'x0': w['x0'], 'x1': nw['x1'],
                        'top': w['top']
                    })
                    used.add(i)
                    used.add(i + 1)
                    i += 2
                    continue
            merged.append(w)
            i += 1

        # Assign roles to (possibly merged) header words
        assignments = []
        for w in merged:
            txt_lower = w['text'].lower()
            x_center = (w['x0'] + w['x1']) / 2
            role = None
            for r, keywords in HEADER_KEYWORDS.items():
                if any(k in txt_lower for k in keywords):
                    role = r
                    break
            if role:
                assignments.append((x_center, w['x0'], w['x1'], role))

        if not assignments:
            return {}

        # Sort by x position
        # For duplicate roles, promote the second occurrence to 'line_total' if it's a price column
        # (handles "UNIT PRICE" + "EXT. PRICE" both mapping to unit_price)
        assignments.sort(key=lambda a: a[0])
        seen_roles = set()
        deduped = []
        for a in assignments:
            role = a[3]
            if role in seen_roles:
                # Promote second price column to line_total if line_total not yet assigned
                if role == 'unit_price' and 'line_total' not in seen_roles:
                    deduped.append((a[0], a[1], a[2], 'line_total'))
                    seen_roles.add('line_total')
            else:
                seen_roles.add(role)
                deduped.append(a)
        assignments = deduped

        # Build x-ranges: each column goes from its left edge to the next column's left - 1
        col_ranges = {}
        for i, (xc, x0, x1, role) in enumerate(assignments):
            if i + 1 < len(assignments):
                next_x0 = assignments[i + 1][1]
                col_ranges[role] = (x0 - 5, next_x0 - 1)
            else:
                col_ranges[role] = (x0 - 5, page_width)

        return col_ranges

    def get_cell_value(row_words, x_min, x_max):
        """Collect all words whose center falls in [x_min, x_max]."""
        parts = []
        for w in row_words:
            cx = (w['x0'] + w['x1']) / 2
            if x_min <= cx <= x_max:
                parts.append(w['text'])
        return ' '.join(parts).strip() if parts else None

    def get_numeric_cell(row_words, x_min, x_max):
        """Get numeric value from a cell — picks the first/only number, ignores text like GSTFree."""
        parts = []
        for w in row_words:
            cx = (w['x0'] + w['x1']) / 2
            if x_min <= cx <= x_max:
                # Only include words that look like numbers
                cleaned = re.sub(r'[,$]', '', w['text'])
                if re.match(r'^-?\d+\.?\d*$', cleaned):
                    parts.append(cleaned)
        if parts:
            try: return float(parts[0])
            except: return None
        return None

    line_items = []

    for page_words in pages_words:
        if not page_words:
            continue

        rows = group_words_by_row(page_words)
        header_y, header_words = find_header_row(rows)
        if header_y is None:
            continue

        col_ranges = assign_columns_from_header(header_words)
        if not col_ranges:
            continue

        # Iterate rows below the header
        for y, row_words in rows.items():
            if y <= header_y:
                continue

            # Skip rows that are clearly totals/footers
            txt = row_text(row_words)
            if any(txt.startswith(s) for s in SKIP_DESC):
                continue
            if any(s in txt for s in ['subtotal', 'total aud', 'totalaud', 'due date',
                                        'amount due', 'gst total', 'total gst']):
                continue

            # Extract each column
            desc_val = get_cell_value(row_words, *col_ranges['description']) if 'description' in col_ranges else None
            code_val = get_cell_value(row_words, *col_ranges['code'])        if 'code'        in col_ranges else None
            qty      = get_numeric_cell(row_words, *col_ranges['qty'])       if 'qty'         in col_ranges else None
            unit_price = get_numeric_cell(row_words, *col_ranges['unit_price']) if 'unit_price' in col_ranges else None
            line_total = get_numeric_cell(row_words, *col_ranges['line_total']) if 'line_total' in col_ranges else None
            unit_val = get_cell_value(row_words, *col_ranges['unit'])        if 'unit'        in col_ranges else None

            # Skip code-only rows (continuation of previous item's code overflow)
            if code_val and not desc_val and qty is None and unit_price is None:
                continue

            # Need at least a description
            if not desc_val or len(desc_val) < 2:
                continue

            # Clean description: strip leading SKU/code (ALL-CAPS, no spaces, like PARSLEY5K)
            # These appear when the 'code' column x-range overlaps with description
            desc_val = re.sub(r'^[A-Z0-9]{3,15}\s+', '', desc_val).strip()  # leading code e.g. PARSLEY5K
            # Strip trailing article codes (e.g. " CS4", " CR8", " GFBA01")
            desc_val = re.sub(r'\s+[A-Z]{1,3}\d{1,6}$', '', desc_val).strip()  # e.g. CS4, CR8
            desc_val = re.sub(r'\s+[A-Z]{2,8}\d{2,6}$', '', desc_val).strip()  # e.g. GFBA01, GFT02

            # Skip rows that are just header continuation or addresses
            if desc_val.lower() in ('item', 'description', 'article', 'product',
                                     'the deli by greenhorns', 'greenhorns'):
                continue
            if re.match(r'^[\d\s\.,\$\-]+$', desc_val):
                continue
            if any(desc_val.lower().startswith(s) for s in SKIP_DESC):
                continue

            # Need at least one numeric value to be a real line item
            if qty is None and unit_price is None and line_total is None:
                continue

            # Normalise unit
            unit_clean = unit_val.strip().upper() if unit_val else None
            if unit_clean in ('GST', 'N-T', 'NT', 'GST FREE', 'GSTFREE', 'N/A', '0%', '10%', 'DISC.'):
                unit_clean = None

            # Re-space concatenated words (PDFs without proper character spacing)
            desc_val = respace_text(desc_val)

            line_items.append({
                'description': desc_val,
                'quantity':   qty,
                'unitPrice':  unit_price,
                'lineTotal':  line_total,
                'unit':       unit_clean,
            })

    return line_items


# ─────────────────────────────────────────────────────────────────────────────
# Strategy 4: MarketBase / Etherington printed-email format
# ─────────────────────────────────────────────────────────────────────────────

def extract_marketbase_format(lines):
    """
    Handle the MarketBase/fpaa.net.au printed-email invoice format used by
    suppliers like Etherington.  The PDF is a printed webmail page with no
    table borders.

    The line items are split across multiple raw lines:
      Line 1 (may start with item code): "60063128- CAGE CATERING 700G XL"
      Line 2 (qty row):                  "3 CTN 15.00DOZ 85.00 CTN 255.00"
      Line 3 (description overflow):     "5 EGG"

    Qty-row pattern: <qty> CTN <doz_qty>DOZ <price_ctn> CTN <total>
    (Note: pdfplumber may merge DOZ/CTN with adjacent numbers — no space before DOZ/CTN)

    Also handles simpler: DESCRIPTION  <qty> <unit>  <unit_price>  <total>
    """
    line_items = []

    SKIP_WORDS = ('total', 'subtotal', 'gst', 'tax', 'amount due', 'balance',
                  'payment', 'thank', 'please', 'note', 'terms', 'print', 'close',
                  'produce total', 'invoice total')

    # --- Pass 1: find qty-rows (the numeric CTN/DOZ rows) and pair with neighbours ---
    # Qty-row: starts with a number, contains CTN and (DOZ or KG or EA), ends with a price
    # e.g. "3 CTN 15.00DOZ 85.00 CTN 255.00"  or  "3 CTN 15.00 DOZ 85.00 CTN 255.00"
    qty_row_pat = re.compile(
        r'^(\d+(?:\.\d+)?)\s*CTN\s+'
        r'(\d+(?:\.\d+)?)\s*DOZ\s+'
        r'(\d+(?:\.\d+)?)\s*CTN\s+'
        r'\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*$',
        re.IGNORECASE
    )

    # Item code prefix: e.g. "60063128-" or "60063128 " at start of description line
    item_code_pat = re.compile(r'^\d{5,}-?\s*')

    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        low = line.lower()
        if any(low.startswith(s) for s in SKIP_WORDS):
            continue

        m = qty_row_pat.match(line)
        if m:
            qty_ctn   = clean_num(m.group(1))
            # group(2) = doz qty (pack count) — informational
            price_ctn = clean_num(m.group(3))   # price per CTN
            total     = clean_num(m.group(4))

            # Build description from the preceding line(s) + any overflow on the NEXT line
            # Preceding line: strip item code prefix, skip noise
            desc_parts = []
            if i > 0:
                prev = lines[i - 1].strip()
                prev_clean = item_code_pat.sub('', prev).strip()
                prev_clean = re.sub(r'-$', '', prev_clean).strip()   # trailing hyphen
                low_prev = prev_clean.lower()
                if prev_clean and not any(low_prev.startswith(s) for s in SKIP_WORDS):
                    if not re.match(r'^[\d\s\.\,]+$', prev_clean):   # not purely numeric
                        desc_parts.append(prev_clean)

            # Next line: may be description overflow (short text, no numbers or just small number)
            if i + 1 < len(lines):
                nxt = lines[i + 1].strip()
                low_nxt = nxt.lower()
                # Accept if: short text, not another qty row, not a total/noise line
                if (nxt and len(nxt) < 50
                        and not qty_row_pat.match(nxt)
                        and not any(low_nxt.startswith(s) for s in SKIP_WORDS)
                        and not re.match(r'^[\d]{4,}', nxt)   # not another item code
                        and not re.match(r'^https?://', nxt, re.I)):
                    # Strip leading digits (e.g. "5 EGG" → keep as overflow)
                    overflow = re.sub(r'^\d+\s+', '', nxt).strip()
                    if overflow:
                        desc_parts.append(overflow)

            if not desc_parts:
                continue

            desc = ' '.join(desc_parts).strip()
            desc = re.sub(r'\s+', ' ', desc)

            if len(desc) < 3:
                continue
            if any(s in desc.lower() for s in SKIP_WORDS):
                continue

            line_items.append({
                'description': desc,
                'quantity':   qty_ctn,
                'unitPrice':  price_ctn,
                'lineTotal':  total,
                'unit':       'CTN',
            })
            continue

    # --- Pass 2: simpler pattern — DESCRIPTION  qty UNIT  unit_price  total ---
    if not line_items:
        qty_unit_price_pat = re.compile(
            r'^(.+?)\s+'
            r'(\d+(?:\.\d+)?)\s+([A-Z]{2,6})\s+'
            r'\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s+'
            r'\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*$',
            re.IGNORECASE
        )
        for line in lines:
            line = line.strip()
            if not line or len(line) < 5:
                continue
            low = line.lower()
            if any(low.startswith(s) for s in SKIP_WORDS):
                continue
            if any(s in low for s in ('total', 'subtotal')):
                continue
            m2 = qty_unit_price_pat.match(line)
            if m2:
                desc = m2.group(1).strip()
                if len(desc) < 3:
                    continue
                if any(s in desc.lower() for s in SKIP_WORDS):
                    continue
                qty = clean_num(m2.group(2))
                unit = m2.group(3).strip().upper()
                unit_price = clean_num(m2.group(4))
                total = clean_num(m2.group(5))
                # Sanity check: unit_price * qty ≈ total (within 15%)
                if qty and unit_price and total:
                    calc = qty * unit_price
                    if calc > 0 and abs(calc - total) / total > 0.15:
                        continue
                line_items.append({
                    'description': desc,
                    'quantity':   qty,
                    'unitPrice':  unit_price,
                    'lineTotal':  total,
                    'unit':       unit,
                })

    return line_items


# ─────────────────────────────────────────────────────────────────────────────
# Noise stripping for printed-email PDFs
# ─────────────────────────────────────────────────────────────────────────────

def strip_webmail_noise(lines):
    """
    Remove lines that are browser/webmail print artefacts:
      - "Print" / "Close" / "Support" buttons
      - URLs (lines starting with http/https)
      - Timestamp lines like "15/04/2026, 19:16" or "15/04/2026, 21:43 My Warehouse Receipts"
      - Email header lines: From:, To:, Subject:, Date: (but save From: for supplier extraction)
      - Costco receipt header: "My Warehouse Receipts", "In-Warehouse Receipt"
      - Member number lines: "Member XXXXXXXXXX"
    Returns (clean_lines, from_line) where from_line is the raw "From: ..." value if found.
    """
    clean = []
    from_line = None
    # Email header labels we want to strip (but harvest From:)
    email_headers = ('to:', 'cc:', 'bcc:', 'subject:', 'date:', 'sent:')
    # Single-word noise buttons
    noise_exact = {'print', 'close', 'support'}
    # Line-start noise patterns
    noise_starts = (
        'my warehouse receipts',
        'in-warehouse receipt',
        'member ',       # Costco member number
    )

    for line in lines:
        stripped = line.strip()
        # Strip unicode private-use area chars (e.g. Costco icon \ue887)
        stripped = re.sub(r'[\ue000-\uf8ff]', '', stripped).strip()
        low = stripped.lower()

        # Blank after cleanup
        if not stripped:
            continue

        # Browser print timestamp: starts with date+time pattern
        # e.g. "15/04/2026, 21:43 My Warehouse Receipts" or "15/04/2026, 19:16"
        if re.match(r'^\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4},?\s+\d{1,2}:\d{2}', stripped):
            continue

        # URL lines
        if re.match(r'^https?://', stripped, re.IGNORECASE):
            continue

        # Noise exact words
        if low in noise_exact:
            continue

        # Noise line starts
        if any(low.startswith(s) for s in noise_starts):
            continue

        # Email From: — harvest supplier name, then strip
        if low.startswith('from:'):
            from_line = stripped[5:].strip()   # everything after "From:"
            continue

        # Other email headers — strip
        if any(low.startswith(h) for h in email_headers):
            continue

        clean.append(stripped)

    return clean, from_line


def extract_supplier_from_from_line(from_line):
    """
    Extract supplier name from a 'From:' email header value.
    Examples:
      "Etherington (admin@etherington.org)" → "Etherington"
      "Kakulas Brothers <info@kakulas.com.au>" → "Kakulas Brothers"
      "admin@supplier.com.au" → None  (just an address, no name)
    """
    if not from_line:
        return None
    # "Name (email@...)" format
    m = re.match(r'^([^(<]+?)\s*[\(<]', from_line)
    if m:
        name = m.group(1).strip().strip('"\'')
        if name and len(name) > 2 and not re.match(r'^[\w._%+-]+@', name):
            return name
    # "Name <email>" format
    m2 = re.match(r'^"?([^"<]+)"?\s*<', from_line)
    if m2:
        name = m2.group(1).strip()
        if name and len(name) > 2:
            return name
    return None



# ─────────────────────────────────────────────────────────────────────────────
# Strategy: Bidfood / wholesale distributor format
# Columns: Brand Code | Product Description | Pack Size | Unit of Measure |
#          Cartons Supplied | Units Supplied | Total Units | Unit Price |
#          Excl. GST Value | GST Value | Total Value
# Detected by: "bidfood" in text OR "cartons supplied" in text OR
#              column header pattern matching "Unit Excl. GST"
# Line format (pdfplumber table): each product row has a product code and description
# ─────────────────────────────────────────────────────────────────────────────

def extract_bidfood_format(pages):
    """
    Parse Bidfood invoice line items from pdfplumber pages.
    Returns list of dicts with description, quantity (cartons), packSize,
    packsPerCarton, unit, unitPrice, lineTotal.
    packSize comes from the Pack Size column (e.g. "12\'s", "1kg"),
    packsPerCarton from "CTN=6" or "BAG=1" in Unit of Measure,
    cartons from Cartons Supplied column,
    unitPrice from Unit Price column (Excl. GST),
    lineTotal from Excl. GST Value column.
    """
    SKIP_DESC = (
        'frozen', 'chiller', 'dry', 'summary', 'carton counts', 'type comment',
        'signature', 'payment', 'sale subject', 'bidfood', 'total', 'totals',
        'we are aware', 'bidfood is absorbing', 'rising fuel', 'off introducing',
        'that prices', 'expected and costs', 'but we will',
        '*', '=', '-',
    )
    # Parse Bidfood lines by anchoring from the right (numeric columns are fixed).
    # Format: CODE  DESC+BRAND  PACKSIZE  CTN=X  cartons  units  unitprice  exclGST  GST  totalValue
    # Strategy: strip trailing numeric columns first, then find CTN=/BAG= to split
    # desc+brand from pack size, then split desc from brand by the brand column width (~10 chars).
    #
    # Right-anchored pattern: captures the 7 trailing numeric columns + CTN= + pack size.
    # Everything before is "code + desc + brand".
    right_pat = re.compile(
        r'^(\d{4,8})'                           # group 1: item code
        r'\s+'
        r'(.+?)'                                 # group 2: desc+brand (lazy, before pack size)
        r'\s+'
        r'(\d+x\d+(?:gr|g|kg|l|ml)?|\d+\'s|\d+(?:\.\d+)?(?:kg|g|l|lt|ml|ltr|gr)?)' # group 3: pack size
        r'\s+'
        r'(CTN=\d+|BAG=\d+|EA=\d*|\w+=\d+)'    # group 4: unit of measure
        r'\s+'
        r'(\d+(?:\.\d+)?)'                       # group 5: cartons supplied
        r'\s+'
        r'(\d+(?:\.\d+)?)'                       # group 6: units supplied (may equal cartons)
        r'\s+'
        r'([\d]+\.\d{2})'                        # group 7: unit price (Excl. GST — ignored)
        r'\s+'
        r'([\d]+\.\d{2})'                        # group 8: excl. GST value (ignored)
        r'\s+'
        r'([\d]+\.\d{2})'                        # group 9: GST value (ignored)
        r'\s+'
        r'([\d]+\.\d{2})'                        # group 10: TOTAL VALUE incl. GST ← use this
        r'\s*$',
        re.IGNORECASE
    )

    items = []
    for page in pages:
        text = page.extract_text() or ''
        for line in text.split('\n'):
            line = line.strip()
            if not line:
                continue
            low = line.lower()
            if any(low.startswith(s) for s in SKIP_DESC) or '***' in line:
                continue

            m = right_pat.match(line)
            if not m:
                continue

            desc_brand    = m.group(2).strip()   # e.g. "CHIPS 10MM STRAIGHT CUT WA CHIP"
            pack_size_str = m.group(3).strip()   # e.g. "15kg", "120x43gr"
            unit_measure  = m.group(4).strip()   # e.g. "CTN=1", "BAG=1"
            cartons       = float(m.group(5))
            total_value   = float(m.group(10))   # Total Value incl. GST
            unit_price    = round(total_value / cartons, 4) if cartons else total_value

            # Split desc_brand into description + brand.
            # Bidfood invoice layout: desc column followed by brand column.
            # When pdfplumber merges them, brand appears as the last word(s) in desc_brand.
            # Brand column is ~10 chars wide — brand words are typically short (truncated).
            # Strategy: try peeling off the last 1 or 2 words as brand.
            # The last word is almost always the brand (or the 2nd-last + last for 2-word brands).
            # Generic description words that should NOT be treated as brand:
            GENERIC_WORDS = {
                'FREE', 'CUT', 'PACK', 'LARGE', 'MINI', 'FRESH', 'DRIED',
                'SLICED', 'WHOLE', 'DICED', 'FROZEN', 'RAW', 'COOKED',
                'NATURAL', 'ORGANIC', 'LIGHT', 'DARK', 'SMOKED', 'MIXED',
                'SELECTION', 'VARIETY', 'ASSORTED', 'PLAIN', 'FLAVOURED',
                'INSTANT', 'REGULAR', 'EXTRA', 'THICK', 'THIN', 'FINE',
                'FINE', 'SPRAY', 'SAUCE', 'OIL', 'SWEET', 'GLUTEN',
                'DAIRY', 'VEGAN', 'GRATED', 'RTB', 'COLOUR', 'TRI',
                'NO', 'IN', 'OF', 'AND', 'THE', '&',
            }
            brand_name = None
            description = desc_brand
            words = desc_brand.split()
            # Only try to split if there are enough words for both desc and brand
            if len(words) >= 3:
                # Bidfood brand column is ~10 chars wide. Brands are truncated short words.
                # The last word is typically the brand. Some brands are 2 words (e.g. "WA CHIP",
                # "SAN REMO", "CATERERS C", "WOMBAT VAL") but always ≤12 chars TOTAL.
                # Strategy: prefer last word as brand; try last 2 words only if combined ≤12 chars.
                last2 = ' '.join(words[-2:])
                last1 = words[-1]
                remaining2 = words[:-2]
                remaining1 = words[:-1]
                # A brand word: uppercase only, not purely generic, ≤12 chars
                def word_could_be_brand(w):
                    return (
                        w.upper() == w and
                        w.rstrip("'.") not in GENERIC_WORDS and
                        len(w) <= 12 and
                        len(w) >= 1
                    )
                last1_is_brand = word_could_be_brand(last1)
                # Try 2-word brand only if BOTH are brand-like AND combined fits in brand column (≤12 chars)
                last2_is_brand = (
                    len(words) >= 4 and
                    word_could_be_brand(words[-2]) and
                    last1_is_brand and
                    len(last2) <= 12 and
                    len(remaining2) >= 1
                )
                if last2_is_brand:
                    description = ' '.join(remaining2)
                    brand_name = last2
                elif last1_is_brand and len(remaining1) >= 1:
                    description = ' '.join(remaining1)
                    brand_name = last1

            # Parse packs per carton from unit_measure
            packs_per_carton_match = re.search(r'=(\d+)', unit_measure)
            packs_per_carton = int(packs_per_carton_match.group(1)) if packs_per_carton_match else 1

            # Parse pack size value and unit (handles "120x43gr", "1kg", "12's", etc.)
            # Handle XxY format (e.g. 120x43gr → packSize=43, packUnit=gr, packsPerCarton override=120)
            xpack_match = re.match(r'^(\d+)x(\d+(?:\.\d+)?)(gr|g|kg|l|lt|ml|ltr|each)?$', pack_size_str, re.IGNORECASE)
            if xpack_match:
                packs_per_carton = int(xpack_match.group(1))
                pack_size_val = float(xpack_match.group(2))
                raw_unit = (xpack_match.group(3) or 'each').lower()
                pack_size_unit = 'g' if raw_unit == 'gr' else raw_unit
            else:
                ps_match = re.match(r"(\d+(?:\.\d+)?)(kg|g|l|lt|ml|ltr|'s|s)?", pack_size_str, re.IGNORECASE)
                pack_size_val = float(ps_match.group(1)) if ps_match else None
                pack_size_unit = ps_match.group(2).lower() if ps_match and ps_match.group(2) else "each"
                if pack_size_unit in ("'s", "s"):
                    pack_size_unit = "each"

            item = {
                'description':     description,
                'quantity':        cartons,
                'unitPrice':       unit_price,
                'lineTotal':       total_value,  # Total Value incl. GST
                'unit':            unit_measure,
                'cartonsSupplied': cartons,
                'packsPerCarton':  packs_per_carton,
                'packSize':        pack_size_val,
                'packUnit':        pack_size_unit,
            }
            if brand_name:
                item['brandName'] = brand_name
            items.append(item)

    return items

# ─────────────────────────────────────────────────────────────────────────────
# Strategy: Campbells / Metcash wholesale format
# Line items look like:
#   N    ITMNO  DESCRIPTION  PACK  [LS]  INCL.GST  EXCL.GST  RATE  GST_AMT  UOS  ORD_QTY  SUP_QTY  EXTEN.PR  WET ...
#   1    125208 S/HURST PEPPER STRP R/RED4.2KG    3       66.54    66.54  0.00     0.00  CS      1       1       66.54       32.65
# Detected by: header line contains "ITM NO." and "ITEM DESCRIPTION" and "EXCL.GST"
# ─────────────────────────────────────────────────────────────────────────────

def extract_campbells_format(lines):
    """
    Parse Campbells/Metcash wholesale invoice text into line items.
    Each item line is fixed-width, starting with a row number then item code.
    Key columns: description, EXCL.GST (unit price per unit), UOS (unit),
                 SUP QTY (delivered qty), EXTEN.PR (line total).
    Skip VISA SURCHARGE (item 499877) and footer/header lines.
    Also skips TRANSACTION VOID receipts (still extracts items if present).
    """
    # Pattern for a data line:
    # N  ITMNO  DESCRIPTION  PACK  [LS]  INCL.GST  EXCL.GST  RATE  GST_AMT  UOS  ORD_QTY  SUP_QTY  EXTEN.PR  ...
    # The numbers after DESCRIPTION are: PACK (int), then optionally LS (1 or 2 chars), then 4 price cols, then UOS, then 2 qty cols, then EXTEN.PR
    # Since pdfplumber merges the numbers, we parse by a broad regex:
    # Row: starts with digits (N), then 6-digit item code, then description text, then the numeric columns

    SKIP_ITMNO = {'499877'}  # VISA SURCHARGE

    SKIP_DESC_STARTS = (
        'total', 'subtotal', 'gst', 'tax invoice', 'web tender', 'eft on line',
        'gst-free', 'gst included', 'orders can be', 'payment by', 'all requests',
        'this invoice', 'metcash', 'campbells', 'sign up', 'national range',
        'new thursday', 'extended trading', '** orders', 'this branch',
        'commonwealth bank', 'eftpos', 'canning vale cash', 'terminal', 'reference',
        'customer copy', 'card no', 'expiry', 'aid:', 'atc:', 'csn:', 'visa debit',
        'credit', 'purchase', 'approved', 'auth no', 'pos ref',
        '---', 'itm no', 'ship to', 'bill to', 'a.c.n', 'a.b.n', 'cust no',
        'osborne park', 'u 9a', 'unit 9a', 'tobacco lic', 'order no', 'customer ref',
        'instructions', 'baile rd', 'balcatta', 'canningvale', 'cust group',
    )

    # Line item regex:
    # Group 1: row number (N)
    # Group 2: item code (6+ digits)
    # Group 3: description + pack embedded in text, up to first whitespace-padded number block
    # We use a broad pattern matching the structure:
    #   N  CODE  DESCRIPTION-TEXT  PACK  [optional S]  price1  price2  rate  gst  UOS  ordqty  supqty  exten.pr  ...
    #
    # Since the description may contain digits (e.g. 4.2KG, 1.5KG, 2.6KG),
    # we anchor on the trailing columns which always follow a strict numeric pattern.
    # The last known columns from the right are: EXTEN.PR  WET [optional]
    # So we match from the right: ...  SUP_QTY  EXTEN.PR  [WET]
    # And from the left: N  ITMNO  ...
    #
    # Full pattern (flexible whitespace):
    line_pat = re.compile(
        r'^'                              # start
        r'(\d{1,3})'                      # group 1: row number N
        r'\s+'
        r'(\d{5,8})'                      # group 2: item code
        r'\s+'
        r'(.+?)'                          # group 3: description (lazy)
        r'\s+'
        r'(\d{1,2})'                      # group 4: PACK (pack size, small int)
        r'(?:\s+[A-Z]{1,2})?'            # optional LS flag (e.g. "S")
        r'\s+'
        r'([\d]+\.\d{2})'               # group 5: INCL.GST
        r'\s+'
        r'([\d]+\.\d{2})'               # group 6: EXCL.GST = unit price
        r'\s+'
        r'([\d]+\.\d{2})'               # group 7: RATE (GST rate)
        r'\s+'
        r'([\d]+\.\d{2})'               # group 8: GST AMT
        r'\s+'
        r'([A-Z]{2,4})'                  # group 9: UOS (CS, EA, etc.)
        r'\s+'
        r'(\d+(?:\.\d+)?)'               # group 10: ORD QTY
        r'\s+'
        r'(\d+(?:\.\d+)?)'               # group 11: SUP QTY (delivered)
        r'(?:\s+[A-Z])?'                  # optional short flag after sup qty (e.g. "S")
        r'\s+'
        r'([\d]+\.\d{2})'               # group 12: EXTEN.PR = line total
        r'(?:\s+[\d]+\.\d{2})?'         # optional WET column
        r'\s*$',
        re.IGNORECASE
    )

    items = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        low = line.lower()
        if any(low.startswith(s) for s in SKIP_DESC_STARTS):
            continue

        m = line_pat.match(line)
        if not m:
            continue

        item_code = m.group(2)
        if item_code in SKIP_ITMNO:
            continue  # skip VISA SURCHARGE

        description = m.group(3).strip()
        excl_gst = float(m.group(6))   # unit price (excl. GST)
        uos = m.group(9).upper()        # unit
        sup_qty = float(m.group(11))    # delivered qty
        exten_pr = float(m.group(12))   # line total

        if not description or len(description) < 2:
            continue

        # Clean description: remove trailing item code / LS marker if it crept in
        description = re.sub(r'\s+[A-Z]{1,2}$', '', description).strip()

        items.append({
            'description': description,
            'quantity':    sup_qty,
            'unitPrice':   excl_gst,
            'lineTotal':   exten_pr,
            'unit':        uos,
        })

    return items


# ─────────────────────────────────────────────────────────────────────────────
# Strategy 5 (new): Costco in-warehouse receipt format
# ─────────────────────────────────────────────────────────────────────────────

def extract_costco_format(lines):
    """
    Handle Costco in-warehouse receipt format.

    Each item repeats in a 3-line cycle:
      Line A: DESCRIPTION        e.g. "KS LAMB LEG BONELESS"
      Line B: shelf/meta info    e.g. "SELL ITEM SL7", "C8/L64/P256/D256 SL37"
                                 (may be multiple lines: "L6 P216 D324 SL273")
      Line C: data row           e.g. "13087 1x 51.94 51.94 0"

    TPD discount blocks immediately follow their parent item:
      "TPD PRODUCT NAME"         — description of the TPD rebate
      "CODE TPD 16/03-12/04"     — OR — "CODE MVM 16/03-12/04"  (skip)
      "262137 6x 2.00 12.00 - 0"  — data row with " - " flag = rebate

    Same product purchased multiple times appears as repeated blocks.
    We consolidate them: sum qty and line totals, keep one entry per description.

    GST flag: 0 = GST-free, 1 = GST applicable.
    """

    # Data row: CODE  Nx  UNIT_PRICE  LINE_TOTAL  ['-']  GST_FLAG
    data_row_pat = re.compile(
        r'^(\d{4,8})\s+(\d+)x\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(-\s+)?(\d)$'
    )

    # Skip lines: shelf/location codes, TPD date rows, totals, addresses
    # Shelf patterns: e.g. "SELL ITEM SL7", "C8/L64/P256/D256 SL37",
    #                      "L6 P216 D324 SL273", "P432/D550", "L10P50",
    #                      "132CT P30", "L20/P100/D100 (152242)", "11.34KG ECOMM"
    #                      "CLING FILM L30P300 ECOMM"  ← secondary description line
    shelf_pat = re.compile(
        r'^('
        r'SELL\s+ITEM'           # "SELL ITEM SL7"
        r'|[A-Z]\d+/[A-Z]\d+'   # "C8/L64" type
        r'|[A-Z]\d+\s'          # "L6 P216" type
        r'|\d+CT\s'             # "132CT P30"
        r'|\d+\.\d+KG'          # "11.34KG ECOMM"
        r'|L\d+P\d+'            # "L10P50"
        r'|MP\d+\s'             # "MP6 L48"
        r'|P\d+/'               # "P432/D550"
        r')',
        re.IGNORECASE
    )

    # TPD/MVM date-skip rows: "227477 16/03-12/04/26 TPD" or "11352 TPD 16/03-12/04"
    #                          "141886 MVM 16/03-12/04"
    tpd_date_pat = re.compile(
        r'^\d{4,8}\s+'
        r'(\d{1,2}/\d{2}-\d{1,2}/\d{2}|TPD|MVM)'
    )

    # TPD description lines to skip (they introduce the rebate block)
    tpd_desc_pat = re.compile(r'^TPD\s+', re.IGNORECASE)

    SKIP_CONTENT = (
        'tax invoice', 'abn no', 'abn :', 'costco wholesale', '142 dunreath',
        'perth airport', 'wa 6105', 'total (incl', 'total (excl', 'gst amount',
        'visa debit', 'mastercard', 'eftpos', 'cash', 'gst code',
        'total number of items', 'items sold:', '****',
    )

    # --- Pass 1: extract raw (description, qty, unit_price, line_total, is_discount) tuples ---
    raw_items = []   # list of dicts with description, qty, unit_price, line_total, is_discount
    desc_candidate = None
    pending_tpd = False   # True when we just saw a TPD desc line; next data row is a discount

    for line in lines:
        low = line.lower()

        # Skip known totals / addresses / noise
        if any(s in low for s in SKIP_CONTENT):
            continue

        # Skip TPD/MVM date-reference rows
        if tpd_date_pat.match(line):
            continue

        # Data row?
        m = data_row_pat.match(line)
        if m:
            qty        = int(m.group(2))
            unit_price = clean_num(m.group(3))
            line_total = clean_num(m.group(4))
            is_discount = bool(m.group(5))

            if desc_candidate is not None and unit_price is not None and line_total is not None:
                raw_items.append({
                    'description': desc_candidate,
                    'quantity':    qty,
                    'unitPrice':   unit_price,
                    'lineTotal':   line_total,
                    'isDiscount':  is_discount or pending_tpd,
                })
            desc_candidate = None
            pending_tpd = False
            continue

        # TPD description line (e.g. "TPD NUTTELEX BUTTERY 2KG")
        if tpd_desc_pat.match(line):
            # The next data row is a rebate for the immediately preceding product
            # Strip the "TPD " prefix to get the product name for matching
            desc_candidate = line[4:].strip()   # keep name for matching
            pending_tpd = True
            continue

        # Skip shelf/location lines
        if shelf_pat.match(line):
            continue

        # Skip purely numeric / date-like lines
        if re.match(r'^[\d\s\.\,\-\/:%]+$', line):
            continue
        if len(line) < 3:
            continue

        # Must look like an ALL-CAPS product name (letters, numbers, spaces, common punctuation)
        # Reject lines that are clearly secondary info (contain only code-like tokens)
        if re.match(r'^[A-Z0-9 \./\-&\'%\(\)\*]+$', line):
            # Extra rejection: lines that are clearly shelf/code info
            # (e.g. "CLING FILM L30P300 ECOMM" has recognizable shelf code pattern)
            # Accept if it has at least 2 words that look like real words (3+ alpha chars each)
            words = line.split()
            real_words = [w for w in words if re.match(r'^[A-Z]{3,}$', w)]
            if len(real_words) >= 1:
                desc_candidate = line
                pending_tpd = False

    # --- Pass 2: consolidate same-description items, apply TPD discounts ---
    # Group by description (case-insensitive), sum qty and lineTotal, average unitPrice
    # For discounts: apply to the most recent non-discount entry for the same product
    consolidated = {}   # description_key -> dict
    order = []          # insertion order

    for item in raw_items:
        desc = item['description']
        key = desc.upper().strip()

        if item['isDiscount']:
            # Find the most recent non-discount entry whose key contains this key or vice versa
            match_key = None
            for k in reversed(order):
                if key in k or k in key:
                    match_key = k
                    break
            if match_key:
                existing = consolidated[match_key]
                # Apply the discount exactly as stated on this receipt line.
                # Each TPD row represents the rebate for one purchase of the item,
                # so we subtract item['lineTotal'] once (not multiplied by purchase_count).
                existing['lineTotal'] = round(existing['lineTotal'] - item['lineTotal'], 2)
                existing['unitPrice'] = round(
                    existing['lineTotal'] / existing['quantity'], 4
                ) if existing['quantity'] else existing['unitPrice']
            # If no match, discard the orphan discount
        else:
            if key in consolidated:
                # Same item purchased again — consolidate
                consolidated[key]['quantity']  += item['quantity']
                consolidated[key]['lineTotal']  = round(consolidated[key]['lineTotal'] + item['lineTotal'], 2)
                consolidated[key]['_purchase_count'] = consolidated[key].get('_purchase_count', 1) + 1
                # Recalc unit price from consolidated totals
                consolidated[key]['unitPrice'] = round(
                    consolidated[key]['lineTotal'] / consolidated[key]['quantity'], 4
                )
            else:
                entry = {
                    'description': desc,
                    'quantity':    item['quantity'],
                    'unitPrice':   item['unitPrice'],
                    'lineTotal':   item['lineTotal'],
                    'unit':        'ea',
                    '_purchase_count': 1,
                }
                consolidated[key] = entry
                order.append(key)

    # Return in order, dropping internal _purchase_count
    result = []
    for k in order:
        e = consolidated[k]
        result.append({
            'description': e['description'],
            'quantity':    e['quantity'],
            'unitPrice':   e['unitPrice'],
            'lineTotal':   e['lineTotal'],
            'unit':        e['unit'],
        })
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Main parser
# ─────────────────────────────────────────────────────────────────────────────

def parse_invoice(pdf_path, original_filename=None, original_image_path=None):
    import pdfplumber

    text_pages = []
    all_tables = []
    all_pages_words = []   # list of word-dicts per page (for Strategy 3)

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text() or ""
            text_pages.append(t)
            tbls = page.extract_tables() or []
            all_tables.extend(tbls)
            words = page.extract_words() or []
            all_pages_words.append(words)

    full_text = "\n".join(text_pages)

    # Vision OCR fallback: if pdfplumber got no text (photo/image receipt),
    # use Claude vision to extract text from the original image
    if not full_text.strip() and original_image_path and os.path.exists(original_image_path):
        full_text = ocr_image_with_vision(original_image_path)

    raw_lines = [l.strip() for l in full_text.split("\n") if l.strip()]

    # Strip webmail/print noise and capture From: line
    lines, from_line = strip_webmail_noise(raw_lines)

    # ── Supplier name ─────────────────────────────────────────────────────────
    supplier_name = None

    # 0. From "From:" email header (highest priority for webmail invoices)
    if from_line:
        supplier_name = extract_supplier_from_from_line(from_line)

    # 0.5. Detect known suppliers by domain / keywords in invoice text (beats filename)
    _ft_lower = full_text.lower()
    _known_suppliers = [
        ('delbasso.com',        'Del Basso Smallgoods'),
        ('del basso smallgoods', 'Del Basso Smallgoods'),
        ('sugarrushwa',         'Sugar Rush WA'),
        ('sugar rush',          'Sugar Rush WA'),
        ('littlehomebakery',    'Little Home Bakery'),
        ('little home bakery',  'Little Home Bakery'),
        ('wardpackaging.com',   'Ward Packaging'),
        ('ward packaging',      'Ward Packaging'),
        ('brewcoffeeroasters',  'Brew Coffee Roasters'),
        ('brew coffee roasters','Brew Coffee Roasters'),
        ('wh-food.com',         'Wing Hong Food'),
        ('wh.sales@',           'Wing Hong Food'),
        ('wing hong',           'Wing Hong Food'),
        ('kakulas',             'Kakulas Brothers'),
        ('b&e foods',           'B&E Foods Perth'),
        ('befoods.com',         'B&E Foods Perth'),
        ('fresh express',       'Fresh Express Produce'),
        ('spudshed',            'Spud Shed'),
    ]
    if not supplier_name:
        for keyword, name in _known_suppliers:
            if keyword in _ft_lower:
                supplier_name = name
                break

    # 1. From filename (most reliable for regular files)
    if not supplier_name and original_filename:
        base = original_filename
        for ext in ['.pdf', '.PDF', '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.gif', '.webp']:
            base = base.replace(ext, '').replace(ext.upper(), '')
        parts = re.split(r'_', base)
        name_parts = []
        for p in parts:
            p = p.strip()
            if re.match(r'^\d{4}-', p): break
            if re.match(r'^\d+[\.,]\d+$', p): break
            if re.match(r'^\d+$', p): continue
            name_parts.append(p)
        if name_parts:
            raw = ' '.join(name_parts)
            candidate = re.sub(r'-', ' ', raw).strip()
            # Skip if filename is just a number (e.g. "1.pdf")
            # Skip if it looks like a document/reference code rather than a supplier name
            # e.g. "RD5542565B EN" — has digits embedded in what looks like a code
            looks_like_code = bool(re.match(r'^[A-Z]{1,4}\d{4,}', candidate.replace(' ', '')))
            # Skip filenames that are generic invoice document names, not supplier names
            generic_doc = bool(re.match(r'^(TAX[\s\-]?INVOICE|INVOICE|RECEIPT|STATEMENT|PURCHASE[\s\-]?ORDER|REMITTANCE|CREDIT[\s\-]?NOTE)', candidate, re.IGNORECASE))
            if candidate and not re.match(r'^\d+$', candidate) and not looks_like_code and not generic_doc:
                supplier_name = candidate

    # 2. Pty Ltd / Limited pattern (use clean lines, not raw — avoids picking up customer address)
    if not supplier_name:
        clean_text = "\n".join(lines)
        m = re.search(r'([A-Z][A-Za-z\s&\'\-\.]{2,50}(?:Pty\.?\s*Ltd\.?|Limited|Inc\.?|Corp\.))', clean_text)
        if m:
            candidate = m.group(1).strip()
            if len(candidate) < 80:
                supplier_name = candidate

    # 3. Business keyword lines (from clean lines)
    if not supplier_name:
        biz_words = re.compile(
            r'\b(services|food|supply|wholesale|trading|imports|exports|fresh|market|group|'
            r'catering|bakery|butcher|produce|seafood|poultry|dairy|beverages|brothers|'
            r'rush|bakehouse|provisions)\\b', re.I)
        for line in lines[:25]:
            if biz_words.search(line) and 4 < len(line) < 70:
                if not re.match(r'^\d+\s', line):
                    supplier_name = line
                    break

    # 4. Fallback: first reasonable non-address line from clean lines
    if not supplier_name:
        skip_starts = ("tax invoice", "invoice", "receipt", "abn", "phone", "fax",
                       "gst", "date", "bill to", "deliver to", "po box", "p.o.",
                       "www.", "http", "unit ", "page ", "*", "#", "head office",
                       "t:", "f:", "e:", "sale date", "order", "delivery")
        for line in lines[:15]:
            low = line.lower()
            if any(low.startswith(s) for s in skip_starts): continue
            if re.match(r'^[\d\s\*\#\-\_\:\.]+$', line): continue
            if len(line) < 4 or len(line) > 80: continue
            if re.match(r'^\d+\s+\w', line): continue
            supplier_name = line
            break

    if supplier_name:
        supplier_name = re.sub(r'\s+', ' ', supplier_name).strip(' *#:')

    # ── Invoice number ─────────────────────────────────────────────────────────
    invoice_number = None
    # Use full_text (including noise) for invoice number since it can appear anywhere
    inv_pats = [
        r'\b(INV[-\s]?\d+)\b',              # highest priority: INV-17293, INV17293
        r'\*([A-Z]\d{5,})\*',
        r'tax\s+invoice\s+no\s*[:\s]*\n.*?(\b[A-Z]\d{5,}\b)',
        r'tax\s+invoice\s+no\s*[:\s]+([A-Z0-9\-]{3,})',
        r'invoice\s*(?:no|number|#|num|ref)[:\s#.]*\s*([A-Z0-9\-]{3,})',
        r'invoice\s*no\.\s*:\s*([A-Z0-9\-]{3,})',
        r'\b(SI\d{6,})\b',
        # Spud Shed: "Trans: 206270"
        r'(?:^|\n)Trans:\s*(\d{4,})',
        # Etherington/MarketBase: "Document No. 80867264"
        r'document\s+no\.?\s*[:\s]*(\d{4,})',
        # MarketBase Subject line: "GRN-80867264-1" or "GRN–80867264-1"
        r'[A-Z]{2,6}[-\u2013](\d{6,})',
        # Order / Sale no patterns
        r'order\s*#?\s*[:\s]+(\d{6,})',
        r'invoice\s*[:\s]+(\d{6,})',
        r'sale\s+no\.?\s*[:\s]+(\d{4,})',
        r'(?:^|\b)([A-Z]{1,3}\d{5,9})\b',
        # Last resort: standalone 6-8 digit number on a line that looks like an invoice number
        r'^(\d{6,10})$',
    ]
    for pat in inv_pats:
        for m in re.finditer(pat, full_text, re.IGNORECASE | re.MULTILINE):
            candidate = m.group(1).strip()
            if re.match(r'^\d{2}[\/\-]', candidate): continue
            # Skip if it looks like a date (8 digits with day/month pattern)
            if re.match(r'^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])\d{4}$', candidate): continue
            invoice_number = candidate
            break
        if invoice_number: break

    # ── Invoice date ───────────────────────────────────────────────────────────
    invoice_date = None  # initialize before header scan
    # Scan header tables for invoice no. + date (e.g. Brownes)
    if not invoice_number:
        for table in all_tables:
            if not table or len(table) < 2: continue
            header_str = " ".join(str(c or "").lower().replace("\n", " ") for c in table[0])
            if "invoice" in header_str and ("no" in header_str or "number" in header_str):
                inv_col = None
                date_col = None
                for j, c in enumerate(table[0]):
                    cv = str(c or "").lower().replace("\n", " ")
                    if "invoice" in cv and ("no." in cv or "no " in cv or "number" in cv) and "date" not in cv:
                        inv_col = j
                    if "invoice" in cv and "date" in cv:
                        date_col = j
                for row in table[1:]:
                    if inv_col is not None and not invoice_number and inv_col < len(row):
                        v = str(row[inv_col] or "").strip()
                        if re.match(r'^\d{5,}$', v):
                            invoice_number = v
                    if date_col is not None and date_col < len(row):
                        v = str(row[date_col] or "").strip()
                        dm = re.match(r'(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})', v)
                        if dm and not invoice_date:
                            invoice_date = parse_date(dm.group(1))

    if not invoice_date and original_filename:
        m = re.search(r'(\d{4}-\d{2}-\d{2})', original_filename)
        if m:
            invoice_date = m.group(1)

    if not invoice_date:
        # Use full_text for date searching but prioritise specific "sale date" / "invoice date" fields
        date_pats = [
            # "Sale Date:" — Etherington/MarketBase (MUST come before generic date:)
            r'sale\s+date\s*[:\s]+(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})',
            # Standard invoice date labels
            r'(?:invoice\s+date|date\s+of\s+invoice)[:\s]+(\d{1,2}[-\/\s]\w+[-\/\s]\d{2,4})',
            r'(?:invoice\s+date|date\s+of\s+invoice)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
            # Spud Shed / thermal receipt: "Date: 13/04/26 9:44"
            r'(?:^|\n)Date:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
            # Generic "date:" — AFTER the specific ones
            r'\bdate[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
            r'(?<!\d)(\d{1,2}[\/]\d{1,2}[\/]\d{4})(?!\d)',
            r'\b(\d{4}-\d{2}-\d{2})\b',
            r'\b(\d{1,2}[-\s](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[-\s]\d{4})\b',
            # Dot-separated date (e.g. 13.04.2026) — after standard formats
            r'(?<!\d)(\d{1,2}\.\d{1,2}\.\d{4})(?!\d)',
            # Concatenated date with no separators (e.g. 14Oct2025, 14OCTOBER2025)
            r'\b(\d{1,2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\d{4})\b',
        ]
        for pat in date_pats:
            m = re.search(pat, full_text, re.IGNORECASE)
            if m:
                invoice_date = parse_date(m.group(1))
                break

    # ── Total amount ───────────────────────────────────────────────────────────
    total_amount = None

    if original_filename:
        m = re.search(r'_(\d+[\.,]\d{2})\.(pdf|jpg|jpeg|png|tiff?|bmp|gif|webp)$',
                      original_filename, re.IGNORECASE)
        if m:
            total_amount = clean_num(m.group(1))

    if not total_amount:
        total_pats = [
            r'(?:invoice\s+total|total\s+inc\.?\s*gst|total\s+amount\s+due|amount\s+due|'
            r'balance\s+due|total\s+payable|total\s+\(aud\)|total\s+aud|totalaud)'
            r'[:\s]*\$?([\d,]+\.\d{2})',
            r'(?:^|\s)total[:\s]+\$?([\d,]+\.\d{2})',
        ]
        for pat in total_pats:
            for m in re.finditer(pat, full_text, re.IGNORECASE | re.MULTILINE):
                val = clean_num(m.group(1))
                if val and val > 0:
                    total_amount = val
                    break
            if total_amount: break

    if not total_amount:
        amounts = [clean_num(m.group(1)) for m in re.finditer(r'\$?([\d,]+\.\d{2})', full_text)]
        amounts = [a for a in amounts if a and a > 0]
        if amounts:
            total_amount = max(amounts)

    # ── Line items ─────────────────────────────────────────────────────────────
    line_items = []

    SKIP_DESC = ("total", "subtotal", "gst", "tax", "terms", "note:", "please",
                 "thank", "instructions", "special to", "payment", "bank", "bsb",
                 "signed", "received", "signature", "lic no", "page ", "email",
                 "acc #", "ph:", "fax:", "abn", "delivery", "contact", "invoice to",
                 "bill to", "deliver to", "head office", "http", "www.", "canning",
                 "northbridge", "madison", "sales total", "amount:", "van run")

    # ── Strategy 1: pdfplumber structured table ────────────────────────────────
    for table in all_tables:
        if not table or len(table) < 2: continue
        header_idx = -1
        header_row = None
        for i, row in enumerate(table):
            rs = " ".join(str(c or "").lower() for c in row)
            if any(w in rs for w in ["description", "product", "item", "code", "qty"]):
                header_row = row
                header_idx = i
                break
        if header_row is None: continue

        def find_col(kws):
            for j, c in enumerate(header_row):
                if c and any(k in str(c).lower() for k in kws):
                    return j
            return None

        dc = find_col(["product description", "description", "item", "name", "article"])
        # Don't let 'product code' steal the description column — require more specific match
        # Also skip columns that are purely numeric codes
        if dc is not None:
            cell_check = str(header_row[dc] or "").lower()
            if "code" in cell_check and "description" not in cell_check:
                dc = find_col(["description", "item", "name", "article"])
        qc = find_col(["supplied quantity", "supplied", "qty del", "qty.", "qty", "delivered", "del type", "quantity"])
        # Prefer 'nett unit price' over 'unit list price' — Brownes format
        pc = find_col(["nett unit price", "nett unit", "unit price", "unitprice", "rate", "cost"])
        tc = find_col(["extended price", "ext. price", "ext price", "amount", "total", "extprice"])
        uc = find_col(["type", "uom", "unit"])
        if dc is None: continue

        def cell_val(row, col):
            if col is None or col >= len(row): return None
            return str(row[col] or "").strip() or None

        def multi_nums(col):
            v = cell_val(row, col)
            if not v: return []
            out = []
            for part in v.split("\n"):
                n = clean_num(part)
                if n is not None: out.append(n)
            return out

        for row in table[header_idx + 1:]:
            if not row: continue
            desc_raw = cell_val(row, dc) or ""
            if not desc_raw or len(desc_raw) < 2: continue
            if any(desc_raw.lower().startswith(s) for s in SKIP_DESC): continue
            if re.match(r'^[\$\d\s\.,\-]+$', desc_raw): continue

            desc_lines = []
            for l in desc_raw.split("\n"):
                ls = l.strip()
                if not ls: continue
                if ls.lower().startswith("note"): continue
                if ls.lower().startswith("on behalf"): continue
                if re.match(r'^\d{7,}', ls): continue
                desc_lines.append(ls)

            qty_list   = multi_nums(qc)
            price_list = multi_nums(pc)
            total_list = multi_nums(tc)
            unit_list  = [u.strip() for u in (cell_val(row, uc) or "").split("\n")
                          if u.strip() and not u.strip().replace(".", "").replace(",", "").isdigit()]

            # Brownes / multi-row-in-one-cell pattern:
            # All line items are concatenated in a single table row with \n separators.
            # If we have multiple desc lines and multiple matching qty/price/total values,
            # split them out into individual line items.
            if len(desc_lines) > 1 and qty_list and len(qty_list) >= len(desc_lines):
                for k, dl in enumerate(desc_lines):
                    if any(dl.lower().startswith(s) for s in SKIP_DESC): continue
                    # Strip Brownes embedded column data from description
                    # e.g. "BRN MILK REGULAR 2L EA 9 7.5693 -4.0653 3.5040 31.54 N"
                    # If the description line embeds UOM+qty+prices, extract just the name part
                    embedded = re.match(r'^(.+?)\s+(EA|KG|L|ML|EACH|PK|CS|CTN|DOZ|BOX|G|LT)\s+', dl, re.IGNORECASE)
                    clean_desc = embedded.group(1).strip() if embedded else dl
                    line_items.append({
                        "description": clean_desc,
                        "quantity":  qty_list[k]   if k < len(qty_list)   else qty_list[-1],
                        "unitPrice": price_list[k] if k < len(price_list) else (price_list[-1] if price_list else None),
                        "lineTotal": total_list[k] if k < len(total_list) else None,
                        "unit":      unit_list[k]  if k < len(unit_list)  else (unit_list[0] if unit_list else None),
                    })
            elif len(desc_lines) > 1 and qty_list:
                for k, dl in enumerate(desc_lines):
                    if any(dl.lower().startswith(s) for s in SKIP_DESC): continue
                    embedded = re.match(r'^(.+?)\s+(EA|KG|L|ML|EACH|PK|CS|CTN|DOZ|BOX|G|LT)\s+', dl, re.IGNORECASE)
                    clean_desc = embedded.group(1).strip() if embedded else dl
                    line_items.append({
                        "description": clean_desc,
                        "quantity":  qty_list[k]   if k < len(qty_list)   else qty_list[-1],
                        "unitPrice": price_list[k] if k < len(price_list) else (price_list[-1] if price_list else None),
                        "lineTotal": total_list[k] if k < len(total_list) else None,
                        "unit":      unit_list[k]  if k < len(unit_list)  else (unit_list[0] if unit_list else None),
                    })
            else:
                embedded = re.match(r'^(.+?)\s+(EA|KG|L|ML|EACH|PK|CS|CTN|DOZ|BOX|G|LT)\s+',
                                    desc_lines[0] if desc_lines else desc_raw, re.IGNORECASE)
                clean_desc = embedded.group(1).strip() if embedded else (desc_lines[0] if desc_lines else desc_raw)
                qty_list2   = multi_nums(qc)
                price_list2 = multi_nums(pc)
                total_list2 = multi_nums(tc)
                line_items.append({
                    "description": clean_desc,
                    "quantity":  qty_list2[0]   if qty_list2   else None,
                    "unitPrice": price_list2[0] if price_list2 else None,
                    "lineTotal": total_list2[0] if total_list2 else None,
                    "unit":      unit_list[0]  if unit_list  else None,
                })

    # ── Strategy 1b: Brownes embedded-column format ─────────────────────────────
    # Runs when Strategy 1 got items but none had any quantity/price (all None)
    if line_items and not any(
        item.get("quantity") is not None or item.get("lineTotal") is not None
        for item in line_items
    ):
        brownes_items = extract_brownes_format(all_tables)
        if brownes_items:
            line_items = brownes_items

    # Also try if no items at all
    if not line_items:
        brownes_items = extract_brownes_format(all_tables)
        if brownes_items:
            line_items = brownes_items

    # ── Strategy 1b0a: Del Basso Smallgoods format ──────────────────────────────
    # Format: CODE DESCRIPTION QUANTITY PRICE [GST] AMOUNT (fixed-width text)
    # pdfplumber merges all items into one table cell — use raw text lines instead.
    # Always overrides generic table strategy when Del Basso is detected.
    is_del_basso = 'delbasso.com' in full_text.lower() or 'del basso smallgoods' in full_text.lower()
    if is_del_basso:
        supplier_name = "Del Basso Smallgoods"
        _db_items = []
        _db_skip = re.compile(r'###|BATCH CODE|DEAR CUSTOMER|FUEL PRICES|ORDER FOR DELIVERY|INCUR|CUSTOMERS PLEASE|GST.*APPLICABLE|ALL ORDERS|DELIVERY.*INCLUDES|NO CLAIM|ACCOUNT BALANCE|PAYMENTS BY|CONDITIONS|ONLINE ORDER', re.IGNORECASE)
        # CODE DESC QTY PRICE AMOUNT  (GST column may or may not appear — price never has $)
        _db_item_re = re.compile(r'^([A-Z0-9]{2,8}[A-Z]?[A-Z0-9]*)\s+(.+?)\s+(\d+\.\d{3})\s+([\d]+\.[\d]{2})\s+([\d]+\.[\d]{2})$')
        # CODE DESC QTY AMOUNT  (no unit price column — derive price)
        _db_item_re2 = re.compile(r'^([A-Z0-9]{2,8}[A-Z]?[A-Z0-9]*)\s+(.+?)\s+(\d+\.\d{3})\s+([\d]+\.[\d]{2})$')
        for raw_line in raw_lines:
            if _db_skip.search(raw_line): continue
            m = _db_item_re.match(raw_line.strip()) or _db_item_re2.match(raw_line.strip())
            if m:
                groups = m.groups()
                desc = groups[1].strip()
                qty = clean_num(groups[2])
                if len(groups) == 5:
                    price = clean_num(groups[3]); total = clean_num(groups[4])
                else:
                    total = clean_num(groups[3]); price = round(total / qty, 4) if qty else None
                if desc and qty:
                    _db_items.append({'description': desc, 'quantity': qty, 'unitPrice': price, 'lineTotal': total, 'unit': 'kg'})
        if _db_items:
            line_items = _db_items

    # ── Strategy 1b0b: Brew Coffee Roasters format ───────────────────────────────
    # Format: DESCRIPTION QTY UNIT_PRICE GST AMOUNT_AUD
    # pdfplumber merges lines into one cell — use raw text lines instead.
    # Always overrides generic table strategy when Brew Coffee is detected.
    is_brew_coffee = 'brewcoffeeroasters' in full_text.lower() or 'brew coffee roasters' in full_text.lower()
    if is_brew_coffee:
        supplier_name = "Brew Coffee Roasters"
        _bc_items = []
        _bc_skip = re.compile(r'^(DESCRIPTION|QTY|UNIT|Subtotal|Shipping|GST[:\s]|Card|Order total|Balance|For any|Link to|Invoice|Delivery Date|PO:|Notes|Supplier|\(cid:|TAX INVOICE|PAID)', re.IGNORECASE)
        for raw_line in raw_lines:
            if _bc_skip.search(raw_line.strip()): continue
            # Tokenise from right: amount, gst_label (GST Free or 10%), price, qty, then description
            parts = raw_line.strip().split()
            if len(parts) < 4: continue
            # Last token: amount (must be numeric)
            amt = clean_num(parts[-1])
            if amt is None: continue
            # Peel off GST label: "GST Free" or "10%" or "0%"
            idx = -2
            if parts[idx] in ('Free', '10%', '0%', 'free'): idx -= 1
            if parts[idx].upper() == 'GST': idx -= 1
            price = clean_num(parts[idx])
            if price is None: continue
            qty = clean_num(parts[idx - 1])
            if qty is None: continue
            desc = ' '.join(parts[:idx - 1]).strip()
            if not desc or len(desc) < 3: continue
            _bc_items.append({'description': desc, 'quantity': qty, 'unitPrice': price, 'lineTotal': amt, 'unit': 'each'})
        if _bc_items:
            line_items = _bc_items

    # ── Strategy 1b0c: ACC 1170 bread delivery format ───────────────────────────
    # Format: CODE DESCRIPTION Today Adjust Return Qty Chg Price TOTAL
    # pdfplumber merges all item rows into a single table cell — parse from table directly.
    # No supplier name in invoice — leave blank for user to set on first match.
    is_acc1170 = 'today adjust return' in full_text.lower() or 'acc no: 1170' in full_text.lower()
    if is_acc1170:
        if not supplier_name or supplier_name.lower().startswith('total nett') or 'drive' in (supplier_name or '').lower():
            supplier_name = 'Bread Supplier (ACC 1170)'  # Unknown — user will set on first match
        _acc_items = []
        # Parse from the pdfplumber table (columns are properly separated)
        for tbl in all_tables:
            if not tbl or len(tbl) < 2: continue
            # Find header row with CODE/DESCRIPTION/Price/TOTAL
            hdr = None
            hdr_idx = -1
            for i, row in enumerate(tbl):
                rs = ' '.join(str(c or '').lower() for c in row)
                if 'description' in rs and ('price' in rs or 'total' in rs):
                    hdr = row; hdr_idx = i; break
            if hdr is None: continue
            # Expect columns: CODE, DESCRIPTION, Today, Adjust, Return, Qty Chg, Price, TOTAL
            # Find column indices
            code_c = desc_c = qty_c = price_c = total_c = None
            for j, c in enumerate(hdr):
                cv = str(c or '').lower().strip()
                if cv in ('code',): code_c = j
                elif cv in ('description',): desc_c = j
                elif 'qty' in cv: qty_c = j
                elif cv in ('price',): price_c = j
                elif cv in ('total',): total_c = j
            if desc_c is None: continue
            # Data row(s) — cells may contain newline-joined values
            for row in tbl[hdr_idx + 1:]:
                def _get(col):
                    if col is None or col >= len(row): return []
                    return [v.strip() for v in str(row[col] or '').split('\n') if v.strip()]
                descs  = _get(desc_c)
                qtys   = _get(qty_c) if qty_c is not None else []
                prices = _get(price_c) if price_c is not None else []
                totals = _get(total_c) if total_c is not None else []
                for i, desc in enumerate(descs):
                    # Skip footer/notes rows
                    if re.search(r'Total Nett|Freight|Customer Message|Notes|Web Edit|Normal Office|Mon-|Friday', desc, re.IGNORECASE): continue
                    qty   = clean_num(qtys[i])   if i < len(qtys)   else None
                    price = clean_num(prices[i]) if i < len(prices) else None
                    total = clean_num(totals[i]) if i < len(totals) else None
                    if price is None and total is not None and qty:
                        price = round(total / qty, 4)
                    if desc and qty:
                        _acc_items.append({'description': desc, 'quantity': qty, 'unitPrice': price, 'lineTotal': total, 'unit': 'each'})
        # Fallback: raw text regex if table parse failed
        if not _acc_items:
            _acc_re = re.compile(r'^([A-Z0-9]+)\s+(.+?)\s+(\d+)\s+\d+\s+\d+\s+(\d+)\s+([\d.]+)\s+([\d.]+)$')
            for raw_line in raw_lines:
                m = _acc_re.match(raw_line.strip())
                if m:
                    desc = m.group(2).strip()
                    qty = clean_num(m.group(4))
                    price = clean_num(m.group(5))
                    total = clean_num(m.group(6))
                    if desc and qty:
                        _acc_items.append({'description': desc, 'quantity': qty, 'unitPrice': price, 'lineTotal': total, 'unit': 'each'})
        if _acc_items:
            line_items = _acc_items

        # ── Strategy 1b1b: B&E Foods Perth (columnar table, newline-joined cells) ──────
    is_be_foods = 'b&e foods' in full_text.lower() or 'befoods.com' in full_text.lower()
    if is_be_foods:
        if not supplier_name or re.match(r'^(TAX[\s\-]?INVOICE|INVOICE)', supplier_name or '', re.IGNORECASE):
            supplier_name = "B&E Foods Perth"
        # Always use B&E-specific parser — earlier generic strategies misparse this format
        be_items = extract_be_foods_format(all_tables)
        if be_items:
            line_items = be_items

    # ── Strategy 1b1c: Wing Hong Food format ───────────────────────────────────────
    # Columns: Code | Product Description | CTN | Ordered | OrdType | QtyDel | Type | Price | Total
    # pdfplumber merges all items into one tall cell per column — parse via table.
    # Always overrides generic strategy when Wing Hong is detected.
    is_wing_hong = 'wh-food.com' in full_text.lower() or 'wh.sales@' in full_text.lower() or 'wing hong' in full_text.lower()
    if is_wing_hong:
        supplier_name = "Wing Hong Food"
        _wh_items = []
        for tbl in all_tables:
            if not tbl or len(tbl) < 2: continue
            # Find header row: look for 'Product Description' and 'Price'
            hdr = None; hdr_idx = -1
            for i, row in enumerate(tbl):
                rs = ' '.join(str(c or '').lower() for c in row)
                if 'product description' in rs and 'price' in rs:
                    hdr = row; hdr_idx = i; break
            if hdr is None: continue
            # Map column indices
            desc_c = qty_c = price_c = total_c = None
            for j, c in enumerate(hdr):
                cv = str(c or '').lower().strip().replace('\n', ' ')
                if 'product description' in cv: desc_c = j
                elif 'qty del' in cv or ('qty' in cv and 'del' in cv): qty_c = j
                elif cv == 'price': price_c = j
                elif cv == 'total': total_c = j
            if desc_c is None: continue
            for row in tbl[hdr_idx + 1:]:
                def _wh_get(col):
                    if col is None or col >= len(row): return []
                    raw = str(row[col] or '')
                    return [v.strip() for v in raw.split('\n') if v.strip()]
                raw_descs  = _wh_get(desc_c)
                raw_qtys   = _wh_get(qty_c)   if qty_c   is not None else []
                raw_prices = _wh_get(price_c) if price_c is not None else []
                raw_totals = _wh_get(total_c) if total_c is not None else []
                # Filter NOTE lines and serial-number continuations from descs
                item_descs = [d for d in raw_descs
                              if not re.match(r'^NOTE\s*:', d, re.IGNORECASE)
                              and not re.match(r'^[\d,\s]+$', d)]
                qty_nums   = [v for v in raw_qtys   if re.match(r'^[\d\.]+$', v)]
                price_nums = [v.lstrip('$') for v in raw_prices if re.match(r'^\$?[\d\.]+$', v)]
                total_nums = [v.lstrip('$') for v in raw_totals if re.match(r'^\$?[\d\.]+$', v)]
                for n, desc in enumerate(item_descs):
                    qty   = clean_num(qty_nums[n])   if n < len(qty_nums)   else None
                    price = clean_num(price_nums[n]) if n < len(price_nums) else None
                    total = clean_num(total_nums[n]) if n < len(total_nums) else None
                    if price is None and total is not None and qty:
                        price = round(total / qty, 4)
                    if desc and qty:
                        _wh_items.append({'description': desc, 'quantity': qty, 'unitPrice': price, 'lineTotal': total, 'unit': 'kg'})
        # Fallback: raw text regex (Code Desc CTN Ordered OrdType QtyDel Type Price Total)
        if not _wh_items:
            _wh_re = re.compile(r'^([A-Z0-9/]+)\s+(.+?)\s+\d+\s+[\d.]+\s+KG\s+([\d.]+)\s+KG\s+\$([\d.]+)\s+\$([\d.]+)$')
            for raw_line in raw_lines:
                m = _wh_re.match(raw_line.strip())
                if m:
                    desc = m.group(2).strip()
                    qty = clean_num(m.group(3))
                    price = clean_num(m.group(4))
                    total = clean_num(m.group(5))
                    if desc and qty:
                        _wh_items.append({'description': desc, 'quantity': qty, 'unitPrice': price, 'lineTotal': total, 'unit': 'kg'})
        if _wh_items:
            line_items = _wh_items

    # ── Strategy 1b2: Fresh Express Produce (GRN invoice format) ────────────────
    is_fresh_express = 'fresh express' in full_text.lower() or 'fresh-express' in full_text.lower()
    if is_fresh_express:
        if not supplier_name or supplier_name == original_filename.replace('.pdf','').replace('_',' '):
            supplier_name = "Fresh Express Produce"
        if not line_items:
            line_items = extract_fresh_express_format(pdf_path)

    # ── Strategy 1c: Spud Shed thermal receipt format ─────────────────────────
    is_spudshed = 'spudshed' in full_text.lower() or 'spud shed' in full_text.lower()
    if is_spudshed:
        if not supplier_name:
            supplier_name = "Spud Shed"
        if not line_items:
            # For image receipts (photo of thermal receipt), use vision JSON extraction directly
            # -- regex is unreliable due to OCR formatting variation
            if original_image_path and os.path.exists(original_image_path):
                line_items = extract_line_items_via_vision(original_image_path)
            # Fall back to regex if vision failed or no image available
            if not line_items:
                line_items = extract_spudshed_format(lines)

    # ── Strategy 1d: Bidfood wholesale format ────────────────────────────────
    # Detected by "bidfood" in text or "cartons supplied" in header line
    is_bidfood = ('bidfood' in full_text.lower() or 'cartons supplied' in full_text.lower())
    if is_bidfood:
        # Extract clean supplier name: "BIDFOOD MALAGA" (2 words only, stop before lowercase)
        for line in lines[:15]:
            m_sup = re.match(r'^(BIDFOOD\s+[A-Z]+)(?:\s|$)', line.strip(), re.IGNORECASE)
            if m_sup:
                supplier_name = m_sup.group(1).strip()
                break
        bidfood_items = extract_bidfood_format(pdf.pages)
        if bidfood_items:
            line_items = bidfood_items
        # Extract GST-inclusive total from Bidfood summary line.
        # The summary "Total" row has multiple numbers; the last one is incl. GST total.
        for _line in full_text.split('\n'):
            _stripped = _line.strip()
            if re.match(r'^Total\s+[\d,]', _stripped, re.IGNORECASE):
                _nums = re.findall(r'[\d,]+\.\d{2}', _stripped)
                if _nums:
                    try:
                        total_amount = float(_nums[-1].replace(',', ''))
                    except ValueError:
                        pass
                    break

    # ── Strategy 1e: Campbells / Metcash wholesale format ────────────────────
    # Detected by header line containing "ITM NO." and "EXCL.GST"
    is_campbells = ('itm no.' in full_text.lower() and 'excl.gst' in full_text.lower())
    if is_campbells:
        # Extract supplier name from the invoice text (prefer full name from invoice over filename)
        for line in lines[:10]:
            if re.match(r'^CAMPBELLS\s+\w+', line, re.IGNORECASE):
                supplier_name = line.strip()
                break
        campbells_items = extract_campbells_format(lines)
        if campbells_items:
            line_items = campbells_items

    # ── Strategy 2: Wing Hong text-line regex ──────────────────────────────────
    if not line_items:
        wing_pat = re.compile(
            r'[A-Z0-9/]{2,15}\s+'
            r'(.+?)\s+'
            r'(?:\d+\s+)?\d+\.\d+\s+[A-Z]+\s+'
            r'(\d+\.\d+)\s+'
            r'([A-Z]+)\s+'
            r'\$([\d,]+\.\d{2})\s+'
            r'\$([\d,]+\.\d{2})'
        )
        simple_pat = re.compile(
            r'^(.{5,60}?)\s{2,}'
            r'\$?([\d,]+\.\d{2})\s+'
            r'\$?([\d,]+\.\d{2})\s*$'
        )
        for line in full_text.split("\n"):
            line = line.strip()
            m = wing_pat.match(line)
            if m:
                desc = m.group(1).strip()
                if any(w in desc.lower() for w in ["total", "gst", "tax", "subtotal"]): continue
                line_items.append({
                    "description": desc,
                    "quantity":  clean_num(m.group(2)),
                    "unitPrice": clean_num(m.group(4)),
                    "lineTotal": clean_num(m.group(5)),
                    "unit":      m.group(3),
                })
                continue
            m2 = simple_pat.match(line)
            if m2:
                desc = m2.group(1).strip()
                if any(w in desc.lower() for w in ["total", "gst", "tax", "subtotal", "balance", "amount"]): continue
                line_items.append({
                    "description": desc,
                    "quantity": None,
                    "unitPrice": clean_num(m2.group(2)),
                    "lineTotal": clean_num(m2.group(3)),
                    "unit": None,
                })

    # ── Strategy 3: Word-bbox column reconstruction ────────────────────────────
    if not line_items:
        line_items = extract_by_word_bbox(all_pages_words)

    # ── Strategy 4: Costco in-warehouse receipt format ────────────────────────
    # Detect by checking for distinctive Costco markers in raw text
    is_costco = (
        'costco wholesale' in full_text.lower() or
        'my warehouse receipts' in full_text.lower() or
        'in-warehouse receipt' in full_text.lower()
    )
    if is_costco:
        # Always use Costco extractor for Costco receipts — bypass other strategies
        # which may return noisy/wrong results for this format
        line_items = extract_costco_format(lines)
        # Force supplier name to Costco
        supplier_name = "Costco Wholesale Australia"

    # ── Strategy 5: MarketBase / Etherington printed-email format ─────────────
    if not line_items:
        line_items = extract_marketbase_format(lines)

    # ── Strategy 5b: Vision JSON extraction — image receipt fallback ─────────────────
    # If all strategies failed AND we have the original image, ask Claude to extract
    # line items directly as structured JSON. Works for any thermal/photo receipt.
    if not line_items and original_image_path and os.path.exists(original_image_path):
        line_items = extract_line_items_via_vision(original_image_path)

    # ── Strategy 6: Simple price-pair fallback ─────────────────────────────────
    if not line_items:
        simple_pat = re.compile(
            r'^(.{5,60}?)\s{2,}'
            r'\$?([\d,]+\.\d{2})\s+'
            r'\$?([\d,]+\.\d{2})\s*$'
        )
        for line in full_text.split("\n"):
            line = line.strip()
            m = simple_pat.match(line)
            if m:
                desc = m.group(1).strip()
                if any(w in desc.lower() for w in ["total", "gst", "tax", "subtotal", "balance", "amount"]):
                    continue
                line_items.append({
                    "description": desc,
                    "quantity": None,
                    "unitPrice": clean_num(m.group(2)),
                    "lineTotal": clean_num(m.group(3)),
                    "unit": None,
                })

    # ── Global exclusion filter ────────────────────────────────────────────────
    # Remove lines that should never appear as ingredients (crate deposits, surcharges, totals, etc.)
    EXCLUDE_PATTERNS = re.compile(
        r'crate\s*deposit|crate\s*hire|pallet\s*deposit|drum\s*deposit|'
        r'produce\s*total|crate\s*total|invoice\s*total|gst\s*on\s*goods|'
        r'surcharge\s*grower|freight\s*charge|delivery\s*fee|admin\s*fee',
        re.IGNORECASE
    )
    line_items = [i for i in line_items if not EXCLUDE_PATTERNS.search(i.get('description',''))]

    # ── Deduplicate by description prefix ─────────────────────────────────────
    # Skip dedup for Costco — consolidation already happened inside extract_costco_format
    seen = set()
    unique_items = []
    for item in line_items:
        key = item["description"].lower()[:40]
        if is_costco or key not in seen:
            seen.add(key)
            unique_items.append(item)

    return {
        "supplierName": supplier_name,
        "invoiceNumber": invoice_number,
        "invoiceDate":   invoice_date,
        "totalAmount":   total_amount,
        "lineItems":     unique_items,
        "error": None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    file_path = sys.argv[1]
    original_filename = sys.argv[2] if len(sys.argv) > 2 else None

    tmp_pdf = None
    try:
        file_type = detect_file_type(file_path, original_filename)

        original_image_path = None
        if file_type == 'image':
            original_image_path = file_path  # keep for vision OCR fallback
            tmp_pdf = image_to_pdf(file_path)
            if tmp_pdf is None:
                raise ValueError("Could not convert image to PDF. Please ensure PIL/Pillow is installed.")
            pdf_to_parse = tmp_pdf
        else:
            pdf_to_parse = file_path

        result = parse_invoice(pdf_to_parse, original_filename, original_image_path=original_image_path)

    except Exception as e:
        result = {
            "supplierName": None,
            "invoiceNumber": None,
            "invoiceDate": None,
            "totalAmount": None,
            "lineItems": [],
            "error": str(e),
        }
    finally:
        if tmp_pdf and os.path.exists(tmp_pdf):
            try: os.unlink(tmp_pdf)
            except: pass

    print(json.dumps(result))
