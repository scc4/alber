// Onboarding flows: Splash, Welcome, 6-step signup, Terms, Loading
const { useState: useStateAuth, useEffect: useEffectAuth, useRef: useRefAuth, useMemo: useMemoAuth } = React;

// ─── Splash ────────────────────────────────────────────────────────────────
function SplashScreen({ onDone }) {
  useEffectAuth(() => {
    const t = setTimeout(() => onDone && onDone(), 1400);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', display:'flex', alignItems:'center', justifyContent:'center', zIndex:90 }}>
      <div style={{ animation:'pop 0.6s ease-out' }}>
        <AlberA size={64} />
      </div>
      <div style={{ position:'absolute', bottom:60, fontSize:10, letterSpacing:'0.2em', color:'rgba(255,255,255,0.25)' }}>USE ALBER</div>
    </div>
  );
}

// ─── Welcome ───────────────────────────────────────────────────────────────
function WelcomeScreen({ onLogin, onSignup }) {
  return (
    <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at 50% 25%, #0e0e0e 0%, #000 75%)', display:'flex', flexDirection:'column', padding:'80px 28px 50px', zIndex:88 }}>
      <StatusBar />
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:20 }}>
        <AlberA size={72} />
        <div style={{ fontSize:11, letterSpacing:'0.32em', color:'rgba(255,255,255,0.42)', marginTop:14 }}>USE ALBER</div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <PrimaryButton onClick={onSignup}>Cadastrar-se</PrimaryButton>
        <PrimaryButton variant="ghost" onClick={onLogin}>Fazer login</PrimaryButton>
      </div>
    </div>
  );
}

// ─── Progress dots ────────────────────────────────────────────────────────
function StepProgress({ step, total = 6 }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:18 }}>
      {Array.from({length: total}).map((_, i) => (
        <div key={i} style={{
          height:3, flex:1, borderRadius:2,
          background: i < step ? '#fff' : i === step ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.1)',
          transition:'background 0.25s'
        }} />
      ))}
      <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'0.12em', marginLeft:6 }}>{step+1}/{total}</div>
    </div>
  );
}

// ─── Field with label/error/hint ──────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type='text', hint, error, success, autoFocus, readOnly, maxLength, inputMode, right }) {
  return (
    <div style={{ marginBottom: error ? 4 : 18 }}>
      <div style={{ fontSize:10, color:'rgba(255,255,255,0.42)', letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:8 }}>{label}</div>
      <div style={{ display:'flex', alignItems:'center', gap:8, borderBottom:`0.5px solid ${error ? '#EF4444' : success ? '#22C55E' : 'rgba(255,255,255,0.18)'}`, paddingBottom:6, transition:'border 0.15s' }}>
        <input type={type} value={value || ''} onChange={(e)=> onChange && onChange(e.target.value)}
          placeholder={placeholder} autoFocus={autoFocus} readOnly={readOnly}
          maxLength={maxLength} inputMode={inputMode}
          style={{ flex:1, background:'transparent', border:'none', padding:'4px 0',
            fontSize:16, color: readOnly?'rgba(255,255,255,0.55)':'#fff', fontFamily:'inherit', outline:'none', letterSpacing:'-0.01em' }} />
        {right}
      </div>
      {(error || hint) && <div style={{ fontSize:11, color: error ? '#EF4444' : 'rgba(255,255,255,0.38)', marginTop:6, lineHeight:1.4 }}>{error || hint}</div>}
    </div>
  );
}

