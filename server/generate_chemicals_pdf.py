#!/usr/bin/env python3
"""
Chemicals Register Safety Information Sheet
The Deli by Greenhorns
Generates a WHS-compliant PDF from chemicals_register JSON data
Usage: python3 generate_chemicals_pdf.py '<json_data>' '<output_path>'
"""

import sys
import json
import os
import urllib.request
from datetime import datetime

# ReportLab imports
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, PageBreak
)
from reportlab.platypus.flowables import HRFlowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── Brand colours ──────────────────────────────────────────────────────────────
BRAND_BLUE    = HexColor('#256984')
BRAND_DARK    = HexColor('#1a4f63')
LIGHT_BG      = HexColor('#f0f7fa')
GREEN_BG      = HexColor('#d1fae5')
GREEN_TEXT    = HexColor('#065f46')
RED_BG        = HexColor('#fee2e2')
RED_TEXT      = HexColor('#991b1b')
ORANGE_BG     = HexColor('#ffedd5')
ORANGE_TEXT   = HexColor('#9a3412')
BLUE_BG       = HexColor('#dbeafe')
BLUE_TEXT     = HexColor('#1e40af')
GREY_BG       = HexColor('#f3f4f6')
GREY_TEXT     = HexColor('#6b7280')
DARK_TEXT     = HexColor('#1f2937')
MEDIUM_TEXT   = HexColor('#374151')
MUTED_TEXT    = HexColor('#6b7280')
BORDER_LIGHT  = HexColor('#e5e7eb')
BORDER_BLUE   = HexColor('#bfdbfe')
WARNING_AMBER = HexColor('#d97706')

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm

# ── Download & register fonts ──────────────────────────────────────────────────
FONT_DIR = '/tmp/chemicals_pdf_fonts'
os.makedirs(FONT_DIR, exist_ok=True)

FONTS = {
    'WorkSans-Regular':    'https://github.com/weiweihuanghuang/Work-Sans/raw/master/fonts/static/TTF/WorkSans-Regular.ttf',
    'WorkSans-Medium':     'https://github.com/weiweihuanghuang/Work-Sans/raw/master/fonts/static/TTF/WorkSans-Medium.ttf',
    'WorkSans-SemiBold':   'https://github.com/weiweihuanghuang/Work-Sans/raw/master/fonts/static/TTF/WorkSans-SemiBold.ttf',
    'WorkSans-Bold':       'https://github.com/weiweihuanghuang/Work-Sans/raw/master/fonts/static/TTF/WorkSans-Bold.ttf',
}

def download_font(name, url):
    path = os.path.join(FONT_DIR, f'{name}.ttf')
    if not os.path.exists(path):
        try:
            urllib.request.urlretrieve(url, path)
        except Exception:
            return False
    try:
        pdfmetrics.registerFont(TTFont(name, path))
        return True
    except Exception:
        return False

fonts_ok = all(download_font(n, u) for n, u in FONTS.items())
if fonts_ok:
    HEADING_FONT  = 'WorkSans-Bold'
    SUBHEAD_FONT  = 'WorkSans-SemiBold'
    MEDIUM_FONT   = 'WorkSans-Medium'
    BODY_FONT     = 'WorkSans-Regular'
else:
    HEADING_FONT = SUBHEAD_FONT = MEDIUM_FONT = BODY_FONT = 'Helvetica'

# ── Category labels ─────────────────────────────────────────────────────────────
CATEGORY_LABELS = {
    'sanitiser':           'Sanitiser',
    'disinfectant':        'Disinfectant',
    'surface_cleaner':     'Surface Cleaner',
    'floor_cleaner':       'Floor Cleaner',
    'glass_cleaner':       'Glass & Chrome Cleaner',
    'hand_hygiene':        'Hand Hygiene',
    'dishwashing_manual':  'Manual Dishwashing',
    'dishwashing_machine': 'Machine Dishwashing',
    'rinse_aid':           'Rinse Aid',
    'oven_grill_cleaner':  'Oven & Grill Cleaner',
    'powder_cleaner':      'Powder Cleaner',
    'other':               'Other',
}

