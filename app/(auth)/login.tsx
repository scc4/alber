// Design: /design/auth-login.jsx — LoginFlow
// Spec: /specs/06_modules/onboarding.md seção 5 — login de retorno
// Spec: /specs/03_backend.md §4.2
// 3 fases: id → pin → security (resposta digitada + hash → backend)

import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { AlberLogo } from '../../components/core/AlberLogo'
import { PINInput } from '../../components/financial/PINInput'
import { PrimaryButton } from '../../components/core/PrimaryButton'
import { Field } from '../../components/core/Field'
import { useAuthStore } from '../../store/auth.store'
import { useActiveContextStore } from '../../store/active-context.store'
import * as authService from '../../services/auth.service'
import { sha256Hex, normalizeSecurityAnswer, legacyDevHash } from '../../utils/crypto'
import { resolveInitialRoute } from '../../hooks/useInitialRoute'
import { formatDateTime } from '../../utils/format'
import { colors } from '../../tokens/colors'
import { typography } from '../../tokens/typography'
import { spacing } from '../../tokens/spacing'

type Phase = 'id' | 'operator' | 'pin' | 'security'
type IdentifierKind = 'cpf' | 'cnpj' | 'handle' | 'invalid'

function maskCPF(v: string) {
  v = v.replace(/\D/g, '').slice(0, 11)
  if (v.length > 9) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`
  if (v.length > 6) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`
  if (v.length > 3) return `${v.slice(0,3)}.${v.slice(3)}`
  return v
}

// CNPJ numérico só ganha máscara visual — o formato alfanumérico novo da
// Receita (raro ainda) é aceito sem máscara, só maiúsculas (ver _shared/cnpj.ts).
function maskCNPJDigits(v: string) {
  if (v.length > 12) return `${v.slice(0,2)}.${v.slice(2,5)}.${v.slice(5,8)}/${v.slice(8,12)}-${v.slice(12)}`
  if (v.length > 8)  return `${v.slice(0,2)}.${v.slice(2,5)}.${v.slice(5,8)}/${v.slice(8)}`
  if (v.length > 5)  return `${v.slice(0,2)}.${v.slice(2,5)}.${v.slice(5)}`
  if (v.length > 2)  return `${v.slice(0,2)}.${v.slice(2)}`
  return v
}

// Classifica o identificador digitado — decide se o "Continuar" segue direto
// pro PIN (cpf) ou primeiro consulta auth-company-lookup (cnpj/handle).
function classifyIdentifier(v: string): IdentifierKind {
  if (v.startsWith('@')) return 'handle'
  const clean = v.replace(/[^0-9A-Za-z]/g, '')
  if (/^\d{11}$/.test(clean)) return 'cpf'
  if (/^[0-9A-Za-z]{14}$/.test(clean)) return 'cnpj'
  return 'invalid'
}

