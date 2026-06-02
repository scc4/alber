// Spec: /specs/06_modules/perfil.md §3
// GET /user-profile
// Retorna dados mascarados do perfil do usuário autenticado.
// member_since, email_masked, phone_masked, birth_masked, pix_key_masked

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/cors.ts'
import { aesDecrypt } from '../_shared/crypto.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'GET') return err('METHOD_NOT_ALLOWED', 'Use GET', 405)

  // ── Auth ────────────────────────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return err('UNAUTHORIZED', 'Token não fornecido', 401)

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user: authUser }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !authUser) return err('UNAUTHORIZED', 'Token inválido ou expirado', 401)

  // ── Buscar dados ─────────────────────────────────────────────────────────────

  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, name, handle, email, phone, birth_date, pix_key, pix_key_type, kyc_status, account_status, created_at')
    .eq('auth_id', authUser.id)
    .maybeSingle()

  if (userErr || !user) return err('USER_NOT_FOUND', 'Usuário não encontrado', 404)

  // ── Descriptografar chave Pix ────────────────────────────────────────────────

  let pixKeyMasked = '***'
  if (user.pix_key) {
    try {
      const aesSecret = Deno.env.get('AES_SECRET') ?? ''
      const decrypted = await aesDecrypt(user.pix_key, aesSecret)
      pixKeyMasked = maskPixKey(decrypted, user.pix_key_type ?? 'cpf')
    } catch {
      pixKeyMasked = '***'
    }
  }

  return json({
    id:             user.id,
    name:           user.name,
    handle:         user.handle,
    kyc_status:     user.kyc_status,
    account_status: user.account_status,
    member_since:   formatMemberSince(user.created_at),
    email_masked:   maskEmail(user.email ?? ''),
    phone_masked:   maskPhone(user.phone ?? ''),
    birth_masked:   maskBirth(user.birth_date ?? ''),
    pix_key_masked: pixKeyMasked,
    pix_key_type:   user.pix_key_type ?? 'cpf',
  })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMemberSince(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toLowerCase()
  } catch {
    return ''
  }
}

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at < 1) return '***'
  const local  = email.slice(0, at)
  const domain = email.slice(at + 1)
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 6) return '(xx) ****-xxxx'
  const ddd   = digits.slice(0, 2)
  const last4 = digits.slice(-4)
  return `(${ddd}) ****-${last4}`
}

function maskBirth(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length < 2) return '**/**/****'
  const [year, month] = parts
  const yearPrefix = (year ?? '').slice(0, 2)
  return `**/${month}/${yearPrefix}**`
}

function maskPixKey(key: string, type: string): string {
  switch (type) {
    case 'email':  return maskEmail(key)
    case 'cpf': {
      const d = key.replace(/\D/g, '')
      if (d.length < 11) return '***.***.***-**'
      return `***.***.${d.slice(6, 9)}-${d.slice(9)}`
    }
    case 'phone':  return maskPhone(key)
    default:       return `${key.slice(0, 8)}...`
  }
}
