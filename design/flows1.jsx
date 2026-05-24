// Home + Receber + Carregar + Descarregar screens
const { SPACE_SKINS } = window.ALBER;

function HomeScreen({ skin, balance, balanceHidden, onToggleBalance, onAction, onSpaceClick, onBannerClick, kycStatus, evaluation, onNavBanner }) {
  const sk = SPACE_SKINS[skin] || SPACE_SKINS.none;
  const hour = new Date().getHours();
  const greeting = hour>=5&&hour<12?'Bom dia,': hour<18?'Boa tarde,':'Boa noite,';

  return (
    <div style={{ position:'absolute', inset:0, overflow:'hidden' }}>
      {/* Skin background */}
      <div style={{ position:'absolute', inset:0, background: sk.bg, transition:'background 0.7s ease' }} />
      <AlberWatermark skin={sk} />

      <div style={{ position:'relative', zIndex:10, height:'100%', display:'flex', flexDirection:'column' }}>
        <StatusBar />

        {/* Header */}
        <div style={{ padding:'10px 24px 0', display:'flex', alignItems:'center', gap:12 }}>
          <AlberA size={32} />
          <div>
            <div style={{ fontSize:13, color:'rgba(255,255,255,0.42)' }}>{greeting}</div>
            <div style={{ fontSize:17, fontWeight:600, color:'#fff', letterSpacing:'-0.02em', marginTop:1 }}>Mayte</div>
          </div>
          <div style={{ marginLeft:'auto', position:'relative' }}>
            <div onClick={onNavBanner} style={{
              width:36, height:36, borderRadius:18, background:'rgba(255,255,255,0.06)',
              border:'0.5px solid rgba(255,255,255,0.1)', display:'flex', alignItems:'center',
              justifyContent:'center', cursor:'pointer', position:'relative'
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 6a5 5 0 1 1 10 0v2.5l1.5 2H1.5l1.5-2V6Z" stroke="rgba(255,255,255,0.7)" strokeWidth="1.3"/>
                <path d="M6 12.5a2 2 0 0 0 4 0" stroke="rgba(255,255,255,0.7)" strokeWidth="1.3"/>
              </svg>
              <div style={{ position:'absolute', top:8, right:9, width:6, height:6, borderRadius:3, background: sk.accent }} />
            </div>
          </div>
        </div>

        {/* Banner */}
        {kycStatus !== 'approved' && (
          <div style={{ padding:'14px 24px 0' }}>
            <Banner
              tone={kycStatus==='rejected'?'error':'warning'}
              text={kycStatus==='submitted'?'Verificação em análise — até 24h':
                    kycStatus==='rejected'?'Verificação reprovada — reenvie documentos':
                    'Verificação pendente para carregar'}
              cta="Verificar →"
              onClick={onBannerClick}
            />
          </div>
        )}

        {evaluation && kycStatus==='approved' && (
          <div style={{ padding:'14px 24px 0' }}>
            <Banner tone="info" text="Conta em avaliação — limite R$ 2.000 restantes" cta="Saiba mais" />
          </div>
        )}

        {/* Balance */}
        <div style={{ padding:'30px 24px 0' }}>
          <Eyebrow>Seu saldo</Eyebrow>
          <div onClick={onToggleBalance} style={{
            display:'flex', alignItems:'baseline', gap:9, cursor:'pointer', marginTop:6
          }}>
            <span style={{
              fontSize:54, fontWeight:700, color:'#fff', letterSpacing:'-0.04em', lineHeight:1,
              fontVariantNumeric:'tabular-nums'
            }}>{balanceHidden ? '••••' : balance}</span>
            <span style={{ fontSize:17, color:'rgba(255,255,255,0.45)', fontWeight:400 }}>Albers</span>
          </div>
          <div onClick={()=> onAction('carregar')} style={{
            marginTop:8, fontSize:13, color:'rgba(255,255,255,0.42)', cursor:'pointer',
            display:'inline-flex', alignItems:'center', gap:4
          }}>+ Carregar mais</div>
        </div>

        {/* Lounge area */}
        <div style={{ padding:'40px 24px 24px', flex:1 }}>
          <Eyebrow>Seu Lounge atual</Eyebrow>
          <div onClick={onSpaceClick} style={{
            fontSize:26, fontWeight:700, color:'#fff', letterSpacing:'-0.02em', cursor:'pointer', marginTop:6,
            display:'flex', alignItems:'center', gap:10
          }}>
            {skin !== 'none' && <span style={{ width:8, height:8, borderRadius:'50%', background: sk.accent }} />}
            {sk.name}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft:2, opacity:0.4 }}>
              <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </div>
          {sk.role && <div style={{ marginTop:6, fontSize:10, color:'rgba(255,255,255,0.32)', letterSpacing:'0.14em' }}>{sk.role}</div>}
        </div>

        {/* Action rows */}
        <div style={{ padding:'0 24px 96px' }}>
          <ActionRow
            icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v11M4 10l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            label="Receber" onClick={() => onAction('receber')} />
          <ActionRow
            icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 17V6M4 10l6-6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            label="Carregar" sublabel={kycStatus!=='approved'?'Verificação necessária':null} onClick={() => onAction('carregar')} />
          <ActionRow
            icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 10h14M12 5l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            label="Transferir" onClick={() => onAction('transferir')} />
          <ActionRow
            icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 10h11M11 6l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 5v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>}
            label="Split" onClick={() => onAction('split')} />
        </div>
      </div>
    </div>
  );
}