# ── Styles ──────────────────────────────────────────────────────────────────────
def build_styles():
    s = getSampleStyleSheet()
    base = dict(fontName=BODY_FONT, fontSize=9, leading=13, textColor=DARK_TEXT)

    return {
        'cover_title': ParagraphStyle('cover_title',
            fontName=HEADING_FONT, fontSize=26, leading=32,
            textColor=white, alignment=TA_LEFT),
        'cover_sub': ParagraphStyle('cover_sub',
            fontName=MEDIUM_FONT, fontSize=12, leading=18,
            textColor=HexColor('#b2d8e8'), alignment=TA_LEFT),
        'cover_meta': ParagraphStyle('cover_meta',
            fontName=BODY_FONT, fontSize=9, leading=13,
            textColor=HexColor('#93c5d8'), alignment=TA_LEFT),
        'section_header': ParagraphStyle('section_header',
            fontName=SUBHEAD_FONT, fontSize=10, leading=14,
            textColor=BRAND_BLUE, spaceBefore=4, spaceAfter=2),
        'product_name': ParagraphStyle('product_name',
            fontName=HEADING_FONT, fontSize=11, leading=14,
            textColor=DARK_TEXT),
        'product_code': ParagraphStyle('product_code',
            fontName=MEDIUM_FONT, fontSize=8, leading=11,
            textColor=MUTED_TEXT),
        'label': ParagraphStyle('label',
            fontName=SUBHEAD_FONT, fontSize=8, leading=11,
            textColor=MUTED_TEXT),
        'body': ParagraphStyle('body',
            **base),
        'body_small': ParagraphStyle('body_small',
            fontName=BODY_FONT, fontSize=8, leading=11,
            textColor=MEDIUM_TEXT),
        'notes': ParagraphStyle('notes',
            fontName=BODY_FONT, fontSize=8, leading=12,
            textColor=MUTED_TEXT, leftIndent=0),
        'badge_green': ParagraphStyle('badge_green',
            fontName=SUBHEAD_FONT, fontSize=7, leading=10,
            textColor=GREEN_TEXT),
        'badge_grey': ParagraphStyle('badge_grey',
            fontName=BODY_FONT, fontSize=7, leading=10,
            textColor=GREY_TEXT),
        'badge_blue': ParagraphStyle('badge_blue',
            fontName=SUBHEAD_FONT, fontSize=7, leading=10,
            textColor=BLUE_TEXT),
        'badge_orange': ParagraphStyle('badge_orange',
            fontName=SUBHEAD_FONT, fontSize=7, leading=10,
            textColor=ORANGE_TEXT),
        'link': ParagraphStyle('link',
            fontName=MEDIUM_FONT, fontSize=8, leading=11,
            textColor=BRAND_BLUE),
        'whs_heading': ParagraphStyle('whs_heading',
            fontName=SUBHEAD_FONT, fontSize=9, leading=13,
            textColor=DARK_TEXT),
        'whs_body': ParagraphStyle('whs_body',
            fontName=BODY_FONT, fontSize=8, leading=12,
            textColor=MEDIUM_TEXT),
        'footer': ParagraphStyle('footer',
            fontName=BODY_FONT, fontSize=7, leading=10,
            textColor=MUTED_TEXT, alignment=TA_CENTER),
        'toc_cat': ParagraphStyle('toc_cat',
            fontName=SUBHEAD_FONT, fontSize=9, leading=13,
            textColor=DARK_TEXT),
        'toc_item': ParagraphStyle('toc_item',
            fontName=BODY_FONT, fontSize=8.5, leading=13,
            textColor=MEDIUM_TEXT, leftIndent=10),
    }

