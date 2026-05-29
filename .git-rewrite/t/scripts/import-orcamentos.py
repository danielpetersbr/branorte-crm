import os, re, json, sys
from docx import Document

base = r"Z:\1 - Comercial\3 - Orçamento\2026\Orçamentos 2026"

VENDOR_MAP = {
    'ALVARO': 'ea6180cd-3e80-428f-b80e-bf79aba81273',
    'GUSTAVO': 'ffe781ba-4949-42fc-9fba-8aeadc31beda',
    'EDER': '1eef7c6c-92cd-4319-9f73-fb69688abbb5',
    'EDILSON JR': '4edf6bcf-eb54-4a50-8ee9-112971cd6210',
    'EDILSON': '4edf6bcf-eb54-4a50-8ee9-112971cd6210',
    'PEDRO': '37d80699-2595-44b9-9895-4d4bdfb6cfe7',
    'JARDEL': '878db1c1-5cc2-4b89-ad50-96f766faaa7a',
    'DANIEL': '01e32cdc-94b2-47fd-a4a3-c6a39a8ecef1',
    'MATHEUS': '5766f77c-0e03-40ba-a4c6-a22784b21f27',
    'RAMON': '17579558-09e4-492c-a352-95c4589f239e',
    'MARILENE': '81de6151-b967-461c-9784-759c3f95b0e5',
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
    digits = re.sub(r'\D', '', raw)
    if len(digits) == 11 and digits[2] == '9':
        return '55' + digits
    if len(digits) == 13 and digits[:2] == '55' and digits[4] == '9':
        return digits
    if len(digits) == 10:
        return '55' + digits  # fixo
    return None

def get_vendor(txt_content):
    lower = txt_content.lower()
    for name, vid in VENDOR_MAP.items():
        if name.lower() in lower:
            return vid
    return None

def extract_from_docx(docx_path):
    try:
        doc = Document(docx_path)
        text = '\n'.join(p.text for p in doc.paragraphs)
    except:
        return None, None, None

    # Extract client name
    client_match = re.search(r'CLIENTE:\s*(.+?)(?:\s{2,}|$)', text)
    client = client_match.group(1).strip() if client_match else ''

    # Extract phone
    phone_match = re.search(r'FONE:\s*([\d\s\(\)\-\.]+)', text)
    phone = None
    if phone_match:
        phone = clean_phone(phone_match.group(1))

    # Extract city
    city_match = re.search(r'CIDADE:\s*(.+?)(?:\s{2,}|\n|$)', text)
    city = city_match.group(1).strip() if city_match else ''

    return client, phone, city

results = []

for month_dir in sorted(os.listdir(base)):
    month_path = os.path.join(base, month_dir)
    if not os.path.isdir(month_path):
        continue

    # Group files by orcamento ID
    files = {}
    for fname in os.listdir(month_path):
        match = re.match(r'(\d{4}\s*-\s*\d{4})', fname)
        if match:
            oid = match.group(1).replace(' ', '')
            if oid not in files:
                files[oid] = {}
            if fname.endswith('.txt'):
                files[oid]['txt'] = os.path.join(month_path, fname)
            elif fname.endswith('.docx'):
                files[oid]['docx'] = os.path.join(month_path, fname)

    for oid, fpaths in files.items():
        # Read vendor from txt
        vendor_id = None
        txt_content = ''
        if 'txt' in fpaths:
            try:
                with open(fpaths['txt'], 'r', encoding='utf-8', errors='ignore') as f:
                    txt_content = f.read().strip()
            except:
                pass
            vendor_id = get_vendor(txt_content)

        # Extract client/phone from docx
        client, phone, city = '', None, ''
        if 'docx' in fpaths:
            client, phone, city = extract_from_docx(fpaths['docx'])

        # Fallback: get client from filename
        if not client and 'txt' in fpaths:
            fname = os.path.basename(fpaths.get('docx', fpaths.get('txt', '')))
            m = re.match(r'\d{4}\s*-\s*\d{4}\s*-\s*(.+?)(?:\s*\(|\.)', fname)
            if m:
                client = m.group(1).strip()

        # Get state from DDD
        state = ''
        if phone and len(phone) >= 4:
            ddd = phone[2:4]
            state = DDD_UF.get(ddd, '')

        # Extract date from txt
        date_match = re.search(r'(\d{2}/\d{2}/\d{4})', txt_content)
        date = date_match.group(1) if date_match else ''

        results.append({
            'orcamento': oid,
            'client': client or '',
            'phone': phone,
            'city': city or '',
            'state': state,
            'vendor_id': vendor_id,
            'date': date,
            'month': month_dir,
        })

# Stats
print(f"Total orcamentos: {len(results)}")
print(f"Com telefone: {sum(1 for r in results if r['phone'])}")
print(f"Com vendedor: {sum(1 for r in results if r['vendor_id'])}")
print(f"Com cliente: {sum(1 for r in results if r['client'])}")

# Save as JSON for import
output = r"C:\Users\Usuario\Desktop\Listas de Contatos Branorte\orcamentos_contatos.json"
with open(output, 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print(f"\nSaved to {output}")

# Show samples
for r in results[:10]:
    v = 'SEM' if not r['vendor_id'] else [k for k,v in VENDOR_MAP.items() if v == r['vendor_id']][0]
    print(f"  {r['orcamento']} | {r['client'][:35]:35s} | {r['phone'] or 'SEM TEL':15s} | {v:12s} | {r['city'][:20]}")