// ─────────── RECEBER ──────────────
function ReceberFlow({ onClose, onComplete, pinVariant }) {
  const [step, setStep] = React.useState('value');
  const [amount, setAmount] = React.useState('120');
  const [identifier, setIdentifier] = React.useState('@joaosilva');
  const [payer, setPayer] = React.useState(null);

  const find = () => {
    setTimeout(() => {
      setPayer({ name:'João Silva Pereira', id:'***.***.789-01', handle:'@joaosilva' });
      setStep('payer');
    }, 200);
  };

  if (step === 'value') return (
    <FlowShell title="Receber" subtitle="Definir valor" onClose={onClose}>
      <Eyebrow>Valor a receber</Eyebrow>
      <div style={{ display:'flex', alignItems:'baseline', gap:9, marginTop:14, marginBottom:24 }}>
        <input value={amount} onChange={(e)=>setAmount(e.target.value.replace(/[^\d]/g,''))} autoFocus
          style={{ flex:1, fontSize:54, fontWeight:700, color:'#fff', background:'transparent', border:'none', outline:'none',
            fontFamily:'inherit', letterSpacing:'-0.04em', padding:0, fontVariantNumeric:'tabular-nums', minWidth:0 }} />
        <span style={{ fontSize:17, color:'rgba(255,255,255,0.45)' }}>Albers</span>
      </div>
      <Rule />
      <div style={{ marginTop:18, fontSize:12, color:'rgba(255,255,255,0.4)', lineHeight:1.5 }}>
        O pagador será autenticado neste device com PIN e confirmação de segurança.
      </div>
      <div style={{ flex:1 }} />
      <PrimaryButton onClick={()=> setStep('identify')} disabled={!amount || amount==='0'}>Continuar</PrimaryButton>
    </FlowShell>
  );

  if (step === 'identify') return (
    <FlowShell title="Receber" subtitle="Identificar pagador" onClose={()=> setStep('value')} back>
      <Eyebrow>CPF, @handle ou telefone</Eyebrow>
      <input value={identifier} onChange={(e)=>setIdentifier(e.target.value)} autoFocus
        style={{ width:'100%', background:'transparent', border:'none', borderBottom:'0.5px solid rgba(255,255,255,0.18)',
          padding:'10px 0', marginTop:8, fontSize:18, color:'#fff', fontFamily:'inherit', outline:'none' }} />
      <div style={{ marginTop:24 }}>
        <Eyebrow>Recentes</Eyebrow>
        {[{n:'João Silva Pereira', h:'@joaosilva'},{n:'Ana Maria Costa', h:'@ana_costa'},{n:'Pedro Henrique', h:'@phenrique'}].map(p => (
          <div key={p.h} onClick={()=>{ setIdentifier(p.h); }} style={{
            display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderTop:'0.5px solid rgba(255,255,255,0.07)', cursor:'pointer'
          }}>
            <div style={{ width:36, height:36, borderRadius:18, background:'rgba(255,255,255,0.06)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:600, color:'rgba(255,255,255,0.7)' }}>
              {p.n[0]}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14.5, color:'#fff' }}>{p.n}</div>
              <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)' }}>{p.h}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ flex:1 }} />
      <PrimaryButton onClick={find}>Buscar</PrimaryButton>
    </FlowShell>
  );

  if (step === 'payer') return (
    <FlowShell title="Receber" subtitle="Confirmar pagador" onClose={()=>setStep('identify')} back>
      <Eyebrow>Você está cobrando</Eyebrow>
      <div style={{ marginTop:14, padding:'18px 18px', border:'0.5px solid rgba(255,255,255,0.12)', borderRadius:14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ width:46, height:46, borderRadius:23, background:'rgba(255,255,255,0.08)',
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:600, color:'#fff' }}>JS</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:16, fontWeight:500, color:'#fff' }}>{payer.name}</div>
            <div style={{ fontSize:12.5, color:'rgba(255,255,255,0.45)', marginTop:2 }}>{payer.handle} · {payer.id}</div>
          </div>
        </div>
      </div>
      <div style={{ marginTop:32 }}>
        <Eyebrow>Valor</Eyebrow>
        <div style={{ display:'flex', alignItems:'baseline', gap:9, marginTop:6 }}>
          <span style={{ fontSize:42, fontWeight:700, color:'#fff', letterSpacing:'-0.04em' }}>{amount}</span>
          <span style={{ fontSize:15, color:'rgba(255,255,255,0.45)' }}>Albers</span>
        </div>
      </div>
      <div style={{ flex:1 }} />
      <div style={{ fontSize:11, color:'rgba(255,255,255,0.32)', lineHeight:1.5, marginBottom:14, textAlign:'center' }}>
        Ao continuar, o pagador autentica neste device com PIN e segurança.
      </div>
      <PrimaryButton onClick={()=> setStep('pin')}>Solicitar pagamento</PrimaryButton>
    </FlowShell>
  );

  if (step === 'pin') return (
    <PinScreen open onClose={onClose} variant={pinVariant} ctx="receber"
      recipient={{ name: payer.name, id: payer.id, label:'Pagador' }}
      amount={amount} unit="Albers"
      onComplete={()=> setStep('security')} />
  );

  if (step === 'security') return (
    <SecurityConfirm open onClose={onClose} onComplete={()=> setStep('success')} />
  );

  if (step === 'success') return (
    <SuccessScreen
      title={`${amount} Albers recebidos`}
      detail={<><div>De <span style={{ color:'#fff' }}>{payer.handle}</span></div><div>Para <span style={{ color:'#fff' }}>@mayte</span></div></>}
      onClose={()=> onComplete && onComplete(parseInt(amount,10))}
    />
  );

  return null;
}

