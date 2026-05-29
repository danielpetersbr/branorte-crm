import os, re, json, sys
from docx import Document

BASE = r"Z:\1 - Comercial\3 - Orçamento"
YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]

VENDOR_MAP = {
    'alvaro': 'ea6180cd-3e80-428f-b80e-bf79aba81273',
    'gustavo': 'ffe781ba-4949-42fc-9fba-8aeadc31beda',
    'eder': '1eef7c6c-92cd-4319-9f73-fb69688abbb5',
    'edilson': '4edf6bcf-eb54-4a50-8ee9-112971cd6210',
    'pedro': '37d80699-2595-44b9-9895-4d4bdfb6cfe7',
    'jardel': '878db1c1-5cc2-4b89-ad50-96f766faaa7a',
    'daniel': '01e32cdc-94b2-47fd-a4a3-c6a39a8ecef1',
    'matheus': '5766f77c-0e03-40ba-a4c6-a22784b21f27',
    'ramon': '17579558-09e4-492c-a352-95c4589f239e',
    'marilene': '81de6151-b967-461c-9784-759c3f95b0e5',
    'biga': None,
    'pericles': None,
    'perecles': None,
    'hamurabi': None,
    'flavio': None,
    'patrick': None,
}

DDD_UF = {
    '11':'SP','12':'SP','13':'SP','14':'SP','15':'SP','16':'SP','17':'SP','18':'SP','19':'SP',
    '21':'RJ','22':'RJ','24':'RJ','27':'ES','28':'ES',
    '31':'MG','32':'MG','33':'MG','34':'MG','35':'MG','37':'MG','38':'MG',
    '41':'PR','42':'PR','43':'PR','44':'PR','45':'PR','46':'PR',
    '47':'SC','48':'SC','49':'SC','51':'RS','53':'RS','54':'RS','55':'RS',
    '61':'DF','62':'GO','63':'TO','64':'GO','65':'MT','66':'MT','67':'MS','68':'AC','69':'RO',
    '71':'BA','73':'BA','74':'BA','75':'BA','77':'BA','79':'SE',
    '81':'PE','82':'AL','83':'PB','84':'RN','85':'CE','86':'PI','87':'PE','88':'CE','89':'PI',
    '91':'PA','92':'AM','93':'PA','94':'PA','95':'RR','96':'AP','97':'AM','98':'MA','99':'MA',
}


def clean_phone(raw):
    if not raw:
        return None
    digits = re.sub(r'\D', '', str(raw))
    if len(digits) == 11 and digits[2] == '9':
        return '55' + digits
    if len(digits) == 13 and digits[:2] == '55' and digits[4] == '9':
        return digits
    if len(digits) == 10:
        return '55' + digits
    if len(digits) == 12 and digits[:2] == '55':
        return digits
    return None


def get_vendor_id(txt_content):
    lower = txt_content.lower()
    for name, vid in VENDOR_MAP.items():
        if name in lower:
            return vid
    return None


def extract_from_docx(docx_path):
    try:
        doc = Document(docx_path)
        text = '\n'.join(p.text for p in doc.paragraphs[:30])
    except:
        return None, None, None

    client_match = re.search(r'CLIENTE:\s*(.+?)(?:\s{2,}|$)', text)
    client = client_match.group(1).strip() if client_match else ''

    phone_match = re.search(r'FONE:\s*([\d\s\(\)\-\.]+)', text)
    phone = clean_phone(phone_match.group(1)) if phone_match else None

    city_match = re.search(r'CIDADE:\s*(.+?)(?:\s{2,}|\n|$)', text)
    city = city_match.group(1).strip() if city_match else ''

    return client, phone, city


def get_product_from_filename(fname):
    match = re.search(r'\((.+?)\)', fname)
    return match.group(1).strip() if match else None


def get_orcamento_id(fname):
    match = re.match(r'(\d{4})\s*-\s*(\d{4})', fname)
    if match:
        return f"{match.group(1)}-{match.group(2)}"
    return None


def process_year(year):
    orc_dir = os.path.join(BASE, str(year), f"Orçamentos {year}")
    if not os.path.isdir(orc_dir):
        return []

    results = []

    # Group files by orcamento ID across all subfolders
    files_map = {}

    for root, dirs, files in os.walk(orc_dir):
        for fname in files:
            oid = get_orcamento_id(fname)
            if not oid:
                continue
            if oid not in files_map:
                files_map[oid] = {'txt': None, 'docx': None, 'fname': fname}
            fpath = os.path.join(root, fname)
            if fname.endswith('.txt'):
                files_map[oid]['txt'] = fpath
            elif fname.endswith('.docx') and not fname.startswith('~$'):
                files_map[oid]['docx'] = fpath
                files_map[oid]['fname'] = fname

    for oid, fpaths in files_map.items():
        # Vendor from txt
        vendor_id = None
        txt_content = ''
        if fpaths['txt']:
            try:
                with open(fpaths['txt'], 'r', encoding='utf-8', errors='ignore') as f:
                    txt_content = f.read().strip()
            except:
                pass
            vendor_id = get_vendor_id(txt_content)

        # Client/phone from docx
        client, phone, city = '', None, ''
        if fpaths['docx']:
            client, phone, city = extract_from_docx(fpaths['docx'])

        # Fallback client from filename
        if not client:
            m = re.match(r'\d{4}\s*-\s*\d{4}\s*-\s*(.+?)(?:\s*\(|\.)', fpaths['fname'])
            if m:
                client = m.group(1).strip()

        # Product from filename
        produto = get_product_from_filename(fpaths['fname']) or ''

        # State from DDD
        state = ''
        if phone and len(phone) >= 4:
            state = DDD_UF.get(phone[2:4], '')

        # Date from txt
        date_match = re.search(r'(\d{2}/\d{2}/\d{4})', txt_content)
        date = date_match.group(1) if date_match else ''

        results.append({
            'orcamento': oid,
            'client': client or '',
            'phone': phone,
            'city': city or '',
            'state': state,
            'vendor_id': vendor_id,
            'produto': produto,
            'date': date,
            'year': year,
        })

    return results


# Process all years
all_results = []
for year in YEARS:
    print(f"Processing {year}...", end=' ', flush=True)
    r = process_year(year)
    print(f"{len(r)} orcamentos ({sum(1 for x in r if x['phone'])} com tel)")
    all_results.extend(r)

print(f"\nTOTAL: {len(all_results)} orcamentos")
print(f"Com telefone: {sum(1 for r in all_results if r['phone'])}")
print(f"Com vendedor: {sum(1 for r in all_results if r['vendor_id'])}")
print(f"Com produto: {sum(1 for r in all_results if r['produto'])}")

# Save
output = r"C:\Users\Usuario\Desktop\Listas de Contatos Branorte\all_orcamentos.json"
with open(output, 'w', encoding='utf-8') as f:
    json.dump(all_results, f, ensure_ascii=False, indent=2)
print(f"Saved to {output}")

# Stats by year
from collections import Counter
yc = Counter(r['year'] for r in all_results if r['phone'])
for y in sorted(yc.keys()):
    print(f"  {y}: {yc[y]} com telefone")
