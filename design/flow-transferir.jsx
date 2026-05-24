// Transferir — 5-step flow, native numpad, no fee
const { useState: tUseState } = React;

function TransferirFlow({ onClose, onComplete, pinVariant, balance }) {
  const [step, setStep] = tUseState('search');
  const [query, setQuery] = tUseState('');
  const [recipient, setRecipient] = tUseState(null);
  const [amount, setAmount] = tUseState(0);
  const [notFound, setNotFound] = tUseState(false);

  const RECENTS = [
    { name:'João Pedro', handle:'@joaopedro', avatar:'JP' },
    { name:'Ana Lima', handle:'@analima', avatar:'AL' },
    { name:'Carlos Mendes', handle:'@carlos', avatar:'CM' },
  ];

  const tryFind = (q) => {
    const f = RECENTS.find(r => r.handle.includes(q.toLowerCase().replace('@','')) ||
                                r.name.toLowerCase().includes(q.toLowerCase()));
    if (f || /^[\d.\-]{11,}$/.test(q) || q.includes('@')) {
      setRecipient(f || { name:'Lucas Andrade', handle:'@lucas_a', avatar:'LA' });
      setNotFound(false);
      setStep('value');
    } else if (q.length >= 2) {
      setNotFound(true);
    }
  };

  // ETAPA 1 — Search
  if (step==='search') return (
    <FlowShell title="Transferir" subtitle="Para quem" onClose={onClose}>
      <Eyebrow>CPF, @handle ou e-mail</Eyebrow>
      <input value={query} onChange={(e)=>{ setQuery(e.target.value); setNotFound(false); }} autoFocus
        placeholder="@handle, CPF ou e-mail"
        style={{ width:'100%', background:'transparent', border:'none', borderBottom:'0.5px solid rgba(255,255,255,0.18)',
          padding:'10px 0', marginTop:8, fontSize:18, color:'#fff', fontFamily:'inherit', outline:'none' }} />
      {notFound && (
        <div style={{ marginTop:14, fontSize:12.5, color:'#EF4444' }}>
          Usuário não encontrado. Verifique o CPF, @handle ou e-mail.
        </div>
      )}
      <div style={{ marginTop:28 }}>
        <Eyebrow>Recentes</Eyebrow>
        {RECENTS.map(p => (
          <div key={p.handle} onClick={()=>{ setRecipient(p); setStep('value'); }} style={{
            display:'flex', alignItems:'center', gap:12, padding:'12px 0',
            borderTop:'0.5px solid rgba(255,255,255,0.07)', cursor:'pointer'
          }}>
            <div style={{ width:36, height:36, borderRadius:18, background:'rgba(255,255,255,0.06)',
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:600, color:'rgba(255,255,255,0.8)' }}>
              {p.avatar}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14.5, color:'#fff' }}>{p.name}</div>
              <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)' }}>{p.handle}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ flex:1 }} />
      <PrimaryButton onClick={()=> tryFind(query)} disabled={query.length < 2}>Buscar</PrimaryButton>
    </FlowShell>
  );

  // ETAPA 2 — Value (native numpad)
  if (step==='value') return (
    <NumpadValueScreen
      recipient={recipient}
      balance={balance}
      onSwap={()=> setStep('search')}
      onClose={onClose}
      onContinue={(amt)=>{ setAmount(amt); setStep('pin'); }}
    />
  );

  // ETAPA 3 — PIN with recap card
  if (step==='pin') return (
    <PinScreen open variant={pinVariant} ctx="transferir"
      recipient={{ name: recipient.name, label:'Para', id: recipient.handle }}
      amount={amount} unit="Albers"
      feeFree={true}
      onClose={onClose}
      onComplete={()=> setStep('security')} />
  );

  // ETAPA 4 — Security
  if (step==='security') return (
    <SecurityConfirm open onClose={onClose} onComplete={()=> setStep('success')} />
  );

  // ETAPA 5 — Success com recibo
  if (step==='success') return (
    <TransferirSuccessScreen
      recipient={recipient}
      amount={amount}
      remaining={balance - amount}
      onClose={()=> onComplete && onComplete(amount)}
    />
  );

  return null;
}

