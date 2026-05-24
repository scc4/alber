// Login + Forgot PIN flows
const { useState: useStateLogin, useEffect: useEffectLogin, useRef: useRefLogin } = React;

// ─── Login ────────────────────────────────────────────────────────────────
function LoginFlow({ onClose, onComplete, onForgot, onSignup, pinVariant }) {
  const [phase, setPhase] = useStateLogin('id'); // id | pin | security
  const [identifier, setIdentifier] = useStateLogin('');
  const [pinDigits, setPinDigits] = useStateLogin([]);
  const [error, setError] = useStateLogin(null);
  const [attempts, setAttempts] = useStateLogin(0);

  const isHandle = identifier.startsWith('@') || /[a-z_]/.test(identifier);
  const idValid = isHandle ? identifier.replace(/^@/,'').length>=3 : identifier.replace(/\D/g,'').length===11;

  const onDigit = (d) => {
    if (pinDigits.length >= 6) return;
    const next = [...pinDigits, d];
    setPinDigits(next);
    if (next.length === 6) {
      // accept any 6 digits in mock
      setTimeout(() => setPhase('security'), 220);
    }
  };
  const onBackDigit = () => setPinDigits(p => p.slice(0,-1));

  if (phase === 'id') {
    return (
      <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at 50% 25%, #0e0e0e 0%, #000 75%)', display:'flex', flexDirection:'column', zIndex:88, fontFamily: window.ALBER.TYPE.family }}>
        <StatusBar />
        <div style={{ padding:'8px 24px 0', display:'flex', alignItems:'center' }}>
          <button onClick={onClose} style={{ background:'none', border:'none', padding:8, marginLeft:-8, cursor:'pointer', color:'rgba(255,255,255,0.85)' }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div style={{ flex:1, textAlign:'center', fontSize:11, color:'rgba(255,255,255,0.4)', letterSpacing:'0.18em' }}>ENTRAR</div>
          <div style={{ width:28 }} />
        </div>
        <div style={{ flex:1, padding:'40px 28px 28px', display:'flex', flexDirection:'column' }}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', marginBottom:42 }}>
            <AlberA size={48} />
            <div style={{ fontSize:10, letterSpacing:'0.28em', color:'rgba(255,255,255,0.4)', marginTop:14 }}>USE ALBER</div>
          </div>
          <div style={{ fontSize:24, fontWeight:600, color:'#fff', letterSpacing:'-0.02em', marginBottom:6 }}>Bem-vindo de volta</div>
          <div style={{ fontSize:13.5, color:'rgba(255,255,255,0.55)', marginBottom:30, lineHeight:1.45 }}>Entre com seu CPF ou @handle para continuar.</div>
          <Field label="CPF ou @handle" value={identifier}
            onChange={(v) => {
              if (v.startsWith('@') || /^[a-z_]/i.test(v)) setIdentifier(v.toLowerCase().replace(/[^a-z0-9_@]/g,''));
              else if (/^\d/.test(v)) setIdentifier(maskCPF(v));
              else setIdentifier(v);
            }}
            placeholder="000.000.000-00 ou @handle" autoFocus />
          <div style={{ flex:1 }} />
          <PrimaryButton onClick={()=> setPhase('pin')} disabled={!idValid}>Continuar</PrimaryButton>
          <div onClick={onSignup} style={{ textAlign:'center', marginTop:18, fontSize:13, color:'rgba(255,255,255,0.55)', cursor:'pointer' }}>
            Não tem conta? <span style={{ color:'#fff', fontWeight:600 }}>Cadastrar-se</span>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'pin') {
    return (
      <div style={{ position:'absolute', inset:0, background:'#000', display:'flex', flexDirection:'column', zIndex:88, fontFamily: window.ALBER.TYPE.family, padding:'54px 24px 36px' }}>
        <button onClick={()=> setPhase('id')} style={{ position:'absolute', top:54, left:16, background:'none', border:'none', padding:8, cursor:'pointer', color:'rgba(255,255,255,0.85)' }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div style={{ fontSize:10.5, color:'rgba(255,255,255,0.4)', letterSpacing:'0.14em', textTransform:'uppercase', marginTop:32, marginBottom:5, textAlign:'center' }}>USE ALBER</div>
        <div style={{ fontSize:22, fontWeight:600, color:'#fff', letterSpacing:'-0.02em', marginBottom:6, textAlign:'center' }}>Digite seu PIN</div>
        <div style={{ fontSize:12.5, color:'rgba(255,255,255,0.5)', marginBottom:28, textAlign:'center' }}>{identifier}</div>

        <div style={{ display:'flex', justifyContent:'center', gap:10, marginBottom:24 }}>
          {[0,1,2,3,4,5].map(i => (
            <div key={i} style={{ width:12, height:12, borderRadius:'50%',
              background: pinDigits.length>i ? '#fff' : 'transparent',
              border: pinDigits.length>i ? '1.5px solid #fff' : '1.5px solid rgba(255,255,255,0.25)' }} />
          ))}
        </div>

        <ScrambledKb onDigit={onDigit} onBack={onBackDigit} />
        <div onClick={onForgot} style={{ textAlign:'center', marginTop:22, fontSize:13, color:'rgba(255,255,255,0.6)', cursor:'pointer', textDecoration:'underline' }}>
          Esqueci meu PIN
        </div>
      </div>
    );
  }

  // security
  return <SecurityConfirm open onClose={()=> setPhase('pin')} onComplete={onComplete} />;
}

// ─── Forgot PIN flow ──────────────────────────────────────────────────────
function ForgotPinFlow({ onClose, onComplete }) {
  const [step, setStep] = useStateLogin(0); // 0 id, 1 security, 2 channel+code, 3 newpin, 4 success
  const [identifier, setIdentifier] = useStateLogin('');
  const [channel, setChannel] = useStateLogin(null); // 'sms' | 'email'
  const [code, setCode] = useStateLogin(['','','','','','']);
  const [resendIn, setResendIn] = useStateLogin(60);
  const [pinPhase, setPinPhase] = useStateLogin('create'); // create|confirm
  const [first, setFirst] = useStateLogin([]);
  const [second, setSecond] = useStateLogin([]);
  const [pinError, setPinError] = useStateLogin(null);

  // Step 0: identifier
  if (step === 0) {
    const isHandle = identifier.startsWith('@') || /^[a-z_]/i.test(identifier);
    const valid = isHandle ? identifier.replace(/^@/,'').length>=3 : identifier.replace(/\D/g,'').length===11;
    return (
      <ForgotShell title="Esqueci meu PIN" subtitle="Vamos recuperar seu acesso. Informe seu CPF ou @handle para começar." onBack={onClose} step={0}
        footer={<PrimaryButton onClick={()=> setStep(1)} disabled={!valid}>Continuar</PrimaryButton>}>
        <Field label="CPF ou @handle" value={identifier}
          onChange={(v) => {
            if (v.startsWith('@') || /^[a-z_]/i.test(v)) setIdentifier(v.toLowerCase().replace(/[^a-z0-9_@]/g,''));
            else if (/^\d/.test(v)) setIdentifier(maskCPF(v));
            else setIdentifier(v);
          }} placeholder="000.000.000-00 ou @handle" autoFocus />
      </ForgotShell>
    );
  }

  // Step 1: Security question
  if (step === 1) {
    return <ForgotSecurity onBack={()=> setStep(0)} onPass={()=> setStep(2)} onFail={()=> { /* lock 15min */ alert('Bloqueado por 15 minutos'); onClose(); }} />;
  }

  // Step 2: channel + code
  if (step === 2) {
    return <ForgotCode channel={channel} setChannel={setChannel} code={code} setCode={setCode}
      onBack={()=> setStep(1)} onNext={()=> setStep(3)} resendIn={resendIn} setResendIn={setResendIn} />;
  }

  // Step 3: new PIN
  if (step === 3) {
    const current = pinPhase==='create' ? first : second;
    const setCurrent = pinPhase==='create' ? setFirst : setSecond;
    const onDigit = (d) => {
      setPinError(null);
      if (current.length>=6) return;
      const next = [...current, d];
      setCurrent(next);
      if (next.length===6) {
        if (pinPhase==='create') {
          if (OBVIOUS.includes(next.join(''))) {
            setPinError('Evite sequências óbvias.');
            setTimeout(() => { setFirst([]); setPinError(null); }, 1500);
          } else setTimeout(()=> setPinPhase('confirm'), 220);
        } else {
          if (next.join('')===first.join('')) setTimeout(()=> setStep(4), 280);
          else { setPinError('Os PINs não coincidem.'); setTimeout(()=> { setFirst([]); setSecond([]); setPinPhase('create'); setPinError(null); }, 1500); }
        }
      }
    };
    return (
      <ForgotShell title={pinPhase==='create'?'Crie um novo PIN':'Confirme o novo PIN'}
        subtitle={pinPhase==='create'?'6 dígitos. Não pode ser igual ao anterior nem usar sequências óbvias.':'Digite novamente para confirmar.'}
        onBack={() => { if (pinPhase==='confirm') { setPinPhase('create'); setSecond([]); } else setStep(2); }} step={3}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'4px 0 6px' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="rgba(34,197,94,0.7)" strokeWidth="1.2"/>
            <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="rgba(34,197,94,0.7)" strokeWidth="1.2"/>
          </svg>
          <span style={{ fontSize:10, color:'rgba(34,197,94,0.7)', letterSpacing:'0.12em' }}>SCREENSHOT BLOQUEADA</span>
        </div>
        <div style={{ display:'flex', justifyContent:'center', gap:12, margin:'18px 0 24px', animation: pinError?'shake 0.3s':'none' }}>
          {[0,1,2,3,4,5].map(i => (
            <div key={i} style={{ width:14, height:14, borderRadius:'50%',
              background: current.length>i?'#fff':'transparent',
              border: current.length>i?'1.5px solid #fff':'1.5px solid rgba(255,255,255,0.25)' }} />
          ))}
        </div>
        {pinError && <div style={{ fontSize:12, color:'#EF4444', textAlign:'center', marginBottom:10 }}>{pinError}</div>}
        <ScrambledKb onDigit={onDigit} onBack={() => setCurrent(c => c.slice(0,-1))} />
      </ForgotShell>
    );
  }

  // Step 4: success
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', display:'flex', flexDirection:'column', zIndex:88, fontFamily: window.ALBER.TYPE.family }}>
      <StatusBar />
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'0 36px', textAlign:'center' }}>
        <div style={{ width:64, height:64, borderRadius:32, background:'rgba(34,197,94,0.12)', border:'0.5px solid rgba(34,197,94,0.4)', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:24, animation:'pop 0.6s ease-out' }}>
          <svg width="28" height="28" viewBox="0 0 28 28"><path d="M6 14.5l5 5 11-12" stroke="#22C55E" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <div style={{ fontSize:22, fontWeight:600, color:'#fff', letterSpacing:'-0.02em', marginBottom:10 }}>PIN atualizado</div>
        <div style={{ fontSize:14, color:'rgba(255,255,255,0.6)', lineHeight:1.5 }}>Por segurança, todas as suas sessões ativas foram encerradas. Faça login novamente.</div>
      </div>
      <div style={{ padding:'0 24px 36px' }}>
        <PrimaryButton onClick={onComplete}>Fazer login</PrimaryButton>
      </div>
    </div>
  );
}