// ─────────── CARREGAR / DESCARREGAR ──────────────
function CarregarFlow({ onClose, onComplete, pinVariant }) {
  const [tab, setTab] = React.useState('carregar');
  const [step, setStep] = React.useState('value');
  const [amountBRL, setAmountBRL] = React.useState('100,00');
  const [countdown, setCountdown] = React.useState(30*60);

  React.useEffect(() => {
    if (step!=='qr') return;
    const t = setInterval(()=> setCountdown(c => Math.max(0, c-1)), 1000);
    return () => clearInterval(t);
  }, [step]);

  const fmtTime = (s) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  if (step==='value') return (
    <FlowShell title={tab==='carregar'?'Carregar':'Descarregar'} subtitle="Definir valor" onClose={onClose}>
      <div style={{ display:'flex', gap:6, marginBottom:28, padding:3, background:'rgba(255,255,255,0.04)', borderRadius:10 }}>
        {['carregar','descarregar'].map(t => (
          <button key={t} onClick={()=>setTab(t)} style={{
            flex:1, padding:'10px 0', border:'none', cursor:'pointer',
            background: tab===t?'rgba(255,255,255,0.08)':'transparent',
            borderRadius:8, color:'#fff', fontSize:13, fontWeight:500, fontFamily:'inherit',
            opacity: tab===t?1:0.55
          }}>{t==='carregar'?'Carregar':'Descarregar'}</button>
        ))}
      </div>
      <Eyebrow>Valor em reais</Eyebrow>
      <div style={{ display:'flex', alignItems:'baseline', gap:6, marginTop:14, marginBottom:24 }}>
        <span style={{ fontSize:34, color:'rgba(255,255,255,0.45)' }}>R$</span>
        <input value={amountBRL} onChange={(e)=>setAmountBRL(e.target.value)} autoFocus
          style={{ flex:1, fontSize:48, fontWeight:700, color:'#fff', background:'transparent', border:'none', outline:'none',
            fontFamily:'inherit', letterSpacing:'-0.04em', padding:0, minWidth:0 }} />
      </div>
      <Eyebrow>Atalhos</Eyebrow>
      <div style={{ display:'flex', gap:8, marginTop:10 }}>
        {[20,50,100,200].map(v => (
          <button key={v} onClick={()=>setAmountBRL(v+',00')} style={{
            flex:1, padding:'12px 0', background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.09)',
            borderRadius:10, color:'#fff', fontSize:13, fontWeight:500, fontFamily:'inherit', cursor:'pointer'
          }}>R$ {v}</button>
        ))}
      </div>
      <div style={{ marginTop:18, padding:'12px 14px', background:'rgba(245,158,11,0.05)',
        border:'0.5px solid rgba(245,158,11,0.18)', borderRadius:10, fontSize:11.5, color:'rgba(245,158,11,0.85)', lineHeight:1.4 }}>
        {tab==='carregar' ? 'Pague apenas de conta no seu CPF. Pix de outros titulares são devolvidos automaticamente.' : 'O Pix será enviado para sua chave cadastrada. Mesma titularidade obrigatória.'}
      </div>
      <div style={{ flex:1 }} />
      <PrimaryButton onClick={()=> tab==='carregar' ? setStep('qr') : setStep('confirm')}>
        {tab==='carregar' ? 'Gerar QR Code' : 'Continuar'}
      </PrimaryButton>
    </FlowShell>
  );

  if (step==='qr') return (
    <FlowShell title="Carregar" subtitle="Pague o Pix" onClose={onClose}>
      <div style={{ marginTop:8, textAlign:'center' }}>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', letterSpacing:'0.1em' }}>VALOR</div>
        <div style={{ fontSize:32, fontWeight:700, color:'#fff', letterSpacing:'-0.03em', marginTop:4 }}>R$ {amountBRL}</div>
      </div>
      <div style={{
        margin:'20px auto 0', width:200, height:200, background:'#fff', borderRadius:14,
        position:'relative', display:'flex', alignItems:'center', justifyContent:'center'
      }}>
        <QRCodeArt />
      </div>
      <div style={{ marginTop:18, textAlign:'center' }}>
        <div style={{
          fontSize:14, fontWeight:600, color: countdown<60?'#F59E0B':'#fff',
          fontVariantNumeric:'tabular-nums'
        }}>Expira em {fmtTime(countdown)}</div>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.32)', marginTop:4 }}>CPF ***.***.456-78</div>
      </div>
      <div style={{ display:'flex', gap:8, marginTop:18 }}>
        <button style={ghostBtn}>Copiar código</button>
        <button style={ghostBtn}>Compartilhar</button>
      </div>
      <div style={{ flex:1 }} />
      <PrimaryButton variant="ghost" onClick={()=> setStep('value')}>Cancelar</PrimaryButton>
    </FlowShell>
  );

  if (step==='confirm') return (
    <FlowShell title="Descarregar" subtitle="Revisar saída" onClose={()=>setStep('value')} back>
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <Row label="Valor" value={`R$ ${amountBRL}`} />
        <Row label="Taxa" value="−R$ 0,50" muted />
        <Row label="Você recebe" value={`R$ ${(parseFloat(amountBRL.replace(',','.'))-0.5).toFixed(2).replace('.',',')}`} bold />
        <Row label="Para chave" value="(11) ****-1234" muted />
      </div>
      <div style={{ flex:1 }} />
      <PrimaryButton onClick={()=> setStep('pin')}>Continuar</PrimaryButton>
    </FlowShell>
  );

  if (step==='pin') return (
    <PinScreen open variant={pinVariant} ctx="descarregar"
      amount={amountBRL} unit="reais"
      onClose={onClose}
      onComplete={()=> setStep('security')} />
  );

  if (step==='security') return (
    <SecurityConfirm open onClose={onClose} onComplete={()=> setStep('success')} />
  );

  if (step==='success') return (
    <SuccessScreen
      title={tab==='carregar'?`R$ ${amountBRL} carregados`:`R$ ${amountBRL} enviados`}
      detail={tab==='carregar'?'Saldo creditado em Albers':'Pix concluído para sua chave'}
      onClose={()=> onComplete && onComplete()}
    />
  );
}