// Native (non-scrambled) numpad screen
function NumpadValueScreen({ recipient, balance, onSwap, onClose, onContinue }) {
  const [digits, setDigits] = tUseState('');
  const value = parseInt(digits || '0', 10);
  const tooMuch = value > balance;
  const valid = value > 0 && !tooMuch;

  const press = (k) => {
    if (k === 'del') {
      setDigits(d => d.slice(0,-1));
    } else {
      setDigits(d => {
        const nd = (d + k).replace(/^0+/, '');
        return nd.length > 5 ? d : nd;
      });
    }
  };

  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:55, display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <div style={{ padding:'8px 24px 0', display:'flex', alignItems:'center' }}>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.55)', fontSize:13, padding:'8px 0', cursor:'pointer', fontFamily:'inherit' }}>‹ Voltar</button>
      </div>
      <div style={{ padding:'12px 24px 0' }}>
        <Eyebrow>Quanto transferir</Eyebrow>
      </div>

      {/* Recipient card with swap */}
      <div style={{ margin:'14px 24px 0', padding:'12px 14px', background:'rgba(255,255,255,0.04)',
        border:'0.5px solid rgba(255,255,255,0.1)', borderRadius:12, display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:32, height:32, borderRadius:16, background:'rgba(255,255,255,0.08)',
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:11.5, fontWeight:600, color:'#fff' }}>
          {recipient.avatar || recipient.name.split(' ').map(s=>s[0]).slice(0,2).join('')}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13.5, color:'#fff', fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{recipient.name}</div>
          <div style={{ fontSize:11.5, color:'rgba(255,255,255,0.45)' }}>{recipient.handle}</div>
        </div>
        <button onClick={onSwap} style={{
          background:'transparent', border:'0.5px solid rgba(255,255,255,0.15)', borderRadius:6,
          color:'rgba(255,255,255,0.85)', fontSize:11, fontFamily:'inherit', padding:'5px 10px', cursor:'pointer', letterSpacing:'0.04em'
        }}>Trocar</button>
      </div>

      {/* Big value */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'0 24px' }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:9, animation: tooMuch?'shake 0.3s':'none' }}>
          <span style={{ fontSize:64, fontWeight:700, color: tooMuch?'#EF4444':'#fff', letterSpacing:'-0.04em', lineHeight:1, fontVariantNumeric:'tabular-nums' }}>
            {digits || '0'}
          </span>
          <span style={{ fontSize:16, color:'rgba(255,255,255,0.45)' }}>Albers</span>
        </div>
        <div style={{ marginTop:14, fontSize:12, color: tooMuch?'#EF4444':'rgba(255,255,255,0.45)' }}>
          {tooMuch ? 'Saldo insuficiente' : `Saldo disponível: ${balance} Albers`}
        </div>
      </div>

      {/* Native numpad */}
      <div style={{ padding:'0 16px 12px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
          {['1','2','3','4','5','6','7','8','9','','0','del'].map((k,i)=> (
            <button key={i} onClick={()=> k && press(k)} disabled={!k} style={{
              height:54, background: k? 'rgba(255,255,255,0.05)':'transparent',
              border: k? '0.5px solid rgba(255,255,255,0.08)':'none',
              borderRadius:12, color:'#fff', fontSize:22, fontWeight:500, fontFamily:'inherit',
              cursor: k?'pointer':'default', visibility: k===''?'hidden':'visible'
            }}>
              {k==='del' ? '⌫' : k}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding:'4px 24px 28px' }}>
        <PrimaryButton disabled={!valid} onClick={()=> onContinue(value)}>Continuar</PrimaryButton>
      </div>
    </div>
  );
}

// Success com recibo formal
function TransferirSuccessScreen({ recipient, amount, remaining, onClose }) {
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:65, display:'flex', flexDirection:'column', padding:'0 24px' }}>
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
        <div style={{
          width:64, height:64, borderRadius:32, border:'1.5px solid rgba(34,197,94,0.4)',
          display:'flex', alignItems:'center', justifyContent:'center', marginBottom:24,
          animation:'pop 0.4s cubic-bezier(0.32,0.72,0,1)'
        }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M7 14l4.5 4.5L21 9" stroke="#22C55E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={{ fontSize:26, fontWeight:700, color:'#fff', letterSpacing:'-0.025em', textAlign:'center' }}>
          {amount} Albers enviados!
        </div>
        <div style={{ fontSize:13, color:'rgba(255,255,255,0.5)', textAlign:'center', marginTop:10, lineHeight:1.5 }}>
          Transferência para <span style={{ color:'#fff' }}>{recipient.handle}</span><br/>concluída com sucesso
        </div>

        <div style={{ width:'100%', marginTop:32, padding:'14px 18px', background:'rgba(255,255,255,0.03)',
          border:'0.5px solid rgba(255,255,255,0.08)', borderRadius:14, display:'flex', flexDirection:'column', gap:0 }}>
          {[
            ['Para', recipient.handle],
            ['Valor', `${amount} Albers`],
            ['Taxa', 'Gratuita', '#22C55E'],
            ['Saldo restante', `${remaining} Albers`],
          ].map(([l,v,c],i,a)=>(
            <div key={l} style={{
              display:'flex', justifyContent:'space-between', padding:'10px 0',
              borderBottom: i<a.length-1?'0.5px solid rgba(255,255,255,0.05)':'none'
            }}>
              <span style={{ fontSize:12.5, color:'rgba(255,255,255,0.5)' }}>{l}</span>
              <span style={{ fontSize:13, fontWeight:500, color: c||'#fff' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ paddingBottom:36 }}>
        <PrimaryButton onClick={onClose}>Voltar para Home</PrimaryButton>
      </div>
    </div>
  );
}

Object.assign(window, { TransferirFlow });