function ForgotShell({ title, subtitle, onBack, children, footer, step }) {
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', display:'flex', flexDirection:'column', zIndex:88, fontFamily: window.ALBER.TYPE.family }}>
      <StatusBar />
      <div style={{ padding:'8px 24px 0', display:'flex', alignItems:'center' }}>
        <button onClick={onBack} style={{ background:'none', border:'none', padding:8, marginLeft:-8, cursor:'pointer', color:'rgba(255,255,255,0.85)' }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:11, color:'rgba(255,255,255,0.4)', letterSpacing:'0.18em' }}>RECUPERAR PIN</div>
        <div style={{ width:28 }} />
      </div>
      <div style={{ flex:1, padding:'14px 24px 0', display:'flex', flexDirection:'column', overflow:'auto' }}>
        <div style={{ display:'flex', gap:6, marginBottom:18 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ height:3, flex:1, borderRadius:2, background: i<step?'#fff': i===step?'rgba(255,255,255,0.45)':'rgba(255,255,255,0.1)' }} />
          ))}
        </div>
        <div style={{ fontSize:24, fontWeight:600, color:'#fff', letterSpacing:'-0.02em', marginBottom:6 }}>{title}</div>
        {subtitle && <div style={{ fontSize:13.5, color:'rgba(255,255,255,0.55)', marginBottom:24, lineHeight:1.45 }}>{subtitle}</div>}
        <div style={{ flex:1 }}>{children}</div>
        {footer && <div style={{ padding:'14px 0 28px' }}>{footer}</div>}
      </div>
    </div>
  );
}