// Helpers
function FlowShell({ title, subtitle, onClose, back, children }) {
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:55, display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <div style={{ padding:'8px 24px 0', display:'flex', alignItems:'center' }}>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.55)', fontSize:13, padding:'8px 0', cursor:'pointer', fontFamily:'inherit' }}>
          {back ? '‹ Voltar' : '✕ Cancelar'}
        </button>
      </div>
      <div style={{ padding:'12px 24px 0' }}>
        <Eyebrow>{subtitle}</Eyebrow>
        <div style={{ fontSize:28, fontWeight:700, color:'#fff', letterSpacing:'-0.025em', marginTop:6 }}>{title}</div>
      </div>
      <div style={{ padding:'28px 24px 56px', flex:1, display:'flex', flexDirection:'column' }}>
        {children}
      </div>
    </div>
  );
}

const ghostBtn = {
  flex:1, padding:'12px 0', background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.09)',
  borderRadius:10, color:'rgba(255,255,255,0.85)', fontSize:12.5, fontWeight:500, fontFamily:'inherit', cursor:'pointer',
  letterSpacing:'0.02em'
};

function Row({ label, value, muted, bold }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'14px 0', borderBottom:'0.5px solid rgba(255,255,255,0.06)' }}>
      <span style={{ fontSize:13.5, color:'rgba(255,255,255,0.5)' }}>{label}</span>
      <span style={{ fontSize: bold?16:14, color: muted?'rgba(255,255,255,0.55)':'#fff', fontWeight: bold?600:400, fontVariantNumeric:'tabular-nums' }}>{value}</span>
    </div>
  );
}