export default function LoginScreen() {
  const { t }    = useTranslation()
  const insets   = useSafeAreaInsets()
  const login    = useAuthStore(s => s.login)
  const params   = useLocalSearchParams<{ cpf?: string }>()

  const [phase, setPhase]           = useState<Phase>('id')
  const [identifier, setIdentifier] = useState(params.cpf ? maskCPF(params.cpf) : '')
  const [identifierError, setIdentifierError] = useState<string | null>(null)
  const [lookupLoading, setLookupLoading]     = useState(false)
  const [companyContext, setCompanyContext]   = useState<{ companyId: string; companyName: string } | null>(null)
  const [operators, setOperators]             = useState<authService.CompanyLookupOperator[]>([])
  const [selectedOperatorRef, setSelectedOperatorRef] = useState<string | null>(null)
  const [pinHash, setPinHash]       = useState('')
  const [pinMode, setPinMode]       = useState<'secure' | 'setup'>('secure')
  const [challenge, setChallenge]     = useState<authService.SecurityChallenge | null>(null)
  const [challengeLoading, setChallengeLoading] = useState(false)
  const [challengeError, setChallengeError]     = useState(false)
  const [wrongChoice, setWrongChoice] = useState(false)
  const [answer, setAnswer]           = useState('')  // fallback para contas sem answer_normalized
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [pinError, setPinError]       = useState<string | null>(null)
  const pinErrKey = useRef(0)

  const identifierKind = classifyIdentifier(identifier)
  const isValid = identifierKind !== 'invalid'
  const isHandle = identifier.startsWith('@')

  // Identidade usada pra continuar o login (PIN/pergunta de segurança) —
  // ou o cpf/@handle digitado, ou o operador escolhido no fluxo de empresa.
  const loginIdentity = (): string | authService.OperatorLoginRef =>
    companyContext && selectedOperatorRef
      ? { companyId: companyContext.companyId, operatorRef: selectedOperatorRef }
      : (isHandle ? identifier : identifier.replace(/\D/g, ''))

  // Busca um challenge novo — usado ao entrar na fase security e ao errar uma
  // resposta (excludeQuestionId evita repetir a mesma pergunta).
  const loadChallenge = (excludeQuestionId?: string) => {
    setChallengeError(false)
    setChallengeLoading(true)
    authService.fetchSecurityChallenge(loginIdentity(), pinHash, excludeQuestionId)
      .then(result => {
        switch (result.type) {
          case 'pin_setup_required':
            pinErrKey.current++
            setPinHash('')
            setPinMode('setup')
            setPhase('pin')
            break
          case 'pin_invalid':
            // PIN estava errado — auth-question nem chega a gerar pergunta.
            // Volta pro passo do PIN com feedback claro, em vez do erro genérico de sempre.
            pinErrKey.current++
            setPinHash('')
            setPinError(t('auth.login.errorInvalid'))
            setPhase('pin')
            break
          case 'blocked':
            Alert.alert(
              t('auth.login.errorTitle'),
              t('auth.login.errorAccountBlocked', { time: formatDateTime(result.blockedUntil) }),
            )
            setPhase('id')
            break
          case 'ok':
            setChallenge(result.challenge)
            break
          case 'error':
            setChallengeError(true)
            break
        }
      })
      .catch(() => setChallengeError(true))
      .finally(() => setChallengeLoading(false))
  }

  // Busca challenge do backend ao entrar na fase security
  useEffect(() => {
    if (phase !== 'security') return
    setChallenge(null)
    setWrongChoice(false)
    setAnswer('')
    loadChallenge()
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleIdentifierChange = (v: string) => {
    setIdentifierError(null)
    if (v === '' || v === '@') { setIdentifier(v); return }
    const bare = v.startsWith('@') ? v.slice(1) : v
    if (/^\d/.test(bare)) {
      const digits = bare.replace(/\D/g, '')
      setIdentifier(digits.length <= 11 ? maskCPF(digits) : maskCNPJDigits(digits.slice(0, 14)))
    } else {
      setIdentifier('@' + bare.toLowerCase().replace(/[^a-z0-9_]/g, ''))
    }
  }

  // Continuar na fase 'id': cpf segue direto pro PIN (fluxo de sempre); cnpj
  // ou @handle primeiro consultam auth-company-lookup pra saber se é uma
  // empresa (aí abre o seletor de operador) ou uma pessoa (handle comum,
  // segue o mesmo fluxo de sempre).
  const handleContinue = async () => {
    if (!isValid || lookupLoading) return
    if (identifierKind === 'cpf') {
      setPhase('pin')
      return
    }
    setIdentifierError(null)
    setLookupLoading(true)
    try {
      const result = await authService.lookupCompanyIdentifier(identifier)
      if (result.kind === 'company') {
        setCompanyContext({ companyId: result.companyId, companyName: result.companyName })
        setOperators(result.operators)
        setSelectedOperatorRef(null)
        setPhase('operator')
      } else if (identifierKind === 'cnpj') {
        setIdentifierError(t('auth.login.errorCnpjNotFound'))
      } else {
        setPhase('pin')
      }
    } catch {
      setIdentifierError(t('auth.login.errorGeneric'))
    } finally {
      setLookupLoading(false)
    }
  }

  const handlePINComplete = (hash: string) => {
    setPinHash(hash)
    setPinError(null)
    setTimeout(() => setPhase('security'), 200)
  }

  // Pós-login: se veio do fluxo "entrar como empresa", cai direto naquela
  // empresa (a pessoa escolheu explicitamente) — não passa por
  // resolveInitialRoute, que prioriza a carteira pessoal quando ela existe.
  const navigateAfterLogin = async () => {
    if (companyContext) {
      await useActiveContextStore.getState().setContext({
        type: 'company', companyId: companyContext.companyId, companyName: companyContext.companyName,
      })
      router.replace('/(app)/' as never)
    } else {
      router.replace((await resolveInitialRoute()) as never)
    }
  }

  // Envia o hash da opção selecionada (fornecido pelo backend no challenge)
  const submitOptionHash = async (optionHash: string) => {
    if (isLoggingIn) return
    setIsLoggingIn(true)
    try {
      await login(loginIdentity(), pinHash, optionHash)
      await navigateAfterLogin()
    } catch (e: unknown) {
      setIsLoggingIn(false)
      const code = e instanceof authService.BffError ? e.code : 'UNKNOWN'
      if (code === 'WRONG_SECURITY_ANSWER') {
        // Resposta errada — mostra feedback e busca uma pergunta NOVA (evita repetir a mesma)
        setWrongChoice(true)
        const wrongQuestionId = challenge?.question_id
        setTimeout(() => {
          setWrongChoice(false)
          loadChallenge(wrongQuestionId)
        }, 1800)
      } else if (code === 'ACCOUNT_BLOCKED') {
        const blockedUntil = e instanceof authService.BffError ? e.extra.blocked_until as string | undefined : undefined
        Alert.alert(
          t('auth.login.errorTitle'),
          t('auth.login.errorAccountBlocked', { time: blockedUntil ? formatDateTime(blockedUntil) : '' }),
        )
        setPhase('id')
      } else if (code === 'PIN_SETUP_REQUIRED') {
        Alert.alert(t('auth.login.errorTitle'), t('auth.login.pinSetupRequired'), [
          {
            text: 'OK',
            onPress: () => {
              pinErrKey.current++
              setPinHash('')
              setPinError(null)
              setPinMode('setup')
              setPhase('pin')
            },
          },
        ])
      } else if (code === 'INVALID_CREDENTIALS') {
        Alert.alert(t('auth.login.errorTitle'), t('auth.login.errorInvalid'))
        pinErrKey.current++
        setPinError(t('auth.login.errorInvalid'))
        setPhase('pin')
      } else if (code === 'ACCOUNT_DELETED') {
        Alert.alert(t('auth.login.errorTitle'), t('auth.login.errorAccountDeleted'))
        setPhase('id')
      } else {
        Alert.alert(t('auth.login.errorTitle'), t('auth.login.errorGeneric'))
      }
    }
  }

  // Fallback: campo de texto para contas sem answer_normalized no backend
  const submitFromTextInput = async () => {
    if (answer.trim().length < 2 || isLoggingIn) return
    setIsLoggingIn(true)
    const normalized = normalizeSecurityAnswer(answer)
    try {
      const answerHash = await sha256Hex(normalized)
      const legacyHash = legacyDevHash(normalized)
      await login(loginIdentity(), pinHash, answerHash, legacyHash)
      await navigateAfterLogin()
    } catch (e: unknown) {
      setIsLoggingIn(false)
      const code = e instanceof authService.BffError ? e.code : 'UNKNOWN'
      if (code === 'WRONG_SECURITY_ANSWER' || code === 'INVALID_CREDENTIALS') {
        Alert.alert(t('auth.login.errorTitle'), t('auth.login.errorInvalid'))
      } else if (code === 'ACCOUNT_BLOCKED') {
        const blockedUntil = e instanceof authService.BffError ? e.extra.blocked_until as string | undefined : undefined
        Alert.alert(
          t('auth.login.errorTitle'),
          t('auth.login.errorAccountBlocked', { time: blockedUntil ? formatDateTime(blockedUntil) : '' }),
        )
        setPhase('id')
      } else if (code === 'ACCOUNT_DELETED') {
        Alert.alert(t('auth.login.errorTitle'), t('auth.login.errorAccountDeleted'))
        setPhase('id')
      } else {
        Alert.alert(t('auth.login.errorTitle'), t('auth.login.errorGeneric'))
      }
    }
  }

  // ─── Fase: identifier ────────────────────────────────────────────────────
  if (phase === 'id') {
    return (
      <KeyboardAvoidingView
        style={[styles.root, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[styles.idContent, { paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.topHeader}>{t('auth.login.header')}</Text>

          <View style={styles.logoBlock}>
            <AlberLogo size={64} color="#FFFFFF" />
            <Text style={styles.usealber}>{t('auth.login.usealber')}</Text>
          </View>

          <Text style={styles.h1}>{t('auth.login.title')}</Text>
          <Text style={styles.subtitle}>{t('auth.login.subtitle')}</Text>

          <Field
            label={t('auth.login.identifierLabel')}
            value={identifier}
            onChangeText={handleIdentifierChange}
            placeholder={t('auth.login.identifierPlaceholder')}
            error={identifierError}
            loading={lookupLoading}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.spacer} />

          <PrimaryButton
            label={t('auth.login.continue')}
            onPress={handleContinue}
            state={!isValid ? 'disabled' : lookupLoading ? 'loading' : 'default'}
          />

          <TouchableOpacity onPress={() => router.push('/(auth)/cadastro/dados')} style={styles.signupLink}>
            <Text style={styles.signupText}>
              {t('auth.login.noAccount')}{' '}
              <Text style={styles.signupCta}>{t('auth.login.signup')}</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  // ─── Fase: seleção de operador (login "como empresa") ────────────────────
  if (phase === 'operator' && companyContext != null) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ScrollView
          contentContainerStyle={[styles.secContent, { paddingBottom: insets.bottom + spacing.xl }]}
        >
          <TouchableOpacity style={styles.backBtnAbs} onPress={() => { setCompanyContext(null); setPhase('id') }}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>

          <Text style={styles.secEyebrow}>{t('auth.login.operatorEyebrow')}</Text>
          <Text style={styles.secQuestion}>{t('auth.login.operatorTitle')}</Text>
          <Text style={styles.secHint}>
            {t('auth.login.operatorSubtitle', { company: companyContext.companyName })}
          </Text>

          <View style={styles.optionsList}>
            {operators.map(op => (
              <TouchableOpacity
                key={op.ref}
                style={styles.operatorItem}
                activeOpacity={0.65}
                onPress={() => { setSelectedOperatorRef(op.ref); setPhase('pin') }}
              >
                <Text style={styles.operatorName}>{op.masked_name}</Text>
                <Text style={styles.operatorRole}>
                  {op.role === 'master' ? t('empresas.roleMaster') : t('empresas.roleOperator')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    )
  }

  // ─── Fase: PIN ──────────────────────────────────────────────────────────
  if (phase === 'pin') {
    const selectedOperator = operators.find(o => o.ref === selectedOperatorRef)
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <TouchableOpacity
          style={styles.backBtnAbs}
          onPress={() => { setPinMode('secure'); setPhase(companyContext ? 'operator' : 'id') }}
        >
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>

        <View style={styles.pinContent}>
          <Text style={styles.pinEyebrow}>{t('auth.login.usealber')}</Text>
          <Text style={styles.pinTitle}>{t('auth.login.pinTitle')}</Text>
          <Text style={styles.pinIdentifier}>
            {companyContext && selectedOperator
              ? `${companyContext.companyName} · ${selectedOperator.masked_name}`
              : identifier}
          </Text>

          <PINInput
            key={`login-pin-${pinErrKey.current}`}
            onComplete={handlePINComplete}
            mode={pinMode}
            legacyCompat={pinMode === 'setup'}
            error={pinError}
          />

          <TouchableOpacity
            onPress={() => router.push('/(auth)/recuperar/seguranca')}
            style={styles.forgotLink}
          >
            <Text style={styles.forgotText}>{t('auth.login.forgotPin')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ─── Fase: Pergunta de segurança ─────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.secContent, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={styles.backBtnAbs} onPress={() => setPhase('pin')}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>

        <Text style={styles.secEyebrow}>{t('auth.login.securityQuestionLabel')}</Text>

        {challengeLoading ? (
          <ActivityIndicator color="rgba(255,255,255,0.4)" style={{ marginTop: spacing.xl * 2 }} />

        ) : challengeError ? (
          /* Erro de rede ao buscar challenge — permite retry */
          <>
            <Text style={styles.secQuestion}>{t('auth.login.securityLoadError')}</Text>
            <View style={styles.spacer} />
            <PrimaryButton
              label={t('auth.login.securityRetry')}
              onPress={() => loadChallenge()}
            />
          </>

        ) : challenge && challenge.options.length > 0 ? (
          /* Múltipla escolha gerada pelo backend */
          <>
            <Text style={styles.secQuestion}>{challenge.question}</Text>
            <Text style={styles.secHint}>{t('auth.login.securityChooseHint')}</Text>
            <View style={styles.optionsList}>
              {challenge.options.map((opt, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.optionItem, isLoggingIn && styles.optionDisabled]}
                  onPress={() => submitOptionHash(opt.hash)}
                  activeOpacity={0.65}
                  disabled={isLoggingIn}
                >
                  <Text style={styles.optionText}>{opt.display}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {wrongChoice && (
              <Text style={styles.wrongChoiceText}>{t('auth.login.securityWrongChoice')}</Text>
            )}
            {isLoggingIn && (
              <Text style={styles.secHint}>{t('common.verifying')}</Text>
            )}
          </>

        ) : (
          /* Fallback texto: conta sem answer_normalized (registrada antes da v2) */
          <>
            {!!challenge?.question && <Text style={styles.secQuestion}>{challenge.question}</Text>}
            <TextInput
              style={styles.secInput}
              value={answer}
              onChangeText={setAnswer}
              placeholder={t('auth.login.securityAnswerPlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <Text style={styles.secHint}>{t('auth.login.securityHint')}</Text>
            <View style={styles.spacer} />
            <PrimaryButton
              label={t('auth.login.securityConfirm')}
              onPress={submitFromTextInput}
              state={
                isLoggingIn              ? 'loading'  :
                answer.trim().length < 2 ? 'disabled' : 'default'
              }
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black[90],
  },
  // id phase
  idContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.sm,
  },
  backBtn: {
    alignSelf: 'flex-start',
    padding: 8,
    marginLeft: -8,
    marginBottom: 4,
  },
  topHeader: {
    textAlign: 'center',
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.18 * 11,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  logoBlock: {
    alignItems: 'center',
    marginBottom: spacing.xxl + 2,
    gap: spacing.sm,
  },
  usealber: {
    fontSize: 10,
    letterSpacing: 0.28 * 10,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
  },
  h1: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.02 * 24,
    fontFamily: typography.fontFamily.primary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 19,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.xl,
  },
  spacer: { flex: 1, minHeight: spacing.xl },
  signupLink: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  signupText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: typography.fontFamily.primary,
  },
  signupCta: {
    color: colors.white[100],
    fontWeight: '600',
  },
  // pin phase
  backBtnAbs: {
    position: 'absolute',
    top: 54,
    left: 16,
    padding: 8,
    zIndex: 10,
  },
  pinContent: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 54,
    justifyContent: 'center',
  },
  pinEyebrow: {
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: 'uppercase',
    textAlign: 'center',
    fontFamily: typography.fontFamily.primary,
    marginBottom: 5,
    marginTop: spacing.xl,
  },
  pinTitle: {
    fontSize: typography.size.h1.fontSize,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.02 * 22,
    textAlign: 'center',
    fontFamily: typography.fontFamily.primary,
    marginBottom: 6,
  },
  pinIdentifier: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  forgotLink: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  forgotText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    textDecorationLine: 'underline',
    fontFamily: typography.fontFamily.primary,
  },
  // security phase
  secContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg + 4,
    paddingTop: 54 + spacing.xl,
  },
  secEyebrow: {
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: typography.eyebrow.letterSpacing,
    textTransform: 'uppercase',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
  },
  secQuestion: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.white[100],
    letterSpacing: -0.02 * 20,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.xl,
    lineHeight: 26,
  },
  secInput: {
    height: 54,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: spacing.radius.md,
    paddingHorizontal: spacing.md,
    color: colors.white[100],
    fontSize: 16,
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  secHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: typography.fontFamily.primary,
    marginBottom: spacing.lg,
  },
  backArrow: {
    fontSize: 28,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 30,
  },
  // security — multiple choice
  optionsList: {
    gap: 10,
    marginTop: 4,
  },
  optionItem: {
    height: 54,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: spacing.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  optionDisabled: {
    opacity: 0.45,
  },
  optionText: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 1.5,
  },
  wrongChoiceText: {
    fontSize: 13,
    color: colors.state.error,
    textAlign: 'center',
    marginTop: spacing.sm,
    fontFamily: typography.fontFamily.primary,
  },
  // operator phase
  operatorItem: {
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: spacing.radius.md,
    gap: 3,
  },
  operatorName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white[100],
    fontFamily: typography.fontFamily.primary,
    letterSpacing: 0.5,
  },
  operatorRole: {
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: typography.fontFamily.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
})