# ── Page template (header / footer) ────────────────────────────────────────────
def make_page_template(canvas, doc):
    if doc.page == 1:
        return  # cover page – no header/footer
    canvas.saveState()
    # Header bar
    canvas.setFillColor(BRAND_BLUE)
    canvas.rect(0, PAGE_H - 14*mm, PAGE_W, 14*mm, fill=1, stroke=0)
    canvas.setFillColor(white)
    canvas.setFont(HEADING_FONT if fonts_ok else 'Helvetica-Bold', 9)
    canvas.drawString(MARGIN, PAGE_H - 9*mm, 'THE DELI BY GREENHORNS')
    canvas.setFont(BODY_FONT if fonts_ok else 'Helvetica', 8)
    canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 9*mm, 'Chemicals Register — Safety Information Sheet')
    # Footer
    canvas.setFillColor(GREY_BG)
    canvas.rect(0, 0, PAGE_W, 10*mm, fill=1, stroke=0)
    canvas.setFillColor(MUTED_TEXT)
    canvas.setFont(BODY_FONT if fonts_ok else 'Helvetica', 7)
    canvas.drawString(MARGIN, 3.5*mm, f'Generated {datetime.now().strftime("%d %B %Y")} · Supplier: Chemform Australia · chemform.com.au')
    canvas.drawRightString(PAGE_W - MARGIN, 3.5*mm, f'Page {doc.page}')
    canvas.restoreState()

# ── Cover page ──────────────────────────────────────────────────────────────────
def build_cover(styles, chemicals, generated):
    story = []
    # Full-bleed blue cover block
    cover_table = Table([['']], colWidths=[PAGE_W], rowHeights=[80*mm])
    cover_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), BRAND_BLUE),
        ('TOPPADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(cover_table)

    # Overlay text (we can't truly overlay in ReportLab platypus easily,
    # so we use a nested table to simulate it)
    inner = Table(
        [[Paragraph('CHEMICALS REGISTER', styles['cover_title'])],
         [Paragraph('Safety Information Sheet', styles['cover_sub'])],
         [Spacer(1, 3*mm)],
         [Paragraph('The Deli by Greenhorns', styles['cover_meta'])],
         [Paragraph(f'Supplier: Chemform Australia · chemform.com.au', styles['cover_meta'])],
         [Paragraph(f'Generated: {generated}', styles['cover_meta'])],
         [Paragraph(f'Total products: {len(chemicals)}', styles['cover_meta'])],
        ],
        colWidths=[PAGE_W - 2*MARGIN],
    )
    inner.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), BRAND_BLUE),
        ('LEFTPADDING', (0,0), (-1,-1), MARGIN),
        ('RIGHTPADDING', (0,0), (-1,-1), MARGIN),
        ('TOPPADDING', (0,0), (0,0), 10*mm),
        ('TOPPADDING', (0,1), (-1,-1), 1*mm),
        ('BOTTOMPADDING', (0,-1), (-1,-1), 10*mm),
        ('BOTTOMPADDING', (0,0), (-1,-2), 1*mm),
    ]))

    # Replace cover table with proper version
    story = []
    story.append(inner)
    story.append(Spacer(1, 8*mm))

    # WHS notice box
    whs_rows = [
        [Paragraph('⚠  WHS COMPLIANCE NOTICE', styles['whs_heading'])],
        [Paragraph(
            'Under the <b>Work Health & Safety Regulations 2011 (WA)</b>, a hazardous chemicals register '
            'and current Safety Data Sheets (SDS) must be accessible to all workers at all times. '
            'SDS documents must be no older than 5 years from the issue date.',
            styles['whs_body'])],
        [Spacer(1, 2*mm)],
        [Paragraph(
            'This document is a summary register only. Always refer to the full SDS PDF for each product '
            'before use. SDS links are provided for each chemical in this register.',
            styles['whs_body'])],
    ]
    whs_table = Table(whs_rows, colWidths=[PAGE_W - 2*MARGIN])
    whs_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), ORANGE_BG),
        ('LEFTPADDING', (0,0), (-1,-1), 5*mm),
        ('RIGHTPADDING', (0,0), (-1,-1), 5*mm),
        ('TOPPADDING', (0,0), (0,0), 4*mm),
        ('TOPPADDING', (0,1), (-1,-1), 1.5*mm),
        ('BOTTOMPADDING', (0,-1), (-1,-1), 4*mm),
        ('BOTTOMPADDING', (0,0), (-1,-2), 1.5*mm),
        ('ROUNDEDCORNERS', [3]),
    ]))
    story.append(whs_table)
    story.append(Spacer(1, 6*mm))

    # Quick reference summary boxes
    food_safe = [c for c in chemicals if c.get('food_contact_safe')]
    no_rinse  = [c for c in chemicals if c.get('no_rinse')]
    caution   = [c for c in chemicals if c.get('notes') and ('POISON' in (c.get('notes') or '') or 'CAUTION' in (c.get('notes') or ''))]

    summary_data = [[
        _summary_box('Food-Safe Products', str(len(food_safe)), 'Approved for use on\nfood contact surfaces', GREEN_BG, GREEN_TEXT),
        _summary_box('No-Rinse Products', str(len(no_rinse)), 'Can be left on surface\nafter application', BLUE_BG, BLUE_TEXT),
        _summary_box('Caution / Poison', str(len(caution)), 'Review SDS before\nuse — handle with care', ORANGE_BG, ORANGE_TEXT),
        _summary_box('Total Products', str(len(chemicals)), 'All Chemform\nsupplied chemicals', LIGHT_BG, BRAND_BLUE),
    ]]
    summary_table = Table(summary_data, colWidths=[(PAGE_W - 2*MARGIN)/4]*4)
    summary_table.setStyle(TableStyle([
        ('LEFTPADDING', (0,0), (-1,-1), 2*mm),
        ('RIGHTPADDING', (0,0), (-1,-1), 2*mm),
        ('TOPPADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 6*mm))
    story.append(HRFlowable(width='100%', thickness=1, color=BORDER_LIGHT))
    story.append(Spacer(1, 3*mm))
    story.append(Paragraph('PRODUCT INDEX', styles['section_header']))
    story.append(Spacer(1, 2*mm))
    return story

def _summary_box(title, value, desc, bg, text_color):
    inner = Table([
        [Paragraph(value, ParagraphStyle('v', fontName=HEADING_FONT if fonts_ok else 'Helvetica-Bold',
                                          fontSize=22, leading=26, textColor=text_color))],
        [Paragraph(title, ParagraphStyle('t', fontName=SUBHEAD_FONT if fonts_ok else 'Helvetica-Bold',
                                          fontSize=8, leading=11, textColor=text_color))],
        [Paragraph(desc, ParagraphStyle('d', fontName=BODY_FONT if fonts_ok else 'Helvetica',
                                         fontSize=7, leading=10, textColor=text_color))],
    ], colWidths=[None])
    inner.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), bg),
        ('LEFTPADDING', (0,0), (-1,-1), 3*mm),
        ('RIGHTPADDING', (0,0), (-1,-1), 3*mm),
        ('TOPPADDING', (0,0), (0,0), 3*mm),
        ('TOPPADDING', (0,1), (-1,-1), 1*mm),
        ('BOTTOMPADDING', (0,-1), (-1,-1), 3*mm),
        ('BOTTOMPADDING', (0,0), (-1,-2), 0.5*mm),
        ('ROUNDEDCORNERS', [3]),
    ]))
    return inner

