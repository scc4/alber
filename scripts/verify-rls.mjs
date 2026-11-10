// Verifica o RLS e os privilégios das migrations do Alber em Postgres em memória (PGlite), com stubs do Supabase.
//
// Uso:  node scripts/verify-rls.mjs [pasta-das-migrations] [all|pre]
//   all (padrão) aplica TODAS as migrations e roda as verificações (A1/M2/M3/W/063 da auditoria de 09/11/2026)
//   pre          aplica tudo MENOS a 062 e mostra o comportamento antigo (recursão, CPF legível, etc.)
// PGlite: a pasta node_modules do repositório alber-food (PGLITE_DIST sobrescreve o caminho do index.js).
// Sai com código 1 se alguma verificação falhar.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_DIST ?? 'C:/Users/fernando/alber-food/node_modules/@electric-sql/pglite/dist/index.js').href)
const MIG = process.argv[2] ?? fileURLToPath(new URL('../supabase/migrations', import.meta.url))
const only = process.argv[3] ?? 'all' // "pre" = sem a 062; "all" = com tudo

const db = new PGlite()
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
  CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, encrypted_password text, raw_app_meta_data jsonb DEFAULT '{}');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE PUBLICATION supabase_realtime;
  GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
`)

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()
let failed = 0
for (const f of files) {
  if (only === 'pre' && f.startsWith('20260101000062')) continue
  try { await db.exec(readFileSync(join(MIG, f), 'utf8')) } catch (e) { failed++; console.log('FALHOU', f, '->', String(e.message).split('\n')[0]) }
}
console.log(`migrations aplicadas: ${files.length - failed}/${files.length}${only === 'pre' ? ' (sem a 062)' : ''}`)

// ---- seed ----
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333'
const AA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', BA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', CA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const S1 = '44444444-4444-4444-8444-444444444444', SP1 = '55555555-5555-4555-8555-555555555555', K1 = '66666666-6666-4666-8666-666666666666'
for (const [id, auth, h] of [[A, AA, 'ana'], [B, BA, 'beto'], [C, CA, 'caio']]) {
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${auth}', '${h}@x.com')`)
  await db.exec(`INSERT INTO public.users (id, auth_id, name, email, cpf, phone, birth_date, handle, asaas_account_id, asaas_wallet_id, asaas_api_key_enc, onboarding_url, pix_key, kyc_status, account_status)
    VALUES ('${id}', '${auth}', 'Nome ${h}', '${h}@x.com', 'HASHCPF_${h}', '11999990000', '1990-01-01', '${h}', 'acc_${h}', 'w_${h}', 'ENC_KEY_${h}', 'https://onb/${h}', 'PIX_${h}', 'approved', 'active')`)
}
await db.exec(`INSERT INTO public.splits (id, owner_id, name, type, target_amount) VALUES ('${S1}', '${A}', 'Churras', 'fixed', 100)`)
await db.exec(`INSERT INTO public.split_participants (split_id, user_id) VALUES ('${S1}', '${A}'), ('${S1}', '${B}')`)
await db.exec(`INSERT INTO public.spaces (id, name, type, owner_id) VALUES ('${SP1}', 'Lounge', 'open', '${A}')`)
await db.exec(`INSERT INTO public.space_members (space_id, user_id, status) VALUES ('${SP1}', '${A}', 'active'), ('${SP1}', '${B}', 'active')`)
await db.exec(`INSERT INTO public.companies (id, owner_id, asaas_account_id, cnpj, company_name, company_type, address, address_number, province, postal_code, income_value, handle, asaas_api_key_enc)
  VALUES ('${K1}', '${A}', 'acc_k1', 'HASHCNPJ', 'Emp', 'MEI', 'Rua', '1', 'Centro', '01001000', 1000, 'emp', 'ENC_COMPANY_KEY')`)