// ─── Validators / masks ───────────────────────────────────────────────────
const maskCPF = (v) => {
  v = (v||'').replace(/\D/g,'').slice(0,11);
  if (v.length>9) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`;
  if (v.length>6) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`;
  if (v.length>3) return `${v.slice(0,3)}.${v.slice(3)}`;
  return v;
};
const validCPF = (v) => (v||'').replace(/\D/g,'').length === 11;
const maskPhone = (v) => {
  v = (v||'').replace(/\D/g,'').slice(0,11);
  if (v.length>10) return `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
  if (v.length>6) return `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`;
  if (v.length>2) return `(${v.slice(0,2)}) ${v.slice(2)}`;
  return v;
};
const maskCEP = (v) => {
  v = (v||'').replace(/\D/g,'').slice(0,8);
  if (v.length>5) return `${v.slice(0,5)}-${v.slice(5)}`;
  return v;
};
const maskDate = (v) => {
  v = (v||'').replace(/\D/g,'').slice(0,8);
  if (v.length>4) return `${v.slice(0,2)}/${v.slice(2,4)}/${v.slice(4)}`;
  if (v.length>2) return `${v.slice(0,2)}/${v.slice(2)}`;
  return v;
};

// ─── Onboarding shell ─────────────────────────────────────────────────────
function OnboardShell({ step, total = 7, onBack, title, subtitle, children, footer }) {
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', display:'flex', flexDirection:'column', zIndex:88, fontFamily: window.ALBER.TYPE.family }}>
      <StatusBar />
      <div style={{ padding:'8px 24px 0', display:'flex', alignItems:'center' }}>
        <button onClick={onBack} style={{ background:'none', border:'none', padding:8, marginLeft:-8, cursor:'pointer', color:'rgba(255,255,255,0.85)' }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:11, color:'rgba(255,255,255,0.4)', letterSpacing:'0.18em' }}>CRIAR CONTA</div>
        <div style={{ width:28 }} />
      </div>
      <div style={{ flex:1, padding:'14px 24px 0', display:'flex', flexDirection:'column', overflow:'auto' }}>
        <StepProgress step={step} total={total} />
        <div style={{ fontSize:24, fontWeight:600, color:'#fff', letterSpacing:'-0.02em', marginBottom:6 }}>{title}</div>
        {subtitle && <div style={{ fontSize:13.5, color:'rgba(255,255,255,0.55)', marginBottom:24, lineHeight:1.45 }}>{subtitle}</div>}
        <div style={{ flex:1 }}>{children}</div>
        {footer && <div style={{ padding:'14px 0 28px' }}>{footer}</div>}
      </div>
    </div>
  );
}

// ─── Step 1: Personal data ────────────────────────────────────────────────
function StepPersonal({ data, setData, onNext, onBack }) {
  const [touched, setTouched] = useStateAuth({});
  const [dupCheck, setDupCheck] = useStateAuth(false);

  const errors = {
    name: data.name && data.name.trim().split(/\s+/).length < 2 ? 'Informe nome e sobrenome' : null,
    cpf: data.cpf && !validCPF(data.cpf) ? 'CPF inválido' : null,
    birth: data.birth && data.birth.length<10 ? 'Data incompleta' : null,
    email: data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ? 'E-mail inválido' : null,
    phone: data.phone && data.phone.replace(/\D/g,'').length<11 ? 'Telefone incompleto' : null,
  };
  const ready = data.name && data.cpf && data.birth && data.email && data.phone &&
    !Object.values(errors).some(Boolean) && data.name.trim().split(/\s+/).length>=2 &&
    validCPF(data.cpf) && data.birth.length===10 && data.phone.replace(/\D/g,'').length===11;

  // simulated duplicate check on a known CPF
  useEffectAuth(() => {
    if (validCPF(data.cpf) && data.cpf.replace(/\D/g,'') === '11111111111') setDupCheck(true);
    else setDupCheck(false);
  }, [data.cpf]);

  return (
    <OnboardShell step={0} onBack={onBack} title="Dados pessoais" subtitle="Suas informações ficam protegidas e são usadas apenas para criar sua conta."
      footer={<PrimaryButton onClick={onNext} disabled={!ready || dupCheck}>Continuar</PrimaryButton>}>
      <Field label="Nome completo" value={data.name} onChange={(v)=> setData({...data, name:v})}
        placeholder="Seu nome e sobrenome" error={touched.name && errors.name} />
      <Field label="CPF" value={data.cpf} onChange={(v)=> setData({...data, cpf: maskCPF(v)})}
        placeholder="000.000.000-00" inputMode="numeric" error={touched.cpf && errors.cpf} />
      {dupCheck && (
        <div onClick={()=> alert('Recuperar acesso')} style={{ marginTop:-10, marginBottom:18, padding:'10px 12px', background:'rgba(245,158,11,0.07)', border:'0.5px solid rgba(245,158,11,0.22)', borderRadius:10, fontSize:12, color:'#F59E0B', cursor:'pointer' }}>
          Este CPF já possui uma conta. <span style={{ textDecoration:'underline', fontWeight:600 }}>Recuperar acesso?</span>
        </div>
      )}
      <Field label="Data de nascimento" value={data.birth} onChange={(v)=> setData({...data, birth: maskDate(v)})}
        placeholder="DD/MM/AAAA" inputMode="numeric" hint="Mínimo 18 anos" error={touched.birth && errors.birth} />
      <Field label="E-mail" value={data.email} onChange={(v)=> setData({...data, email:v.toLowerCase()})}
        placeholder="seu@email.com" inputMode="email" error={touched.email && errors.email} />
      <Field label="Celular" value={data.phone} onChange={(v)=> setData({...data, phone: maskPhone(v)})}
        placeholder="(00) 00000-0000" inputMode="tel" error={touched.phone && errors.phone} />
    </OnboardShell>
  );
}

// ─── Step 2: Address ─────────────────────────────────────────────────────
function StepAddress({ data, setData, onNext, onBack }) {
  const [loadingCep, setLoadingCep] = useStateAuth(false);

  // Simulate ViaCEP lookup
  useEffectAuth(() => {
    const digits = (data.cep||'').replace(/\D/g,'');
    if (digits.length === 8 && !data.cepLoaded) {
      setLoadingCep(true);
      const t = setTimeout(() => {
        setData(d => ({ ...d, street: 'Rua das Flores', neighborhood: 'Jardim Paulista', city: 'São Paulo', state: 'SP', cepLoaded: true }));
        setLoadingCep(false);
      }, 700);
      return () => clearTimeout(t);
    }
    if (digits.length < 8 && data.cepLoaded) setData(d => ({ ...d, cepLoaded:false, street:'', neighborhood:'', city:'', state:'' }));
  }, [data.cep]);

  const ready = data.cep && data.cep.replace(/\D/g,'').length===8 && data.street && data.number && data.neighborhood && data.city && data.state;

  return (
    <OnboardShell step={1} onBack={onBack} title="Endereço" subtitle="Informações exigidas pela Receita Federal para abertura da conta."
      footer={<PrimaryButton onClick={onNext} disabled={!ready}>Continuar</PrimaryButton>}>
      <Field label="CEP" value={data.cep} onChange={(v)=> setData({...data, cep: maskCEP(v), cepLoaded:false})}
        placeholder="00000-000" inputMode="numeric"
        right={loadingCep && <span style={{ width:14, height:14, border:'1.5px solid rgba(255,255,255,0.2)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />}
        hint={!loadingCep && data.cepLoaded ? 'Endereço encontrado' : null} />
      <Field label="Endereço" value={data.street} onChange={(v)=> setData({...data, street:v})} placeholder="Rua, avenida..." />
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1.4fr', gap:14 }}>
        <Field label="Número" value={data.number} onChange={(v)=> setData({...data, number:v})} placeholder="123" inputMode="numeric" />
        <Field label="Complemento" value={data.complement} onChange={(v)=> setData({...data, complement:v})} placeholder="Opcional" />
      </div>
      <Field label="Bairro" value={data.neighborhood} onChange={(v)=> setData({...data, neighborhood:v})} placeholder="—" />
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:14 }}>
        <Field label="Cidade" value={data.city} readOnly placeholder="—" />
        <Field label="UF" value={data.state} readOnly placeholder="—" />
      </div>
    </OnboardShell>
  );
}

// ─── Step 3: @handle ──────────────────────────────────────────────────────
const TAKEN_HANDLES = ['mayte','alber','admin','joao','test','luiza','ana_silva'];
function StepHandle({ data, setData, onNext, onBack }) {
  const [status, setStatus] = useStateAuth('idle'); // idle | checking | available | taken
  const [suggestions, setSuggestions] = useStateAuth([]);
  const timerRef = useRefAuth();

  const validFormat = (h) => /^[a-z0-9_]{3,20}$/.test(h) && !h.startsWith('_') && !h.endsWith('_') && !h.includes('__');

  useEffectAuth(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const h = (data.handle||'').toLowerCase();
    if (!h) { setStatus('idle'); setSuggestions([]); return; }
    if (!validFormat(h)) { setStatus('invalid'); setSuggestions([]); return; }
    setStatus('checking');
    timerRef.current = setTimeout(() => {
      if (TAKEN_HANDLES.includes(h)) {
        setStatus('taken');
        setSuggestions([`${h}_${Math.floor(Math.random()*99)}`, `${h}.real`, `the_${h}`].map(s => s.replace(/[^a-z0-9_]/g,'_')));
      } else {
        setStatus('available');
        setSuggestions([]);
      }
    }, 500);
    return () => clearTimeout(timerRef.current);
  }, [data.handle]);

  const ready = status === 'available';

  return (
    <OnboardShell step={2} onBack={onBack} title="Escolha seu @handle" subtitle="É como você será encontrado e identificado no Alber. Mín 3, máx 20 caracteres."
      footer={<PrimaryButton onClick={onNext} disabled={!ready}>Continuar</PrimaryButton>}>
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.42)', letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:8 }}>SEU @HANDLE</div>
        <div style={{ display:'flex', alignItems:'center', gap:4, borderBottom:`0.5px solid ${status==='taken'||status==='invalid' ? '#EF4444' : status==='available' ? '#22C55E' : 'rgba(255,255,255,0.18)'}`, paddingBottom:8 }}>
          <span style={{ fontSize:22, color:'rgba(255,255,255,0.4)', fontWeight:300 }}>@</span>
          <input value={data.handle||''} onChange={(e)=> setData({...data, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'')})}
            placeholder="seuhandle" maxLength={20}
            style={{ flex:1, background:'transparent', border:'none', padding:'4px 0', fontSize:22, color:'#fff', fontFamily:'inherit', outline:'none', letterSpacing:'-0.01em', fontWeight:500 }} />
          {status === 'checking' && <span style={{ width:14, height:14, border:'1.5px solid rgba(255,255,255,0.2)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />}
          {status === 'available' && <span style={{ color:'#22C55E', fontSize:18 }}>✓</span>}
          {status === 'taken' && <span style={{ color:'#EF4444', fontSize:18 }}>✕</span>}
        </div>
        <div style={{ fontSize:11, color: status==='taken'||status==='invalid' ? '#EF4444' : status==='available' ? '#22C55E' : 'rgba(255,255,255,0.38)', marginTop:8 }}>
          {status==='available' && '@handle disponível'}
          {status==='taken' && 'Este @handle já está em uso'}
          {status==='invalid' && (data.handle.length<3 ? 'Mínimo 3 caracteres' : 'Use letras, números e _')}
          {status==='checking' && 'Verificando disponibilidade…'}
          {status==='idle' && 'Letras, números e underscore'}
        </div>
      </div>

      {suggestions.length>0 && (
        <div>
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.42)', letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:10 }}>SUGESTÕES</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {suggestions.map(s => (
              <button key={s} onClick={()=> setData({...data, handle:s})} style={{ padding:'8px 14px', background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.12)', borderRadius:20, color:'#fff', fontSize:13, fontFamily:'inherit', cursor:'pointer' }}>@{s}</button>
            ))}
          </div>
        </div>
      )}
    </OnboardShell>
  );
}

// ─── Step 4: PIN creation ────────────────────────────────────────────────
const OBVIOUS = ['111111','222222','333333','444444','555555','666666','777777','888888','999999','000000','123456','654321','012345'];

function StepPin({ data, setData, onNext, onBack, variant='pairgrid' }) {
  const [phase, setPhase] = useStateAuth('create'); // create | confirm
  const [first, setFirst] = useStateAuth([]);
  const [second, setSecond] = useStateAuth([]);
  const [error, setError] = useStateAuth(null);

  const current = phase === 'create' ? first : second;
  const setCurrent = phase === 'create' ? setFirst : setSecond;

  const onDigit = (d) => {
    setError(null);
    if (current.length >= 6) return;
    const next = [...current, d];
    setCurrent(next);
    if (next.length === 6) {
      if (phase === 'create') {
        const joined = next.join('');
        if (OBVIOUS.includes(joined)) {
          setError('Evite sequências óbvias. Escolha outra combinação.');
          setTimeout(()=> { setFirst([]); setError(null); }, 1500);
        } else {
          setTimeout(() => setPhase('confirm'), 220);
        }
      } else {
        // confirm
        if (next.join('') === first.join('')) {
          setData({ ...data, pin: next.join('') });
          setTimeout(() => onNext(), 280);
        } else {
          setError('Os PINs não coincidem. Comece novamente.');
          setTimeout(() => { setFirst([]); setSecond([]); setPhase('create'); setError(null); }, 1500);
        }
      }
    }
  };
  const onBackDigit = () => setCurrent(c => c.slice(0,-1));

  const KB = variant==='twinrow' ? window.PinKbTwinRow : variant==='arc' ? window.PinKbArc : window.PinKbPairGrid;
  // The PIN keyboards are not exported as window globals — use inline simple grid keyboard instead.

  return (
    <OnboardShell step={3} onBack={() => { if (phase==='confirm') { setPhase('create'); setSecond([]); } else onBack(); }}
      title={phase==='create'?'Crie seu PIN':'Confirme seu PIN'}
      subtitle={phase==='create' ? 'Será solicitado em transações. 6 dígitos, sem sequências óbvias.' : 'Digite novamente para confirmar.'}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'8px 0 6px' }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="rgba(34,197,94,0.7)" strokeWidth="1.2"/>
          <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="rgba(34,197,94,0.7)" strokeWidth="1.2"/>
        </svg>
        <span style={{ fontSize:10, color:'rgba(34,197,94,0.7)', letterSpacing:'0.12em' }}>SCREENSHOT BLOQUEADA</span>
      </div>
      <div style={{ display:'flex', justifyContent:'center', gap:12, margin:'20px 0 28px', animation: error ? 'shake 0.3s' : 'none' }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{
            width:14, height:14, borderRadius:'50%',
            background: current.length>i ? '#fff' : 'transparent',
            border: current.length>i ? '1.5px solid #fff' : '1.5px solid rgba(255,255,255,0.25)',
            transition:'all 0.1s'
          }} />
        ))}
      </div>
      {error && <div style={{ fontSize:12, color:'#EF4444', textAlign:'center', marginBottom:14 }}>{error}</div>}
      <NumericKb onDigit={onDigit} onBack={onBackDigit} />
    </OnboardShell>
  );
}

// Sequential 0-9 keyboard for onboarding PIN creation (not scrambled)
function NumericKb({ onDigit, onBack }) {
  const cellStyle = { background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.09)', borderRadius:12, padding:'17px 0', textAlign:'center', cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, fontWeight:500, color:'#fff' };
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:9 }}>
      {[1,2,3,4,5,6,7,8,9].map(n => (
        <button key={n} onClick={()=> onDigit(n)} style={cellStyle}>{n}</button>
      ))}
      <div />
      <button onClick={()=> onDigit(0)} style={cellStyle}>0</button>
      <button onClick={onBack} style={{ ...cellStyle, color:'rgba(255,255,255,0.55)' }}>
        <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
          <path d="M19 2v10a1 1 0 0 1-1 1H7l-5-6 5-6h11a1 1 0 0 1 1 1Z" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M11 5l4 4M15 5l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

// Self-contained scrambled keyboard (uses pin.jsx pair logic but isolated)
function ScrambledKb({ onDigit, onBack, variant='pairgrid' }) {
  const PAIRS = [[0,2],[4,6],[5,7],[8,9],[1,3]];
  const [pairs, setPairs] = useStateAuth(() => window.shuffle(PAIRS));
  useEffectAuth(() => { setPairs(window.shuffle(PAIRS)); }, []);
  const cellStyle = { background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.09)', borderRadius:12, padding:'17px 0', textAlign:'center', cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center' };
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:9 }}>
      {pairs.map((p, i) => (
        <button key={i} onClick={()=> onDigit(p[Math.random()<0.5?0:1])} style={cellStyle}>
          <span style={{ fontSize:17, fontWeight:500, color:'#fff' }}>{p[0]}</span>
          <span style={{ fontSize:11, color:'rgba(255,255,255,0.28)', margin:'0 4px' }}>|</span>
          <span style={{ fontSize:17, fontWeight:500, color:'#fff' }}>{p[1]}</span>
        </button>
      ))}
      <button onClick={onBack} style={{ ...cellStyle, color:'rgba(255,255,255,0.55)' }}>
        <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
          <path d="M19 2v10a1 1 0 0 1-1 1H7l-5-6 5-6h11a1 1 0 0 1 1 1Z" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M11 5l4 4M15 5l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

// ─── Step 5: Security questions ─────────────────────────────────────────
const SECURITY_QUESTIONS = [
  'Nome do seu primeiro animal de estimação',
  'Nome da sua avó materna',
  'Nome da sua avó paterna',
  'Cidade onde seus pais se conheceram',
  'Nome do seu melhor amigo da infância',
  'Modelo do primeiro carro da sua família',
  'Nome da rua onde você cresceu',
  'Nome do seu professor favorito',
  'Apelido que seus amigos te davam',
  'Nome do seu time favorito quando criança',
];

function StepSecurity({ data, setData, onNext, onBack }) {
  const items = data.security || [{q:'',a:''},{q:'',a:''},{q:'',a:''},{q:'',a:''}];
  const [openIdx, setOpenIdx] = useStateAuth(null);

  const update = (i, key, val) => {
    const next = items.map((it, idx) => idx===i ? { ...it, [key]: val } : it);
    setData({ ...data, security: next });
  };
  const usedQs = items.map(it=>it.q).filter(Boolean);
  const ready = items.every(it => it.q && it.a && it.a.trim().length>=2);

  return (
    <OnboardShell step={4} onBack={onBack} title="Perguntas de segurança"
      subtitle="Usadas para confirmar sua identidade em operações sensíveis e recuperação de PIN. Escolha 4 perguntas distintas."
      footer={<PrimaryButton onClick={onNext} disabled={!ready}>Continuar</PrimaryButton>}>
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        {items.map((it, i) => {
          const available = SECURITY_QUESTIONS.filter(q => q===it.q || !usedQs.includes(q));
          return (
            <div key={i} style={{ background:'rgba(255,255,255,0.025)', border:'0.5px solid rgba(255,255,255,0.08)', borderRadius:12, padding:'14px 16px' }}>
              <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'0.14em', marginBottom:8 }}>PERGUNTA {i+1}</div>
              <div onClick={()=> setOpenIdx(openIdx===i?null:i)} style={{ fontSize:14, color: it.q?'#fff':'rgba(255,255,255,0.4)', display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'4px 0' }}>
                <span style={{ flex:1 }}>{it.q || 'Selecione uma pergunta'}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" style={{ transform: openIdx===i?'rotate(180deg)':'rotate(0)', transition:'transform 0.2s' }}><path d="M3 4.5l3 3 3-3" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" fill="none" strokeLinecap="round"/></svg>
              </div>
              {openIdx===i && (
                <div style={{ marginTop:10, marginBottom:6, background:'rgba(0,0,0,0.4)', border:'0.5px solid rgba(255,255,255,0.08)', borderRadius:10, overflow:'hidden' }}>
                  {available.map(q => (
                    <div key={q} onClick={()=> { update(i, 'q', q); setOpenIdx(null); }} style={{ padding:'11px 14px', fontSize:13, color: q===it.q?'#fff':'rgba(255,255,255,0.7)', cursor:'pointer', borderTop:'0.5px solid rgba(255,255,255,0.05)', background: q===it.q?'rgba(255,255,255,0.05)':'transparent' }}>{q}</div>
                  ))}
                </div>
              )}
              {it.q && (
                <input value={it.a} onChange={(e)=> update(i, 'a', e.target.value)}
                  placeholder="Sua resposta" maxLength={50}
                  style={{ width:'100%', background:'transparent', border:'none', borderBottom:'0.5px solid rgba(255,255,255,0.15)', padding:'10px 0 6px', marginTop:8, fontSize:14, color:'#fff', fontFamily:'inherit', outline:'none' }} />
              )}
            </div>
          );
        })}
      </div>
    </OnboardShell>
  );
}

// ─── Step 6: Pix key ────────────────────────────────────────────────────
function StepPix({ data, setData, onNext, onBack }) {
  const type = data.pixType || 'cpf';
  const setType = (t) => {
    let v = '';
    if (t==='cpf') v = data.cpf;
    else if (t==='phone') v = data.phone;
    else if (t==='email') v = data.email;
    else v = '';
    setData({ ...data, pixType: t, pixKey: v });
  };
  const types = [
    { id:'cpf', label:'CPF' },
    { id:'phone', label:'Telefone' },
    { id:'email', label:'E-mail' },
    { id:'random', label:'Aleatória' },
  ];
  const ready = type === 'random' ? !!data.pixKey : !!data.pixKey;
  const readOnly = type === 'cpf';

  useEffectAuth(() => {
    if (type==='random' && !data.pixKey) {
      const s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random()*16|0; return (c==='x' ? r : (r&0x3|0x8)).toString(16);
      });
      setData(d => ({ ...d, pixKey: s }));
    }
  }, [type]);

  return (
    <OnboardShell step={5} onBack={onBack} title="Chave Pix"
      subtitle="Esta é a conta que receberá seus saques do Alber. Deve estar no seu CPF."
      footer={<PrimaryButton onClick={onNext} disabled={!ready}>Continuar</PrimaryButton>}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, marginBottom:22 }}>
        {types.map(t => (
          <button key={t.id} onClick={()=> setType(t.id)} style={{
            padding:'14px 10px', background: type===t.id?'rgba(255,255,255,0.1)':'rgba(255,255,255,0.03)',
            border:`0.5px solid ${type===t.id?'rgba(255,255,255,0.4)':'rgba(255,255,255,0.1)'}`,
            borderRadius:12, color:'#fff', fontSize:13, fontFamily:'inherit', cursor:'pointer', fontWeight: type===t.id?600:400
          }}>{t.label}</button>
        ))}
      </div>
      {type === 'cpf' && (
        <Field label="Chave (CPF)" value={data.pixKey} readOnly hint="Preenchida automaticamente. Não pode ser alterada." />
      )}
      {type === 'phone' && (
        <Field label="Chave (telefone)" value={data.pixKey} onChange={(v)=> setData({...data, pixKey: maskPhone(v)})} inputMode="tel" />
      )}
      {type === 'email' && (
        <Field label="Chave (e-mail)" value={data.pixKey} onChange={(v)=> setData({...data, pixKey: v.toLowerCase()})} inputMode="email" />
      )}
      {type === 'random' && (
        <Field label="Chave aleatória" value={data.pixKey} readOnly hint="Gerada automaticamente. Você pode usar essa chave em outros bancos." />
      )}
    </OnboardShell>
  );
}

// ─── Step 7 (optional): Social networks ──────────────────────────────────
function StepSocial({ data, setData, onNext, onBack, onSkip }) {
  const networks = [
    { id:'instagram', label:'Instagram', placeholder:'@seuhandle',
      icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="14" height="14" rx="4" stroke="currentColor" strokeWidth="1.4"/><circle cx="9" cy="9" r="3.2" stroke="currentColor" strokeWidth="1.4"/><circle cx="13" cy="5" r="0.9" fill="currentColor"/></svg> },
    { id:'tiktok', label:'TikTok', placeholder:'@seuhandle',
      icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11.5 2v8.6a3.4 3.4 0 1 1-3.4-3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/><path d="M11.5 2c0 1.9 1.5 3.4 3.4 3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg> },
    { id:'linkedin', label:'LinkedIn', placeholder:'/in/seuperfil',
      icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.4"/><circle cx="5.5" cy="6" r="0.9" fill="currentColor"/><path d="M5 8.5v5.5M9 8.5v5.5M12.5 14v-3a2 2 0 0 0-4 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> },
    { id:'twitter', label:'X / Twitter', placeholder:'@seuhandle',
      icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 3l5.5 7L3 15h2l4.5-4.5L13 15h2L9.5 8 14.5 3h-2l-3.5 3.5L6 3H3z" fill="currentColor"/></svg> },
  ];
  const connected = data.social || {};
  const setConnected = (id, on) => setData({ ...data, social: { ...connected, [id]: on } });
  const count = Object.values(connected).filter(Boolean).length;

  return (
    <OnboardShell step={6} total={7} onBack={onBack} title="Conecte suas redes sociais"
      subtitle={<span>Vincule pelo menos uma rede e ganhe o badge <span style={{ color:'#5BCEC9', fontWeight:600 }}>✓ Perfil verificado</span> ao lado do seu @handle.</span>}>

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {networks.map(n => {
          const on = !!connected[n.id];
          return (
            <div key={n.id} style={{
              display:'flex', alignItems:'center', gap:14, padding:'14px 16px',
              background: on?'rgba(91,206,201,0.06)':'rgba(255,255,255,0.03)',
              border:`0.5px solid ${on?'rgba(91,206,201,0.28)':'rgba(255,255,255,0.08)'}`,
              borderRadius:12, transition:'all 0.2s'
            }}>
              <div style={{ width:36, height:36, borderRadius:10, background:'rgba(255,255,255,0.05)', border:'0.5px solid rgba(255,255,255,0.08)', display:'flex', alignItems:'center', justifyContent:'center', color: on?'#5BCEC9':'rgba(255,255,255,0.85)', flexShrink:0 }}>
                {n.icon}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, color:'#fff', fontWeight:500 }}>{n.label}</div>
                <div style={{ fontSize:11.5, color: on?'rgba(91,206,201,0.85)':'rgba(255,255,255,0.4)', marginTop:2 }}>
                  {on ? 'Conectado · OAuth concluído' : n.placeholder}
                </div>
              </div>
              <button onClick={()=> setConnected(n.id, !on)} style={{
                padding:'8px 14px', borderRadius:8, fontFamily:'inherit', fontSize:11.5, fontWeight:600, cursor:'pointer', letterSpacing:'0.04em',
                background: on?'transparent':'#fff',
                color: on?'#5BCEC9':'#000',
                border: on?'0.5px solid rgba(91,206,201,0.4)':'none',
                minWidth:88
              }}>{on ? 'Conectado ✓' : 'Conectar'}</button>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop:16, padding:'10px 14px', background:'rgba(255,255,255,0.025)', border:'0.5px solid rgba(255,255,255,0.06)', borderRadius:10, fontSize:11.5, color:'rgba(255,255,255,0.55)', lineHeight:1.45 }}>
        Vincular ao menos 1 rede concede o badge ✓ Perfil verificado, visível em todas as telas.
        Você pode conectar/desconectar depois no Perfil.
      </div>

      <div style={{ flex:1, minHeight:14 }} />
      <div style={{ paddingBottom:8 }}>
        <PrimaryButton onClick={onNext}>{count>0?'Continuar com '+count+' rede'+(count>1?'s':''):'Continuar'}</PrimaryButton>
        <button onClick={onSkip} style={{ width:'100%', marginTop:10, background:'transparent', border:'none', color:'rgba(255,255,255,0.55)', fontSize:13, padding:'10px 0', cursor:'pointer', fontFamily:'inherit', textDecoration:'underline' }}>
          Pular por agora
        </button>
      </div>
    </OnboardShell>
  );
}
function TermsScreen({ onAccept, onBack }) {
  const [t1, setT1] = useStateAuth(false);
  const [t2, setT2] = useStateAuth(false);
  const [t3, setT3] = useStateAuth(false);
  const [modal, setModal] = useStateAuth(null);
  const Check = ({ on, onClick, children }) => (
    <div onClick={onClick} style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'14px 0', cursor:'pointer', borderTop:'0.5px solid rgba(255,255,255,0.07)' }}>
      <div style={{ width:20, height:20, borderRadius:5, border:`1.4px solid ${on?'#fff':'rgba(255,255,255,0.3)'}`, background: on?'#fff':'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1 }}>
        {on && <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.5l2.5 2.5L9.5 3" stroke="#000" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
      <div style={{ fontSize:13.5, color:'rgba(255,255,255,0.85)', lineHeight:1.5 }}>{children}</div>
    </div>
  );
  const ready = t1 && t2 && t3;
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', display:'flex', flexDirection:'column', zIndex:88, fontFamily: window.ALBER.TYPE.family }}>
      <StatusBar />
      <div style={{ padding:'8px 24px 0', display:'flex', alignItems:'center' }}>
        <button onClick={onBack} style={{ background:'none', border:'none', padding:8, marginLeft:-8, cursor:'pointer', color:'rgba(255,255,255,0.85)' }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:11, color:'rgba(255,255,255,0.4)', letterSpacing:'0.18em' }}>QUASE LÁ</div>
        <div style={{ width:28 }} />
      </div>
      <div style={{ flex:1, padding:'14px 24px 0', display:'flex', flexDirection:'column', overflow:'auto' }}>
        <div style={{ fontSize:24, fontWeight:600, color:'#fff', letterSpacing:'-0.02em', marginBottom:6 }}>Termos e privacidade</div>
        <div style={{ fontSize:13.5, color:'rgba(255,255,255,0.55)', marginBottom:18, lineHeight:1.45 }}>Para criar sua conta, leia e aceite os documentos abaixo.</div>

        <Check on={t1} onClick={()=> setT1(!t1)}>
          Li e aceito os <span onClick={(e)=> { e.stopPropagation(); setModal('uso'); }} style={{ textDecoration:'underline', color:'#fff' }}>Termos de Uso</span>
        </Check>
        <Check on={t2} onClick={()=> setT2(!t2)}>
          Li e aceito a <span onClick={(e)=> { e.stopPropagation(); setModal('priv'); }} style={{ textDecoration:'underline', color:'#fff' }}>Política de Privacidade</span>
        </Check>
        <Check on={t3} onClick={()=> setT3(!t3)}>
          Declaro ter mais de 18 anos e que as informações fornecidas são verdadeiras
        </Check>
        <div style={{ flex:1 }} />
        <div style={{ padding:'14px 0 28px' }}>
          <PrimaryButton onClick={onAccept} disabled={!ready}>Criar minha conta</PrimaryButton>
        </div>
      </div>

      {modal && (
        <div onClick={(e)=> e.target===e.currentTarget && setModal(null)} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.7)', zIndex:95, display:'flex', alignItems:'flex-end' }}>
          <div style={{ width:'100%', height:'85%', background:'#0a0a0a', borderRadius:'18px 18px 0 0', borderTop:'0.5px solid rgba(255,255,255,0.1)', padding:'14px 24px 32px', display:'flex', flexDirection:'column' }}>
            <div style={{ width:36, height:4, borderRadius:2, background:'rgba(255,255,255,0.18)', margin:'0 auto 16px' }} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
              <div style={{ fontSize:18, fontWeight:600, color:'#fff' }}>{modal==='uso'?'Termos de Uso':'Política de Privacidade'}</div>
              <button onClick={()=> setModal(null)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>Fechar</button>
            </div>
            <div style={{ flex:1, overflowY:'auto', fontSize:13, color:'rgba(255,255,255,0.7)', lineHeight:1.6, paddingRight:6 }}>
              <p>Este documento estabelece as regras para uso do aplicativo Alber. Ao criar sua conta, você concorda com as condições aqui descritas.</p>
              <p>Sua conta é pessoal e intransferível. Você é responsável por manter o sigilo do seu PIN e respostas de segurança.</p>
              <p>O Alber permite o envio e recebimento de Albers entre membros, integração com clubes (Spaces), criação de splits, eventos e gestão de saldo. Operações de carregar e descarregar requerem verificação KYC aprovada.</p>
              <p>Reservamo-nos o direito de suspender contas que apresentem atividade suspeita ou violem estes termos.</p>
              <p>Última atualização: 28/04/2026.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Loading account creation ────────────────────────────────────────────
function CreatingAccountScreen({ onDone }) {
  const messages = ['Criando sua conta…','Verificando seus dados…','Quase pronto…','Bem-vindo ao Alber!'];
  const [idx, setIdx] = useStateAuth(0);
  useEffectAuth(() => {
    if (idx >= messages.length-1) {
      const t = setTimeout(() => onDone && onDone(), 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setIdx(i => i+1), 950);
    return () => clearTimeout(t);
  }, [idx]);
  const done = idx === messages.length-1;
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', zIndex:92 }}>
      <div style={{ marginBottom:36, animation: done?'pop 0.6s ease-out':'none' }}>
        {done ? <AlberA size={64} /> : (
          <div style={{ width:46, height:46, border:'2px solid rgba(255,255,255,0.12)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.9s linear infinite' }} />
        )}
      </div>
      <div style={{ fontSize:17, fontWeight:500, color:'#fff', letterSpacing:'-0.01em', textAlign:'center', minHeight:24, transition:'opacity 0.3s' }}>
        {messages[idx]}
      </div>
      <div style={{ display:'flex', gap:6, marginTop:32 }}>
        {messages.map((_,i) => (
          <div key={i} style={{ width:5, height:5, borderRadius:3, background: i<=idx?'#fff':'rgba(255,255,255,0.18)', transition:'background 0.3s' }} />
        ))}
      </div>
    </div>
  );
}

// ─── Onboarding flow controller ──────────────────────────────────────────
function OnboardingFlow({ onClose, onComplete, pinVariant }) {
  const [step, setStep] = useStateAuth(0); // 0..5 steps, 6 social, 7 terms, 8 loading
  const [data, setData] = useStateAuth({});

  const next = () => setStep(s => s+1);
  const prev = () => { if (step===0) onClose(); else setStep(s => s-1); };

  if (step === 0) return <StepPersonal data={data} setData={setData} onNext={next} onBack={prev} />;
  if (step === 1) return <StepAddress data={data} setData={setData} onNext={next} onBack={prev} />;
  if (step === 2) return <StepHandle data={data} setData={setData} onNext={next} onBack={prev} />;
  if (step === 3) return <StepPin data={data} setData={setData} onNext={next} onBack={prev} variant={pinVariant} />;
  if (step === 4) return <StepSecurity data={data} setData={setData} onNext={next} onBack={prev} />;
  if (step === 5) return <StepPix data={data} setData={setData} onNext={next} onBack={prev} />;
  if (step === 6) return <StepSocial data={data} setData={setData} onNext={next} onSkip={next} onBack={prev} />;
  if (step === 7) return <TermsScreen onAccept={next} onBack={prev} />;
  if (step === 8) return <CreatingAccountScreen onDone={onComplete} />;
  return null;
}

Object.assign(window, { SplashScreen, WelcomeScreen, OnboardingFlow });
