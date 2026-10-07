-- Regression harness for CRM WhatsApp identity. No production rows are written.
-- Run in a dedicated SQL session. Everything created below is pg_temp and rolled back.
-- It clones the DEPLOYED trigger bodies rather than reimplementing their behavior.
BEGIN;
SET LOCAL statement_timeout = '15s';

CREATE TEMP TABLE contacts (LIKE public.contacts INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP;
CREATE TEMP TABLE crm_chat_conversations (LIKE public.crm_chat_conversations INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP;
CREATE TEMP TABLE wa_chat_labels (LIKE public.wa_chat_labels INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP;
CREATE TEMP TABLE wa_chat_messages (LIKE public.wa_chat_messages INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP;
CREATE TEMP TABLE identity_test_results (test text, passed boolean, detail text) ON COMMIT DROP;

DO $bootstrap$
DECLARE f record; definition text; table_name text;
BEGIN
  -- Add any new helper name to this list before validating a candidate patch.
  FOR f IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.proname IN (
      'crm_chat_inbound_may_reopen',
      'crm_chat_phone', 'crm_chat_identity', 'crm_chat_resolve_identity',
      'crm_chat_sync_message', 'crm_chat_sync_label'
    )
    ORDER BY CASE WHEN p.proname IN ('crm_chat_sync_message','crm_chat_sync_label') THEN 1 ELSE 0 END, p.proname
  LOOP
    definition := pg_get_functiondef(f.oid);
    -- Rewrite only the whitelisted identity functions and tables.
    definition := replace(definition, 'private.' || f.proname || '(', 'pg_temp.' || f.proname || '(');
    definition := replace(definition, 'private.crm_chat_phone(', 'pg_temp.crm_chat_phone(');
    definition := replace(definition, 'private.crm_chat_identity(', 'pg_temp.crm_chat_identity(');
    definition := replace(definition, 'private.crm_chat_resolve_identity(', 'pg_temp.crm_chat_resolve_identity(');
    definition := replace(definition, 'private.crm_chat_inbound_may_reopen(', 'pg_temp.crm_chat_inbound_may_reopen(');
    FOREACH table_name IN ARRAY ARRAY['contacts','crm_chat_conversations','wa_chat_labels','wa_chat_messages'] LOOP
      definition := replace(definition, 'public.' || table_name, 'pg_temp.' || table_name);
    END LOOP;
    EXECUTE definition;
  END LOOP;
END $bootstrap$;

CREATE TRIGGER test_message_arrived AFTER INSERT ON pg_temp.wa_chat_messages FOR EACH ROW EXECUTE FUNCTION pg_temp.crm_chat_sync_message();
CREATE TRIGGER test_label_arrived AFTER INSERT OR UPDATE ON pg_temp.wa_chat_labels FOR EACH ROW EXECUTE FUNCTION pg_temp.crm_chat_sync_label();

-- 1: A message arrives before the exact LID -> phone mapping. The later label
-- must repair identity, without changing who owns the conversation or history.
INSERT INTO pg_temp.wa_chat_messages(id,vendedor_nome,chat_id,phone,msg_id,from_me,tipo,body,data_msg)
VALUES(-1,'ANA','247557754245325@lid',null,'identity-test-1',false,'chat','Test inbound','2026-10-01 12:00Z');
INSERT INTO pg_temp.identity_test_results
SELECT 'unresolved LID is not displayed as phone', phone IS NULL OR phone='', 'phone=' || coalesce(phone,'NULL')
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='247557754245325@lid';

UPDATE pg_temp.crm_chat_conversations
SET vendor_id='00000000-0000-0000-0000-000000000001', status='resolved', human_hold=true, last_preview='Keep this preview'
WHERE wa_chat_id='247557754245325@lid';
CREATE TEMP TABLE before_label AS SELECT * FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='247557754245325@lid';
INSERT INTO pg_temp.wa_chat_labels(vendedor_nome,chat_id,phone,contact_name,last_message_at,last_message_preview,last_message_from_me)
VALUES('ANA','247557754245325@lid','554896902023','Doglas Philippi','2026-10-01 11:00Z','Stale label preview',true);

INSERT INTO pg_temp.identity_test_results
SELECT 'label arriving later repairs phone and placeholder name', phone='554896902023' AND name='Doglas Philippi', phone || ' / ' || name
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='247557754245325@lid';
INSERT INTO pg_temp.identity_test_results
SELECT 'label identity repair preserves owner/status/history',
 (to_jsonb(c)-ARRAY['phone','name','contact_id','updated_at'])=(to_jsonb(b)-ARRAY['phone','name','contact_id','updated_at']),
 'Only identity fields may change'
FROM pg_temp.crm_chat_conversations c CROSS JOIN pg_temp.before_label b WHERE c.wa_chat_id=b.wa_chat_id;

-- 2: A subsequent message without a phone never downgrades resolved identity.
INSERT INTO pg_temp.wa_chat_messages(id,vendedor_nome,chat_id,phone,msg_id,from_me,tipo,body,data_msg)
VALUES(-2,'ANA','247557754245325@lid',null,'identity-test-2',true,'chat','Next outbound','2026-10-01 13:00Z');
INSERT INTO pg_temp.identity_test_results
SELECT 'later message preserves real identity', phone='554896902023' AND name='Doglas Philippi' AND status='resolved' AND human_hold AND last_preview='Next outbound', phone || ' / ' || name
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='247557754245325@lid';

-- 3: A valid manually chosen name is preserved while the phone is repaired.
INSERT INTO pg_temp.crm_chat_conversations(wa_chat_id,phone,name,vendor_id,status)
VALUES('86084163788870@lid','86084163788870','Wellington - Fazenda do Oeste','00000000-0000-0000-0000-000000000002','resolved');
INSERT INTO pg_temp.wa_chat_labels(vendedor_nome,chat_id,phone,contact_name)
VALUES('ANA','86084163788870@lid','554199454272','Wellington Roberto Ramos');
INSERT INTO pg_temp.identity_test_results
SELECT 'label repair preserves manual valid name and owner', phone='554199454272' AND name='Wellington - Fazenda do Oeste' AND vendor_id='00000000-0000-0000-0000-000000000002' AND status='resolved', phone || ' / ' || name
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='86084163788870@lid';

-- 4: Labels before messages are usable at initial materialization.
INSERT INTO pg_temp.wa_chat_labels(vendedor_nome,chat_id,phone,contact_name)
VALUES('ANA','1890574184587@lid','556399613494','Daniel braga');
INSERT INTO pg_temp.wa_chat_messages(id,vendedor_nome,chat_id,phone,msg_id,from_me,tipo,body,data_msg)
VALUES(-3,'ANA','1890574184587@lid',null,'identity-test-3',true,'chat','After label','2026-10-01 13:00Z');
INSERT INTO pg_temp.identity_test_results
SELECT 'message after label keeps identity', phone='556399613494' AND name='Daniel braga', phone || ' / ' || name
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='1890574184587@lid';

-- 5: A label UPDATE repairs placeholders too (sync commonly upserts labels).
UPDATE pg_temp.crm_chat_conversations SET phone='1890574184587',name='1890574184587@lid' WHERE wa_chat_id='1890574184587@lid';
UPDATE pg_temp.wa_chat_labels SET updated_at=now() WHERE chat_id='1890574184587@lid';
INSERT INTO pg_temp.identity_test_results
SELECT 'label update repairs stale placeholder', phone='556399613494' AND name='Daniel braga', phone || ' / ' || name
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='1890574184587@lid';

-- 6: Labels on other accounts or group rows never leak into Ana's mirror.
INSERT INTO pg_temp.wa_chat_labels(vendedor_nome,chat_id,phone,contact_name)
VALUES('IGOR','999000000000001@lid','554891111111','Other account'),('ANA','120000000000001@g.us','554892222222','Group');
INSERT INTO pg_temp.wa_chat_messages(id,vendedor_nome,chat_id,phone,msg_id,from_me,tipo,body,data_msg)
VALUES(-4,'IGOR','999000000000001@lid','554891111111','identity-test-4',false,'chat','Other account','2026-10-01 13:00Z'),
(-5,'ANA','120000000000001@g.us',null,'identity-test-5',false,'chat','Group','2026-10-01 13:00Z');
INSERT INTO pg_temp.identity_test_results
SELECT 'non-ANA and groups are skipped', count(*)=0, count(*)::text
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id IN ('999000000000001@lid','120000000000001@g.us');

-- 7: Neither a numeric LID in phone nor a full @lid identifier is a telephone.
INSERT INTO pg_temp.wa_chat_messages(id,vendedor_nome,chat_id,phone,msg_id,from_me,tipo,body,data_msg)
VALUES(-6,'ANA','247557754245399@lid','247557754245399','identity-test-6',true,'chat','Numeric LID','2026-10-01 13:00Z'),
(-7,'ANA','247557754245388@lid','247557754245388@lid','identity-test-7',true,'chat','Full LID','2026-10-01 13:00Z');
INSERT INTO pg_temp.identity_test_results
SELECT 'raw LID phone values are rejected', count(*)=2 AND bool_and(phone=''), string_agg(phone, ' / ')
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id IN ('247557754245399@lid','247557754245388@lid');

-- 8: A genuine phone-addressed chat can still supply its phone without labels.
INSERT INTO pg_temp.wa_chat_messages(id,vendedor_nome,chat_id,phone,msg_id,from_me,tipo,body,data_msg)
VALUES(-8,'ANA','554898765432@c.us',null,'identity-test-8',true,'chat','Phone JID','2026-10-01 13:00Z');
INSERT INTO pg_temp.identity_test_results
SELECT 'phone-addressed chat has phone without labels', phone='554898765432', phone
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='554898765432@c.us';

-- 9: Identity resolution can link the known CRM contact without taking ownership
-- away from the current assignee or replacing a valid manually chosen name.
INSERT INTO pg_temp.contacts(id,phone,name,vendor_id)
VALUES('00000000-0000-0000-0000-000000000010','554893333333','Known CRM contact','00000000-0000-0000-0000-000000000003');
INSERT INTO pg_temp.crm_chat_conversations(wa_chat_id,phone,name,vendor_id,status)
VALUES('247557754245377@lid','247557754245377','Name chosen by operator','00000000-0000-0000-0000-000000000004','resolved');
INSERT INTO pg_temp.wa_chat_labels(vendedor_nome,chat_id,phone,contact_name)
VALUES('ANA','247557754245377@lid','554893333333','WhatsApp contact');
INSERT INTO pg_temp.identity_test_results
SELECT 'contact enrichment preserves manual identity and assignment',
phone='554893333333' AND contact_id='00000000-0000-0000-0000-000000000010' AND name='Name chosen by operator'
 AND vendor_id='00000000-0000-0000-0000-000000000004' AND status='resolved', phone || ' / ' || name
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='247557754245377@lid';

-- 10: A changed real phone must be visible inside the current label sync.
UPDATE pg_temp.wa_chat_labels SET phone='556399612222',contact_name='Daniel updated' WHERE chat_id='1890574184587@lid';
INSERT INTO pg_temp.identity_test_results
SELECT 'updated real phone applies on same sync',phone='556399612222',phone
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='1890574184587@lid';

-- 11: fone_canon strips/truncates digits for Brazilian matching. International
-- numbers must not accidentally attach to an unrelated Brazilian CRM contact.
INSERT INTO pg_temp.contacts(id,phone,name)
VALUES('00000000-0000-0000-0000-000000000011','554155552671','Unrelated Brazilian');
INSERT INTO pg_temp.wa_chat_labels(vendedor_nome,chat_id,phone,contact_name)
VALUES('ANA','247557754245366@lid','+14155552671','US contact');
INSERT INTO pg_temp.identity_test_results
SELECT 'foreign phone must not crossmatch Brazilian canon',contact_id IS NULL AND name='US contact',
 phone||' / '||name||' / '||coalesce(contact_id::text,'NULL')
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='247557754245366@lid';

-- 12: A canonical match is not authority to choose between duplicate contacts.
INSERT INTO pg_temp.contacts(id,phone,name)
VALUES('00000000-0000-0000-0000-000000000012','5548998654321','Canonical candidate A'),
('00000000-0000-0000-0000-000000000013','+5548998654321','Canonical candidate B');
INSERT INTO pg_temp.wa_chat_labels(vendedor_nome,chat_id,phone,contact_name)
VALUES('ANA','247557754245355@lid','554898654321','Ambiguous WhatsApp contact');
INSERT INTO pg_temp.identity_test_results
SELECT 'ambiguous canonical contacts are not guessed',contact_id IS NULL AND name='Ambiguous WhatsApp contact',
 phone||' / '||name||' / '||coalesce(contact_id::text,'NULL')
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='247557754245355@lid';

-- 13: An exact phone match takes priority over ambiguous canonical variants.
INSERT INTO pg_temp.contacts(id,phone,name)
VALUES('00000000-0000-0000-0000-000000000014','554898654321','Exact CRM contact');
UPDATE pg_temp.wa_chat_labels SET updated_at=now() WHERE chat_id='247557754245355@lid';
INSERT INTO pg_temp.identity_test_results
SELECT 'exact phone outranks canonical ambiguity',contact_id='00000000-0000-0000-0000-000000000014',coalesce(contact_id::text,'NULL')
FROM pg_temp.crm_chat_conversations WHERE wa_chat_id='247557754245355@lid';

SELECT test,passed,detail FROM pg_temp.identity_test_results ORDER BY test;
-- Expected: fifteen rows, all passed=true. Baseline fails the late-mapping tests.
ROLLBACK;
