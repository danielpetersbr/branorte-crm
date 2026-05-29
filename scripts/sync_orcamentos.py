"""
sync_orcamentos.py
------------------
Sincroniza orçamentos da Z: drive com o Supabase CRM.
Roda via Agendador de Tarefas do Windows (ex: a cada 1h).

1. Varre Z: → coleta orçamentos por YYYY-NNNN
2. Compara com banco → importa faltantes
3. Atualiza telefone, data e descrição dos que têm ORC-* no phone
"""
import os, re, json, urllib.request, urllib.error, urllib.parse, sys, zipfile, logging
from datetime import datetime
from pathlib import Path

# --- Config ---
SUPABASE_URL = 'https://flwbeevtvjiouxdjmziv.supabase.co'

# Service role bypassa RLS (necessario pro INSERT em contacts). Le do .env
# do branorte-auditoria, evita hardcoding no repo.
def _load_service_key():
    env_path = Path(r'd:\MEGA BRAIN\branorte-auditoria\.config\.env.supabase')
    if env_path.exists():
        for line in env_path.read_text(encoding='utf-8').splitlines():
            if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
                return line.split('=', 1)[1].strip()
    # Fallback: env var
    return os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

SERVICE_KEY = _load_service_key()
if not SERVICE_KEY:
    print('ERRO: SUPABASE_SERVICE_ROLE_KEY nao encontrada. Sem ela RLS bloqueia INSERT.')
    sys.exit(1)
ANON_KEY = SERVICE_KEY  # mantem nome ANON_KEY pra compatibilidade com o resto do codigo

LOG_DIR = Path(os.environ.get('TEMP', 'C:/Users/Daniel/AppData/Local/Temp')) / 'branorte-sync-logs'
LOG_DIR.mkdir(exist_ok=True)

# UUIDs reais da tabela vendors (atualizados 2026-05-29 — antigos estavam dessincronizados).
# Marilene e Matheus removidos do banco. LUCAS adicionado.
VENDORS = {
    'alvaro':   'a9a222dc-ee26-4fc0-ae8d-7a17f9396fd3',
    'daniel':   'a730f452-2ba9-4fb9-91a4-67b4af9d351d',
    'eder':     '32e02344-120a-4d4f-982a-a20be0850c04',
    'edilson':  'f998e257-ff89-46ed-a8f1-4c9e78232768',
    'gustavo':  '1af686b1-d2bc-48e1-8b6f-c986b0d66768',
    'jardel':   '5b0be5f9-296f-4a00-bd0b-6d52ac9d6397',
    'lucas':    'ab7b7aab-22e6-4569-8679-0e7960105864',
    'patrick':  '27bd70bd-df70-4910-821c-95ed53b48b00',
    'pedro':    '050b870b-ebc6-4a52-88c7-fdbbaf90a63a',
    'ramon':    'd6031266-7858-4008-a277-0a641e9e01df',
}

BASE = Path(r'Z:\1 - Comercial\3 - Orçamento')
CURRENT_YEAR = datetime.now().year
# Sync automático: só ano atual. Use --all para varrer tudo.
ALL_YEARS = '--all' in sys.argv
if ALL_YEARS:
    years = [y for y in range(2012, CURRENT_YEAR + 1) if y != 2013]
else:
    years = [CURRENT_YEAR]

YEAR_PATHS = {}
for y in years:
    if y <= 2018:
        YEAR_PATHS[str(y)] = BASE / str(y)
    else:
        YEAR_PATHS[str(y)] = BASE / str(y) / f'Orçamentos {y}'

# --- Logging ---
log_file = LOG_DIR / f'sync-{datetime.now():%Y-%m-%d_%H%M}.log'
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    handlers=[logging.FileHandler(log_file, encoding='utf-8'), logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger('sync')


# --- Helpers ---
def api_get(params):
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/contacts?{params}',
        headers={'apikey': ANON_KEY, 'Authorization': f'Bearer {ANON_KEY}'}
    )
    return json.loads(urllib.request.urlopen(req).read())


def fetch_existing():
    """Fetch all orçamento origins and phones from DB."""
    rows = {}
    offset = 0
    while True:
        batch = api_get(f'select=origin,phone&origin=like.Orcamento%25&limit=1000&offset={offset}')
        if not batch:
            break
        for c in batch:
            if c['origin']:
                rows[c['origin']] = c.get('phone', '')
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def insert_one(record):
    body = json.dumps(record, ensure_ascii=False).encode('utf-8')
    # on_conflict + ignore-duplicates: se telefone ja existe (veio do WA bot),
    # ignora silenciosamente em vez de erro 23505. Telefones novos sao inseridos.
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/contacts?on_conflict=telefone_normalizado',
        data=body, method='POST',
        headers={
            'apikey': ANON_KEY, 'Authorization': f'Bearer {ANON_KEY}',
            'Content-Type': 'application/json; charset=utf-8',
            'Prefer': 'return=minimal,resolution=ignore-duplicates',
        }
    )
    try:
        urllib.request.urlopen(req)
        return True, None
    except urllib.error.HTTPError as e:
        return False, e.read().decode('utf-8', errors='replace')[:150]
    except Exception as e:
        return False, str(e)