# ── Chemical card ───────────────────────────────────────────────────────────────
def build_chemical_card(chem, styles):
    name = chem.get('product_name', 'Unknown Product')
    code = chem.get('chemform_product_code', '')
    category = CATEGORY_LABELS.get(chem.get('category', ''), chem.get('category', ''))
    food_safe = chem.get('food_contact_safe', False)
    no_rinse  = chem.get('no_rinse', False)
    ghs       = chem.get('ghs_hazard_class', '')
    areas     = chem.get('areas_of_use', '')
    dilution  = chem.get('dilution_instructions', '')
    storage   = chem.get('storage_location', '')
    sds_url   = chem.get('sds_url', '')
    info_url  = chem.get('info_sheet_url', '')
    supplier_url = chem.get('supplier_url', '')
    notes     = chem.get('notes', '')

    # Header row: name + code
    name_parts = [Paragraph(name, styles['product_name'])]
    if code:
        name_parts.append(Paragraph(f'Code: {code}', styles['product_code']))

    # Badges
    badges = []
    if food_safe:
        b = Table([[Paragraph('✓  FOOD CONTACT SAFE', styles['badge_green'])]],
                  colWidths=[None])
        b.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), GREEN_BG),
            ('LEFTPADDING', (0,0), (-1,-1), 2.5*mm), ('RIGHTPADDING', (0,0), (-1,-1), 2.5*mm),
            ('TOPPADDING', (0,0), (-1,-1), 1.5*mm), ('BOTTOMPADDING', (0,0), (-1,-1), 1.5*mm),
            ('ROUNDEDCORNERS', [2]),
        ]))
        badges.append(b)
    else:
        b = Table([[Paragraph('NOT food contact safe', styles['badge_grey'])]],
                  colWidths=[None])
        b.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), GREY_BG),
            ('LEFTPADDING', (0,0), (-1,-1), 2.5*mm), ('RIGHTPADDING', (0,0), (-1,-1), 2.5*mm),
            ('TOPPADDING', (0,0), (-1,-1), 1.5*mm), ('BOTTOMPADDING', (0,0), (-1,-1), 1.5*mm),
            ('ROUNDEDCORNERS', [2]),
        ]))
        badges.append(b)

    if no_rinse:
        b = Table([[Paragraph('NO RINSE REQUIRED', styles['badge_blue'])]],
                  colWidths=[None])
        b.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), BLUE_BG),
            ('LEFTPADDING', (0,0), (-1,-1), 2.5*mm), ('RIGHTPADDING', (0,0), (-1,-1), 2.5*mm),
            ('TOPPADDING', (0,0), (-1,-1), 1.5*mm), ('BOTTOMPADDING', (0,0), (-1,-1), 1.5*mm),
            ('ROUNDEDCORNERS', [2]),
        ]))
        badges.append(b)

    if ghs:
        b = Table([[Paragraph(f'⚠  GHS: {ghs}', styles['badge_orange'])]],
                  colWidths=[None])
        b.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), ORANGE_BG),
            ('LEFTPADDING', (0,0), (-1,-1), 2.5*mm), ('RIGHTPADDING', (0,0), (-1,-1), 2.5*mm),
            ('TOPPADDING', (0,0), (-1,-1), 1.5*mm), ('BOTTOMPADDING', (0,0), (-1,-1), 1.5*mm),
            ('ROUNDEDCORNERS', [2]),
        ]))
        badges.append(b)

    if 'POISON' in (notes or '').upper():
        b = Table([[Paragraph('⚠  POISON LABEL', ParagraphStyle('p',
                   fontName=SUBHEAD_FONT if fonts_ok else 'Helvetica-Bold',
                   fontSize=7, leading=10, textColor=HexColor('#991b1b')))]],
                  colWidths=[None])
        b.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), RED_BG),
            ('LEFTPADDING', (0,0), (-1,-1), 2.5*mm), ('RIGHTPADDING', (0,0), (-1,-1), 2.5*mm),
            ('TOPPADDING', (0,0), (-1,-1), 1.5*mm), ('BOTTOMPADDING', (0,0), (-1,-1), 1.5*mm),
            ('ROUNDEDCORNERS', [2]),
        ]))
        badges.append(b)

    badge_row = [[b] for b in badges]  # stack vertically (wrap)
    if badges:
        badge_table = Table([[b for b in badges]], colWidths=[None]*len(badges))
        badge_table.setStyle(TableStyle([
            ('LEFTPADDING', (0,0), (-1,-1), 0), ('RIGHTPADDING', (0,0), (-1,-1), 2*mm),
            ('TOPPADDING', (0,0), (-1,-1), 0), ('BOTTOMPADDING', (0,0), (-1,-1), 0),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]))
    else:
        badge_table = Spacer(1, 1)

    # Detail rows
    details = []
    if areas:
        details.append([Paragraph('Areas of use:', styles['label']),
                        Paragraph(areas, styles['body_small'])])
    if dilution:
        details.append([Paragraph('Dilution / dosage:', styles['label']),
                        Paragraph(dilution, styles['body_small'])])
    if storage:
        details.append([Paragraph('Storage location:', styles['label']),
                        Paragraph(storage, styles['body_small'])])

    detail_table = None
    if details:
        detail_table = Table(details, colWidths=[30*mm, (PAGE_W - 2*MARGIN - 36*mm)])
        detail_table.setStyle(TableStyle([
            ('LEFTPADDING', (0,0), (-1,-1), 0), ('RIGHTPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 1*mm), ('BOTTOMPADDING', (0,0), (-1,-1), 1*mm),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ]))

    # SDS + Info Sheet links
    link_parts = []
    if sds_url:
        link_parts.append(Paragraph(f'<a href="{sds_url}" color="#256984"><u>Safety Data Sheet (SDS) ↗</u></a>', styles['link']))
    if info_url:
        link_parts.append(Paragraph(f'<a href="{info_url}" color="#256984"><u>Product Info Sheet ↗</u></a>', styles['link']))
    if supplier_url:
        link_parts.append(Paragraph(f'<a href="{supplier_url}" color="#256984"><u>Chemform product page ↗</u></a>', styles['link']))

    # Notes
    note_para = None
    if notes:
        note_para = Paragraph(notes, styles['notes'])

    # Assemble card content
    card_content = []
    card_content += name_parts
    card_content.append(Spacer(1, 1.5*mm))
    card_content.append(badge_table)
    if detail_table:
        card_content.append(Spacer(1, 2*mm))
        card_content.append(detail_table)
    if link_parts:
        card_content.append(Spacer(1, 2*mm))
        for lp in link_parts:
            card_content.append(lp)
    if note_para:
        card_content.append(Spacer(1, 1.5*mm))
        card_content.append(HRFlowable(width='100%', thickness=0.5, color=BORDER_LIGHT))
        card_content.append(Spacer(1, 1*mm))
        card_content.append(note_para)

    inner = Table([[c] for c in card_content], colWidths=[PAGE_W - 2*MARGIN - 8*mm])
    inner.setStyle(TableStyle([
        ('LEFTPADDING', (0,0), (-1,-1), 4*mm),
        ('RIGHTPADDING', (0,0), (-1,-1), 4*mm),
        ('TOPPADDING', (0,0), (0,0), 3*mm),
        ('TOPPADDING', (0,1), (-1,-1), 0),
        ('BOTTOMPADDING', (0,-1), (-1,-1), 3*mm),
        ('BOTTOMPADDING', (0,0), (-1,-2), 0),
    ]))

    # Blue left border via outer table
    card = Table([[inner]], colWidths=[PAGE_W - 2*MARGIN])
    card.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), white),
        ('LINEABOVE', (0,0), (-1,-1), 0.5, BORDER_LIGHT),
        ('LINEBELOW', (0,-1), (-1,-1), 0.5, BORDER_LIGHT),
        ('LINEBEFORE', (0,0), (0,-1), 3, BRAND_BLUE),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
    ]))

    return card