function SuccessScreen({ title, detail, onClose }) {
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:65, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{
        width:64, height:64, borderRadius:32, border:'1.5px solid rgba(34,197,94,0.4)',
        display:'flex', alignItems:'center', justifyContent:'center', marginBottom:24,
        animation:'pop 0.4s cubic-bezier(0.32,0.72,0,1)'
      }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <path d="M7 14l4.5 4.5L21 9" stroke="#22C55E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div style={{ fontSize:24, fontWeight:700, color:'#fff', letterSpacing:'-0.02em', textAlign:'center', marginBottom:12 }}>{title}</div>
      <div style={{ fontSize:13.5, color:'rgba(255,255,255,0.5)', textAlign:'center', lineHeight:1.6 }}>{detail}</div>
      <div style={{ position:'absolute', bottom:36, left:24, right:24 }}>
        <PrimaryButton onClick={onClose}>Concluir</PrimaryButton>
      </div>
    </div>
  );
}

// QR placeholder art — semi-realistic
function QRCodeArt() {
  // Generate a 25x25 grid with finder patterns
  const cells = React.useMemo(() => {
    const g = Array.from({length:25}, () => Array.from({length:25}, () => Math.random()<0.46?1:0));
    // Finder patterns at 0,0 / 0,18 / 18,0
    const drawFinder = (r,c) => {
      for (let i=0;i<7;i++) for (let j=0;j<7;j++) {
        g[r+i][c+j] = (i===0||i===6||j===0||j===6 || (i>=2&&i<=4&&j>=2&&j<=4)) ? 1 : 0;
      }
    };
    drawFinder(0,0); drawFinder(0,18); drawFinder(18,0);
    return g;
  }, []);
  return (
    <svg width="170" height="170" viewBox="0 0 25 25">
      {cells.flatMap((row,i) => row.map((v,j) => v?<rect key={i+'-'+j} x={j} y={i} width="1" height="1" fill="#000" />:null))}
    </svg>
  );
}

Object.assign(window, { HomeScreen, ReceberFlow, CarregarFlow, FlowShell, SuccessScreen, Row });