def patch_contact(origin, fields):
    body = json.dumps(fields, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/contacts?origin=eq.{urllib.parse.quote(origin)}',
        data=body, method='PATCH',
        headers={
            'apikey': ANON_KEY, 'Authorization': f'Bearer {ANON_KEY}',
            'Content-Type': 'application/json; charset=utf-8', 'Prefer': 'return=minimal',
        }
    )
    try:
        urllib.request.urlopen(req)
        return True, None
    except urllib.error.HTTPError as e:
        return False, e.read().decode('utf-8', errors='replace')[:150]
    except Exception as e:
        return False, str(e)


def extract_phone(path):
    try:
        with zipfile.ZipFile(path, 'r') as z:
            if 'word/document.xml' not in z.namelist():
                return None
            xml = z.read('word/document.xml').decode('utf-8', errors='replace')
            text = re.sub(r'<[^>]+>', ' ', xml)
            for p in re.findall(r'(?:\+55\s?)?(?:\(?\d{2}\)?\s?)(?:9\s?\d{4}|\d{4})[-.\s]?\d{4}', text):
                digits = re.sub(r'\D', '', p)
                if 10 <= len(digits) <= 13:
                    return digits
    except:
        pass
    return None


def extract_date(path):
    try:
        with zipfile.ZipFile(path, 'r') as z:
            if 'docProps/core.xml' in z.namelist():
                xml = z.read('docProps/core.xml').decode('utf-8', errors='replace')
                m = re.search(r'dcterms:created[^>]*>([^<]+)<', xml)
                if m:
                    ds = m.group(1).strip()[:10]
                    if re.match(r'^\d{4}-\d{2}-\d{2}$', ds):
                        return ds
    except:
        pass
    try:
        return datetime.fromtimestamp(os.path.getmtime(path)).strftime('%Y-%m-%d')
    except:
        return None


def extract_description(fname):
    base = re.sub(r'\.(docx?|pdf|txt)$', '', fname, flags=re.IGNORECASE)
    base = re.sub(r'^\d{4}\s*[-–—]\s*\d{1,4}\s*[-–—]\s*', '', base)
    base = re.sub(r'\s*\(\d+\)\s*$', '', base)
    return base.strip() or None


def extract_name(fname):
    base = re.sub(r'\.(docx?|pdf|txt)$', '', fname, flags=re.IGNORECASE)
    base = re.sub(r'^\d{4}\s*[-–—]\s*\d{1,4}\s*[-–—]\s*', '', base)
    base = re.sub(r'\s*\(.*', '', base)
    base = re.sub(r'\s+(trifásico|monofásico|trifasico|monofasico|Código Finame|codigo finame).*', '', base, flags=re.IGNORECASE)
    return base.strip() or None


def vendor_from_txt(txt):
    """Procura nome do vendedor no conteudo do .txt (1a linha geralmente eh
    'Ramon fernandes envio para o cliente dia 22/05/2026')."""
    if not txt:
        return None
    t = txt.lower()
    for kw in ['para daniel', 'para o daniel', 'ao daniel', 'p/ daniel']:
        if kw in t: return VENDORS['daniel']
    for kw in ['para patrick', 'para o patrick', 'ao patrick', 'p/ patrick']:
        if kw in t: return VENDORS['patrick']
    for kw in ['para gustavo', 'ao gustavo']:
        if kw in t: return VENDORS['gustavo']
    # Busca generica: qualquer nome do dict que apareca como palavra
    for name, vid in VENDORS.items():
        if re.search(rf'\b{name}\b', t):
            return vid
    return None


def vendor_from_filename(fname):
    """Detecta vendedor a partir do nome do arquivo. Casos comuns:
    - '2026 - 1011 - Cliente ... trifasico - Gustavo.txt'
    - '2026 - 0756 - Cliente ... Jardel.txt'
    - '2026 - 0007 - Cliente ... monofasico - EDER.txt'
    Pega o token apos o ultimo separador antes da extensao.
    """
    base = re.sub(r'\.(docx?|pdf|txt|xlsx?)$', '', fname, flags=re.IGNORECASE)
    base_l = base.lower()
    # Tenta achar nome de vendedor como palavra
    for name, vid in VENDORS.items():
        if re.search(rf'\b{name}\b', base_l):
            return vid
    return None