await db.exec(`INSERT INTO public.company_operators (company_id, user_id, status, permissions) VALUES ('${K1}', '${B}', 'active', '{"ver_extrato": true}')`)
await db.exec(`UPDATE public.companies SET onboarding_url = 'https://onb/empresa' WHERE id = '${K1}'`)
await db.exec(`INSERT INTO public.transactions (type, amount, status, company_id, actor_ref) VALUES ('receber', 10, 'completed', '${K1}', 'ref1')`)

// ---- util ----
const run = async (role, sub, sql) => {
  try {
    await db.exec(`SET ROLE ${role}`)
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${sub ?? ''}', false)`)
    const r = await db.query(sql)
    return { ok: true, n: r.rows.length, rows: r.rows }
  } catch (e) { return { ok: false, err: String(e.message).split('\n')[0] } } finally { await db.exec('RESET ROLE') }
}
let pass = 0, fail = 0
const check = (name, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`${cond ? 'OK   ' : 'FALHA'} ${name}${extra ? ' | ' + extra : ''}`) }
const denied = (r) => !r.ok && /permission denied/i.test(r.err)

if (only === 'all') {
  // A1: colunas
  check('A1 par (B) NAO le users.cpf de outros', denied(await run('authenticated', BA, `select cpf from public.users`)))
  check('A1 par (B) NAO le asaas_api_key_enc', denied(await run('authenticated', BA, `select asaas_api_key_enc from public.users`)))
  check('A1 par (B) NAO le pix_key / asaas_wallet_id', denied(await run('authenticated', BA, `select pix_key from public.users`)) && denied(await run('authenticated', BA, `select asaas_wallet_id from public.users`)))
  check('A1 select * em users falha para authenticated', denied(await run('authenticated', BA, `select * from public.users`)))
  let r = await run('authenticated', AA, `select id, name, handle from public.users order by handle`)
  check('A1 dono do split (A) AINDA le id,name,handle de si e do participante B (nao de C)', r.ok && r.n === 2 && r.rows.map((x) => x.handle).join() === 'ana,beto', r.ok ? r.rows.map((x) => x.handle).join() : r.err)
  r = await run('authenticated', BA, `select id, name, handle from public.users order by handle`)
  check('A1 participante comum (B) ve so o proprio perfil (como na politica de producao)', r.ok && r.n === 1 && r.rows[0].handle === 'beto', r.ok ? r.rows.map((x) => x.handle).join() : r.err)
  r = await run('authenticated', AA, `select name from public.users where id = '${A}'`)
  check('A1 politica users_select_own continua funcionando (coluna auth_id)', r.ok && r.n === 1, r.ok ? '' : r.err)
  check('A1 anon NAO le users', denied(await run('anon', '', `select id from public.users`)))
  r = await run('authenticated', AA, `select public.get_my_onboarding_url() as u`)
  check('A1 get_my_onboarding_url() devolve SO a do proprio', r.ok && r.rows[0].u === 'https://onb/ana', r.ok ? r.rows[0].u : r.err)
  check('A1 get_my_onboarding_url() fechada para anon', denied(await run('anon', '', `select public.get_my_onboarding_url()`)))
  check('A1 security_questions: resposta nunca legivel', denied(await run('authenticated', AA, `select answer_hash from public.security_questions`)) && denied(await run('authenticated', AA, `select answer_enc from public.security_questions`)))
  r = await run('authenticated', AA, `select id, question from public.security_questions`)
  check('A1 security_questions: pergunta continua legivel', r.ok, r.ok ? '' : r.err)
  check('A1 sms_codes / pending_registrations / error_logs fechadas', denied(await run('authenticated', AA, `select code_hash from public.sms_codes`)) && denied(await run('authenticated', AA, `select cpf_hash from public.pending_registrations`)) && denied(await run('anon', '', `select id from public.error_logs`)))
  // M3: recursao
  r = await run('authenticated', BA, `select id, owner_id from public.companies`)
  check('M3 operador (B) le companies SEM recursao infinita', r.ok && r.n === 1, r.ok ? `linhas=${r.n}` : r.err)
  r = await run('authenticated', AA, `select id from public.companies`)
  check('M3 master (A) le companies', r.ok && r.n === 1, r.ok ? '' : r.err)
  check('M3 companies: colunas sensiveis fechadas', denied(await run('authenticated', AA, `select asaas_api_key_enc from public.companies`)) && denied(await run('authenticated', AA, `select cnpj from public.companies`)))
  r = await run('authenticated', AA, `select user_id from public.company_operators`)
  check('M3 master (A) ve operadores sem recursao', r.ok && r.n === 1, r.ok ? '' : r.err)
  r = await run('authenticated', BA, `select id from public.transactions`)
  check('M3 operador com ver_extrato (B) ve o extrato da empresa', r.ok && r.n === 1, r.ok ? '' : r.err)
  r = await run('authenticated', CA, `select id from public.transactions`)
  check('M3 estranho (C) NAO ve extrato', r.ok && r.n === 0, r.ok ? '' : r.err)
  r = await run('authenticated', AA, `select handle from public.users where id = '${B}'`)
  check('M3 master (A) ainda ve o perfil publico do operador', r.ok && r.n === 1, r.ok ? '' : r.err)
  // M2
  r = await run('authenticated', CA, `select * from public.get_user_space_ids('${A}')`)
  check('M2 C pedindo os lounges de A recebe NADA', r.ok && r.n === 0, r.ok ? `linhas=${r.n}` : r.err)
  r = await run('authenticated', AA, `select * from public.get_user_space_ids('${A}')`)
  check('M2 A pedindo os proprios lounges recebe', r.ok && r.n === 1, r.ok ? '' : r.err)
  r = await run('authenticated', CA, `select * from public.get_user_split_ids('${A}')`)
  check('M2 C pedindo os splits de A recebe NADA', r.ok && r.n === 0)
  r = await run('authenticated', AA, `select * from public.get_user_split_ids('${A}')`)
  check('M2 A pedindo os proprios splits recebe', r.ok && r.n === 1)
  check('M2 anon NAO executa get_user_space_ids / get_user_split_ids', denied(await run('anon', '', `select * from public.get_user_space_ids('${A}')`)) && denied(await run('anon', '', `select * from public.get_user_split_ids('${A}')`)))
  r = await run('authenticated', AA, `select public.get_my_company_onboarding_url('${K1}') as u`)
  check('A1 dono ve o link de KYC da propria empresa', r.ok && r.rows[0].u === 'https://onb/empresa', r.ok ? r.rows[0].u : r.err)
  r = await run('authenticated', BA, `select public.get_my_company_onboarding_url('${K1}') as u`)
  check('A1 operador ativo ve o link de KYC da empresa', r.ok && r.rows[0].u === 'https://onb/empresa', r.ok ? r.rows[0].u : r.err)
  r = await run('authenticated', CA, `select public.get_my_company_onboarding_url('${K1}') as u`)
  check('A1 estranho (C) recebe NULL do link de KYC da empresa', r.ok && r.rows[0].u === null, r.ok ? String(r.rows[0].u) : r.err)
  check('A1 anon NAO executa get_my_company_onboarding_url', denied(await run('anon', '', `select public.get_my_company_onboarding_url('${K1}')`)))
  // regressao: pares continuam vendo splits/lounges pelas politicas existentes
  r = await run('authenticated', BA, `select id from public.splits`)
  check('regressao: B (participante) ainda ve o split', r.ok && r.n === 1, r.ok ? '' : r.err)
  r = await run('authenticated', BA, `select id from public.spaces`)
  check('regressao: B (membro) ainda ve o lounge', r.ok && r.n >= 1, r.ok ? '' : r.err)
  // W: escrita
  check('W authenticated NAO atualiza users', denied(await run('authenticated', AA, `update public.users set name = 'x'`)))
  check('W authenticated NAO insere/apaga transactions', denied(await run('authenticated', AA, `insert into public.transactions (type, amount, status, actor_ref) values ('x', 1, 'x', 'r')`)) && denied(await run('authenticated', AA, `delete from public.transactions`)))
  check('W anon NAO escreve em users', denied(await run('anon', '', `update public.users set name = 'x'`)))
  r = await run('authenticated', AA, `insert into public.push_tokens (user_id, token, platform) values ('${A}', 'tok-123', 'ios') returning id`)
  check('W push_tokens: o proprio usuario ainda registra o token', r.ok, r.ok ? '' : r.err)
  r = await run('service_role', '', `select cpf, asaas_api_key_enc from public.users`)
  check('service_role (Edge Functions) segue lendo tudo', r.ok && r.n === 3, r.ok ? '' : r.err)
  // 063: credenciais privadas
  check('063 authenticated NAO le user_credentials', denied(await run('authenticated', AA, `select pin_hmac from public.user_credentials`)))
  check('063 anon NAO le/escreve user_credentials', denied(await run('anon', '', `select pin_hmac from public.user_credentials`)) && denied(await run('anon', '', `insert into public.user_credentials (user_id, pin_hmac, pin_bcrypt) values ('${A}', 'x', 'y')`)))
  check('063 authenticated NAO escreve user_credentials', denied(await run('authenticated', AA, `insert into public.user_credentials (user_id, pin_hmac, pin_bcrypt) values ('${A}', 'x', 'y')`)))
  r = await run('service_role', '', `insert into public.user_credentials (user_id, pin_hmac, pin_bcrypt) values ('${A}', 'h', 'b') on conflict (user_id) do update set pin_hmac = excluded.pin_hmac returning user_id`)
  check('063 service_role grava credenciais (upsert)', r.ok && r.n === 1, r.ok ? '' : r.err)
  r = await run('service_role', '', `select column_name from information_schema.columns where table_schema='public' and table_name='security_questions' and column_name in ('answer_enc','answer_normalized','answer_sha256') order by 1`)
  check('063 security_questions: so answer_enc (sem texto puro nem SHA-256 puro)', r.ok && r.rows.map((x) => x.column_name).join() === 'answer_enc', r.ok ? r.rows.map((x) => x.column_name).join() : r.err)
  await db.exec(`INSERT INTO public.user_credentials (user_id, pin_hmac, pin_bcrypt) VALUES ('${C}', 'h', 'b') ON CONFLICT DO NOTHING`)
  await db.exec(`DELETE FROM public.users WHERE id = '${C}'`)
  r = await db.query(`select count(*)::int as n from public.user_credentials where user_id = '${C}'`)
  check('063 apagar o usuario apaga as credenciais (cascade)', r.rows[0].n === 0)
  r = await run('service_role', '', `select column_name from information_schema.columns where table_schema='public' and table_name='sms_codes' and column_name in ('code','code_hash','attempts') order by 1`)
  check('064 sms_codes: so code_hash e attempts (sem codigo em texto puro)', r.ok && r.rows.map((x) => x.column_name).join() === 'attempts,code_hash', r.ok ? r.rows.map((x) => x.column_name).join() : r.err)
  console.log(`\nresultado: ${pass} ok, ${fail} falhas`)
} else {
  let r = await run('authenticated', BA, `select cpf from public.users`)
  console.log('ANTES: B le cpf de outros ->', r.ok ? r.rows.map((x) => x.cpf).join(',') : r.err)
  r = await run('authenticated', BA, `select id from public.companies`)
  console.log('ANTES: operador le companies ->', r.ok ? `linhas=${r.n}` : r.err)
  r = await run('anon', '', `select * from public.get_user_space_ids('${A}')`)
  console.log('ANTES: anon chama get_user_space_ids ->', r.ok ? `linhas=${r.n}` : r.err)
}
if (only === 'all' && fail > 0) process.exit(1)