function ForgotSecurity({ onBack, onPass, onFail }) {
  const [tries, setTries] = useStateLogin(0);
  const Q = 'Nome do seu primeiro animal de estimação';
  const correct = 'B**y';
  const opts = [correct, 'L***a', 'R**', 'M***x'];
  const [shuffled] = useStateLogin(() => window.shuffle(opts));
  const [selected, setSelected] = useStateLogin(null);
  const [error, setError] = useStateLogin(false);

  const pick = (o, i) => {
    setSelected(i);
    setTimeout(() => {
      if (o === correct) onPass();
      else {
        setError(true);
        const t = tries+1;
        setTries(t);
        setTimeout(() => { setSelected(null); setError(false); if (t>=3) onFail(); }, 1000);
      }
    }, 280);
  };

  return (
    <ForgotShell title="Confirme sua identidade" subtitle={`${Q}\nTentativa ${tries+1} de 3.`} onBack={onBack} step={1}>
      <div style={{ display:'flex', flexDirection:'column', gap:10, animation: error?'shake 0.3s':'none' }}>
        {shuffled.map((o, i) => (
          <button key={i} onClick={()=> pick(o, i)} style={{
            background: selected===i ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)',
            border:'0.5px solid rgba(255,255,255,0.1)', borderRadius:12,
            padding:'18px 20px', textAlign:'left', color:'#fff', fontSize:15,
            cursor:'pointer', fontFamily:'inherit'
          }}>{o}</button>
        ))}
      </div>
    </ForgotShell>
  );
}