def resolve_path(p):
    """Try original path, then with accents."""
    if p.exists():
        return p
    alt = Path(str(p).replace('Orcamento', 'Orçamento').replace('Orcamentos', 'Orçamentos'))
    return alt if alt.exists() else None


# --- Main ---
def main():
    log.info('=== SYNC ORCAMENTOS INICIANDO ===')

    # Check Z: drive
    if not BASE.exists():
        log.warning('Z: drive nao acessivel. Abortando.')
        return

    # Step 1: fetch existing
    log.info('Buscando registros existentes no banco...')
    existing = fetch_existing()
    log.info(f'  {len(existing)} orcamentos no banco')

    # Step 2: scan Z: drive
    log.info('Varrendo Z: drive...')
    new_records = []
    update_records = []
    seen = set()

    for year, base_path in sorted(YEAR_PATHS.items()):
        resolved = resolve_path(base_path)
        if not resolved:
            continue

        year_new = 0
        year_update = 0

        for root_dir, dirs, files in os.walk(resolved):
            docx_map = {}
            txt_map = {}

            # docx_fnames_map: guarda TODOS os nomes de docx/txt do oid pra detectar
            # vendedor no nome do arquivo (ex: "Jardel.txt", "- Gustavo.docx")
            docx_fnames_map = {}
            for fname in files:
                m = re.match(r'^(\d{4})\s*[-–—]\s*(\d{1,4})', fname)
                if not m:
                    continue
                oid = f"{m.group(1)}-{m.group(2).zfill(4)}"
                fpath = os.path.join(root_dir, fname)

                if fname.lower().endswith(('.docx', '.doc')) and oid not in docx_map:
                    docx_map[oid] = (fname, fpath)
                elif fname.lower().endswith('.txt'):
                    try:
                        with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
                            txt_map[oid] = f.read().strip()
                    except:
                        pass
                # Junta nome de TODOS arquivos do oid (txt, docx, pdf, xlsx)
                docx_fnames_map.setdefault(oid, []).append(fname)

            for oid, (fname, fpath) in docx_map.items():
                origin = f"Orcamento {oid}"
                if oid in seen:
                    continue
                seen.add(oid)

                if origin not in existing:
                    # NEW — insert
                    name = extract_name(fname)
                    txt = txt_map.get(oid, '')
                    # Fallback em cascata: 1) conteudo do .txt → 2) nome de algum arquivo do oid
                    vendor_id = vendor_from_txt(txt)
                    if not vendor_id:
                        for fn in docx_fnames_map.get(oid, []):
                            vendor_id = vendor_from_filename(fn)
                            if vendor_id:
                                break
                    phone = extract_phone(fpath)
                    date = extract_date(fpath)
                    desc = extract_description(fname)

                    new_records.append({
                        'name': name,
                        'origin': origin,
                        'vendor_id': vendor_id,
                        'status': 'ABERTO',
                        'phone': phone or f'ORC-{oid}',
                        'data_orcamento': date,
                        'descricao_orcamento': desc,
                    })
                    year_new += 1

                elif (existing[origin] or '').startswith('ORC-'):
                    # EXISTS but needs phone/date/desc update
                    phone = extract_phone(fpath)
                    date = extract_date(fpath)
                    desc = extract_description(fname)
                    fields = {}
                    if phone:
                        fields['phone'] = phone
                    if date:
                        fields['data_orcamento'] = date
                    if desc:
                        fields['descricao_orcamento'] = desc
                    if fields:
                        update_records.append((origin, fields))
                        year_update += 1

        if year_new or year_update:
            log.info(f'  [{year}] novos: {year_new} | atualizar: {year_update}')

    # Step 3: insert new records
    if new_records:
        log.info(f'Inserindo {len(new_records)} novos orcamentos...')
        inserted = errors = 0
        for rec in new_records:
            ok, err = insert_one(rec)
            if ok:
                inserted += 1
            else:
                errors += 1
                if errors <= 5:
                    log.warning(f'  INSERT erro: {rec["origin"]} → {err}')
        log.info(f'  Inseridos: {inserted} | Erros: {errors}')
    else:
        log.info('Nenhum orcamento novo para inserir.')

    # Step 4: update existing with missing data
    if update_records:
        log.info(f'Atualizando {len(update_records)} orcamentos com dados faltantes...')
        updated = errors = 0
        for origin, fields in update_records:
            ok, err = patch_contact(origin, fields)
            if ok:
                updated += 1
            else:
                errors += 1
                if errors <= 5:
                    log.warning(f'  PATCH erro: {origin} → {err}')
        log.info(f'  Atualizados: {updated} | Erros: {errors}')
    else:
        log.info('Nenhum orcamento para atualizar.')

    log.info('=== SYNC CONCLUIDO ===\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        log.error(f'Erro fatal: {e}', exc_info=True)