# ── Main ────────────────────────────────────────────────────────────────────────
def generate(chemicals, output_path):
    generated = datetime.now().strftime('%d %B %Y, %H:%M')
    styles = build_styles()

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=18*mm, bottomMargin=14*mm,
        title='Chemicals Register — Safety Information Sheet',
        author='Perplexity Computer',
    )

    story = []

    # ── Cover / TOC ──
    story += build_cover(styles, chemicals, generated)

    # Group by category
    by_cat = {}
    for c in chemicals:
        cat = c.get('category', 'other')
        by_cat.setdefault(cat, []).append(c)

    # TOC entries on cover page
    for cat_key, chems in sorted(by_cat.items(), key=lambda x: CATEGORY_LABELS.get(x[0], x[0])):
        cat_label = CATEGORY_LABELS.get(cat_key, cat_key)
        story.append(Paragraph(f'{cat_label}  ({len(chems)} product{"s" if len(chems) > 1 else ""})',
                               styles['toc_cat']))
        for c in chems:
            name = c.get('product_name', '')
            code = c.get('chemform_product_code', '')
            label = f'{name}  {("(" + code + ")") if code else ""}'.strip()
            story.append(Paragraph(f'· {label}', styles['toc_item']))
        story.append(Spacer(1, 1.5*mm))

    story.append(PageBreak())

    # ── Chemical cards ──
    for cat_key, chems in sorted(by_cat.items(), key=lambda x: CATEGORY_LABELS.get(x[0], x[0])):
        cat_label = CATEGORY_LABELS.get(cat_key, cat_key)

        # Category header
        cat_header_inner = Table(
            [[Paragraph(cat_label.upper(), ParagraphStyle('ch',
                fontName=SUBHEAD_FONT if fonts_ok else 'Helvetica-Bold',
                fontSize=9, leading=12, textColor=white))]],
            colWidths=[PAGE_W - 2*MARGIN]
        )
        cat_header_inner.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), BRAND_BLUE),
            ('LEFTPADDING', (0,0), (-1,-1), 4*mm),
            ('RIGHTPADDING', (0,0), (-1,-1), 4*mm),
            ('TOPPADDING', (0,0), (-1,-1), 2.5*mm),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2.5*mm),
        ]))
        story.append(Spacer(1, 3*mm))
        story.append(KeepTogether([cat_header_inner, Spacer(1, 1*mm)]))

        for chem in chems:
            card = build_chemical_card(chem, styles)
            story.append(KeepTogether([card, Spacer(1, 2*mm)]))

    # ── Final WHS page ──
    story.append(PageBreak())
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph('WHS OBLIGATIONS & SAFE HANDLING', styles['section_header']))
    story.append(HRFlowable(width='100%', thickness=1, color=BRAND_BLUE))
    story.append(Spacer(1, 3*mm))

    whs_points = [
        ('Legal requirement', 'Under the Work Health & Safety Regulations 2011 (WA), employers must maintain a hazardous chemicals register and ensure Safety Data Sheets are readily accessible to all workers.'),
        ('SDS currency', 'Safety Data Sheets must be current (no older than 5 years from the issue date). Review SDS dates annually and request updated versions from Chemform where required.'),
        ('Staff training', 'All staff who use or may be exposed to chemicals must be trained in safe use, storage, spill response, and PPE requirements before handling.'),
        ('PPE', 'Refer to the SDS for each product for required personal protective equipment. Minimum standard: wash hands after handling any chemical product.'),
        ('Food contact surfaces', 'Only products marked "Food Contact Safe" may be used on surfaces that contact food directly. Non-food-safe chemicals must be thoroughly rinsed away before surfaces are used for food preparation.'),
        ('No-rinse products', 'No-rinse sanitisers may be left on food contact surfaces only when diluted and used per the product label. Do not use at higher than recommended concentrations.'),
        ('Storage', 'Store all chemicals in original containers, in a cool dry location, away from food and food contact surfaces. Do not mix chemicals.'),
        ('Spills', 'In the event of a chemical spill, refer to the SDS for the relevant product. Do not leave spills unattended. Report all incidents to the supervisor.'),
        ('Chemform contact', 'For SDS updates, technical questions, or chemical safety concerns contact Chemform Australia at chemform.com.au'),
    ]

    for title, body in whs_points:
        row = Table(
            [[Paragraph(f'<b>{title}</b>', styles['body']),
              Paragraph(body, styles['body'])]],
            colWidths=[35*mm, PAGE_W - 2*MARGIN - 37*mm]
        )
        row.setStyle(TableStyle([
            ('LEFTPADDING', (0,0), (-1,-1), 0), ('RIGHTPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 2*mm), ('BOTTOMPADDING', (0,0), (-1,-1), 2*mm),
            ('LINEBELOW', (0,0), (-1,-1), 0.5, BORDER_LIGHT),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ]))
        story.append(row)

    story.append(Spacer(1, 6*mm))
    story.append(HRFlowable(width='100%', thickness=1, color=BORDER_LIGHT))
    story.append(Spacer(1, 3*mm))
    story.append(Paragraph(
        f'This register was generated on {generated}. '
        'It should be reviewed and reprinted whenever chemicals are added, removed, or changed. '
        'All SDS documents are available directly from Chemform at '
        '<a href="https://chemform.com.au" color="#256984">chemform.com.au</a>.',
        styles['body_small']
    ))

    doc.build(story, onFirstPage=make_page_template, onLaterPages=make_page_template)

if __name__ == '__main__':
    json_data   = sys.argv[1]
    output_path = sys.argv[2]
    chemicals   = json.loads(json_data)
    generate(chemicals, output_path)
    print(json.dumps({'ok': True, 'path': output_path}))