function ForgotCode({ channel, setChannel, code, setCode, onBack, onNext, resendIn, setResendIn }) {
  const refs = useRefLogin([]);
  useEffectLogin(() => {
    if (!channel) return;
    if (resendIn<=0) return;
    const t = setTimeout(()=> setResendIn(r => r-1), 1000);
    return () => clearTimeout(t);
  }, [resendIn, channel]);

  if (!channel) {
    return (
      <ForgotShell title="Como prefere receber o código?" subtitle="Enviaremos um código de 6 dígitos para confirmar." onBack={onBack} step={2}>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <button onClick={()=> { setChannel('sms'); setResendIn(60); }} style={{ display:'flex', alignItems:'center', gap:14, padding:'18px 18px', background:'rgba(255,255,255,0.03)', border:'0.5px solid rgba(255,255,255,0.1)', borderRadius:12, cursor:'pointer', fontFamily:'inherit', textAlign:'left' }}>
            <div style={{ width:38, height:38, borderRadius:19, background:'rgba(255,255,255,0.06)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="4" y="2" width="10" height="14" rx="2" stroke="#fff" strokeWidth="1.2"/><circle cx="9" cy="13" r="1" fill="#fff"/></svg>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, color:'#fff', fontWeight:500 }}>SMS</div>
              <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', marginTop:2 }}>(**) *****-3421</div>
            </div>
            <span style={{ color:'rgba(255,255,255,0.3)' }}>›</span>
          </button>
          <button onClick={()=> { setChannel('email'); setResendIn(60); }} style={{ display:'flex', alignItems:'center', gap:14, padding:'18px 18px', background:'rgba(255,255,255,0.03)', border:'0.5px solid rgba(255,255,255,0.1)', borderRadius:12, cursor:'pointer', fontFamily:'inherit', textAlign:'left' }}>
            <div style={{ width:38, height:38, borderRadius:19, background:'rgba(255,255,255,0.06)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="4" width="14" height="10" rx="1.5" stroke="#fff" strokeWidth="1.2"/><path d="M3 5l6 5 6-5" stroke="#fff" strokeWidth="1.2" fill="none"/></svg>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, color:'#fff', fontWeight:500 }}>E-mail</div>
              <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', marginTop:2 }}>ma***@gm***.com</div>
            </div>
            <span style={{ color:'rgba(255,255,255,0.3)' }}>›</span>
          </button>
        </div>
      </ForgotShell>
    );
  }

  const dest = channel==='sms' ? '(**) *****-3421' : 'ma***@gm***.com';
  const filled = code.every(d => d.length===1);

  const setDigit = (i, v) => {
    v = v.replace(/\D/g,'').slice(-1);
    const next = [...code]; next[i] = v;
    setCode(next);
    if (v && i<5) refs.current[i+1] && refs.current[i+1].focus();
  };
  const onKey = (i, e) => {
    if (e.key==='Backspace' && !code[i] && i>0) refs.current[i-1] && refs.current[i-1].focus();
  };

  return (
    <ForgotShell title="Insira o código" subtitle={`Enviamos um código de 6 dígitos para ${dest}. Válido por 10 minutos.`}
      onBack={()=> setChannel(null)} step={2}
      footer={<PrimaryButton onClick={onNext} disabled={!filled}>Continuar</PrimaryButton>}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:8, marginBottom:18 }}>
        {code.map((d, i) => (
          <input key={i} ref={el => refs.current[i] = el} value={d} inputMode="numeric"
            onChange={(e)=> setDigit(i, e.target.value)} onKeyDown={(e)=> onKey(i,e)} maxLength={1}
            style={{
              width:44, height:54, textAlign:'center',
              background:'rgba(255,255,255,0.04)', border:`0.5px solid ${d?'rgba(255,255,255,0.4)':'rgba(255,255,255,0.12)'}`,
              borderRadius:11, color:'#fff', fontSize:22, fontWeight:600, fontFamily:'inherit', outline:'none'
            }} />
        ))}
      </div>
      <div style={{ textAlign:'center', fontSize:12.5, color:'rgba(255,255,255,0.5)' }}>
        {resendIn>0 ? `Reenviar código em ${resendIn}s` : (
          <span onClick={()=> setResendIn(60)} style={{ color:'#fff', cursor:'pointer', textDecoration:'underline' }}>Reenviar código</span>
        )}
      </div>
    </ForgotShell>
  );
}

Object.assign(window, { LoginFlow, ForgotPinFlow });
