// Split + Spaces + Atividade + Perfil + Achar

// ─────────── SPLIT ──────────────
const MOCK_SPLITS = [
  { id:'s1', name:'Jantar Sushi Yan', type:'fixo', total:480, perPerson:120, participants:[
    { name:'Mayte', handle:'@mayte', status:'owner' },
    { name:'João Silva', handle:'@joaosilva', status:'accepted' },
    { name:'Ana Costa', handle:'@ana_costa', status:'accepted' },
    { name:'Pedro H.', handle:'@phenrique', status:'pending' },
  ], status:'active', expires:'em 2 dias' },
  { id:'s2', name:'Airbnb Trancoso', type:'variavel', target:1800, blocked:300, participants:[
    { name:'Mayte', handle:'@mayte', status:'owner' },
    { name:'Camila', handle:'@cami', status:'accepted' },
    { name:'Lucas', handle:'@lucasm', status:'accepted' },
    { name:'Bia', handle:'@bia', status:'accepted', isNew:true },
  ], status:'active', expires:'em 5 dias',
    launches:[
      { id:'l1', desc:'Diária Airbnb (3 noites)', value:540, by:'@mayte', when:'2h atrás', photo:'cap_diaria' },
      { id:'l2', desc:'Mercado — pão, fruta, água', value:96, by:'@mayte', when:'1h atrás' },
      { id:'l3', desc:'Uber aeroporto → casa', value:84, by:'@cami', when:'45min atrás', photo:'cap_uber' },
    ],
    recalculated:true
  },
  { id:'s3', name:'Uber pra praia', type:'fixo', total:80, perPerson:20, participants:[
    { name:'Mayte', handle:'@mayte', status:'owner' },
    { name:'Bia', handle:'@bia', status:'accepted' },
    { name:'Lucas', handle:'@lucasm', status:'accepted' },
    { name:'João', handle:'@joaosilva', status:'accepted' },
  ], status:'closed' },
];

function SplitListScreen({ onBack, onCreate, onOpen }) {
  const active = MOCK_SPLITS.filter(s => s.status==='active');
  const closed = MOCK_SPLITS.filter(s => s.status==='closed');

  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:50, display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <TopBar title="Splits" onBack={onBack} right={
        <button onClick={onCreate} style={{
          background:'#fff', color:'#000', border:'none', height:34, padding:'0 14px', borderRadius:17,
          fontSize:12, fontWeight:600, fontFamily:'inherit', cursor:'pointer', letterSpacing:'0.04em'
        }}>+ Criar</button>
      }/>

      <div style={{ flex:1, overflowY:'auto', padding:'8px 24px 96px' }}>
        <div style={{ marginBottom:8 }}>
          <Eyebrow>Ativos · {active.length}</Eyebrow>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:28 }}>
          {active.map(s => <SplitCard key={s.id} split={s} onClick={()=> onOpen(s.id)} />)}
        </div>

        <div style={{ marginBottom:8 }}>
          <Eyebrow>Encerrados · {closed.length}</Eyebrow>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {closed.map(s => <SplitCard key={s.id} split={s} onClick={()=> onOpen(s.id)} closed />)}
        </div>
      </div>
    </div>
  );
}

function SplitCard({ split, onClick, closed }) {
  const accepted = split.participants.filter(p => p.status==='accepted' || p.status==='owner').length;
  const total = split.participants.length;
  return (
    <div onClick={onClick} style={{
      padding:'16px 18px', background:'rgba(255,255,255,0.03)',
      border:'0.5px solid rgba(255,255,255,0.08)', borderRadius:14, cursor:'pointer',
      opacity: closed ? 0.55 : 1
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
        <div style={{
          fontSize:9.5, color: split.type==='fixo'?'#7DA3E0':'#5BCEC9', letterSpacing:'0.14em',
          padding:'3px 7px', border:`0.5px solid ${split.type==='fixo'?'rgba(125,163,224,0.3)':'rgba(91,206,201,0.3)'}`,
          borderRadius:4
        }}>{split.type === 'fixo' ? 'FIXO' : 'VARIÁVEL'}</div>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{split.expires || 'Concluído'}</div>
      </div>
      <div style={{ fontSize:16, fontWeight:600, color:'#fff', marginBottom:6 }}>{split.name}</div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:-4 }}>
          {split.participants.slice(0,4).map((p,i) => (
            <div key={i} style={{
              width:24, height:24, borderRadius:12, marginLeft: i===0?0:-6,
              background:`hsl(${(p.handle.charCodeAt(1)*23)%360}, 18%, 22%)`,
              border:'1.5px solid #0a0a0a',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:9.5, fontWeight:600, color:'#fff'
            }}>{p.name[0]}</div>
          ))}
          {split.participants.length>4 && (
            <div style={{ marginLeft:-6, width:24, height:24, borderRadius:12, background:'#1a1a1a', border:'1.5px solid #0a0a0a',
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, color:'rgba(255,255,255,0.6)' }}>+{split.participants.length-4}</div>
          )}
          <span style={{ fontSize:12, color:'rgba(255,255,255,0.5)', marginLeft:10 }}>{accepted}/{total}</span>
        </div>
        <div style={{ fontSize:15, fontWeight:600, color:'#fff', fontVariantNumeric:'tabular-nums' }}>
          {split.type==='fixo' ? `${split.perPerson}` : `até ${split.target}`} <span style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{split.type==='fixo'?'cada':'total'}</span>
        </div>
      </div>
    </div>
  );
}

function SplitDetailScreen({ id, onBack, onClose, onPin }) {
  const split = MOCK_SPLITS.find(s => s.id===id);
  const [allocations, setAllocations] = React.useState(() =>
    split.participants.reduce((a,p) => ({ ...a, [p.handle]: split.type==='variavel' ? 280 : 0 }), {})
  );
  const [closing, setClosing] = React.useState(false);
  const [launches, setLaunches] = React.useState(split.launches || []);
  const [showLaunchSheet, setShowLaunchSheet] = React.useState(false);
  const [lightboxPhoto, setLightboxPhoto] = React.useState(null);
  const [recalcDismissed, setRecalcDismissed] = React.useState(false);

  if (!split) return null;
  const total = Object.values(allocations).reduce((a,b)=> a+(parseInt(b,10)||0), 0);
  const isVar = split.type==='variavel';
  const launchTotal = launches.reduce((a,l)=> a + l.value, 0);
  const activeP = split.participants.filter(p => p.status==='accepted' || p.status==='owner');
  const myShare = launchTotal / Math.max(1, activeP.length);
  const myBlocked = Math.round((split.target - 0) / Math.max(1, activeP.length));
  const remaining = split.target - launchTotal;

  const addLaunch = (desc, value, photo) => {
    const v = parseFloat(value);
    if (!desc || !v) return;
    if (launchTotal + v > split.target) return; // block
    setLaunches(l => [...l, { id:'l'+Date.now(), desc, value:v, by:'@mayte', when:'agora', photo: photo || null }]);
    setShowLaunchSheet(false);
  };

  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:50, display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <TopBar title={split.name} onBack={onBack} contextLabel={split.type==='fixo'?'SPLIT FIXO':'SPLIT VARIÁVEL'} />

      <div style={{ flex:1, overflowY:'auto', padding:'8px 24px 36px' }}>
        {/* Recálculo banner */}
        {isVar && split.recalculated && !recalcDismissed && !closing && (
          <div style={{ marginBottom:14, padding:'12px 14px', background:'rgba(91,206,201,0.07)', border:'0.5px solid rgba(91,206,201,0.28)', borderRadius:12, display:'flex', alignItems:'flex-start', gap:10 }}>
            <div style={{ width:26, height:26, borderRadius:13, background:'rgba(91,206,201,0.18)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h7M6 4l3 3-3 3M9.5 11A4.5 4.5 0 1 0 6 2.5" stroke="#5BCEC9" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, color:'#fff', fontWeight:500, marginBottom:3 }}>Seu valor foi recalculado</div>
              <div style={{ fontSize:11.5, color:'rgba(255,255,255,0.6)', lineHeight:1.45 }}>
                <span style={{ color:'#5BCEC9' }}>@bia</span> entrou no split. O saldo restante (R$ {split.target - launchTotal}) foi dividido igualmente entre os 4 participantes.
              </div>
            </div>
            <button onClick={()=>setRecalcDismissed(true)} style={{ background:'transparent', border:'none', color:'rgba(255,255,255,0.4)', fontSize:16, cursor:'pointer', padding:4 }}>×</button>
          </div>
        )}

        {!closing && (
          <>
            <div style={{ display:'flex', gap:10 }}>
              <Stat label={isVar?'Já gasto':'Total'} value={isVar?`${launchTotal}`:`${split.total}`} unit="Albers" />
              <Stat label={isVar?'Teto':'Por pessoa'} value={isVar?`${split.target}`:`${split.perPerson}`} unit="Albers" />
            </div>

            {isVar && launches.length>0 && (
              <div style={{ marginTop:12, padding:'12px 14px', background:'rgba(255,255,255,0.03)', border:'0.5px solid rgba(255,255,255,0.08)', borderRadius:12 }}>
                <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'0.12em', marginBottom:6 }}>SUA PARTE ATÉ AGORA</div>
                <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
                  <div>
                    <span style={{ fontSize:22, fontWeight:700, color:'#5BCEC9', fontVariantNumeric:'tabular-nums' }}>{myShare.toFixed(0)}</span>
                    <span style={{ fontSize:12, color:'rgba(255,255,255,0.4)', marginLeft:5 }}>de {myBlocked} bloqueados</span>
                  </div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)' }}>
                    R$ {remaining} restantes
                  </div>
                </div>
                <div style={{ marginTop:10, height:3, background:'rgba(255,255,255,0.06)', borderRadius:2, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${Math.min(100, (myShare/myBlocked)*100)}%`, background:'#5BCEC9', transition:'width 0.3s' }} />
                </div>
              </div>
            )}

            {/* Launches feed (variavel only) */}
            {isVar && (
              <>
                <div style={{ marginTop:22, marginBottom:10, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <Eyebrow>Conta · {launches.length} {launches.length===1?'item':'itens'}</Eyebrow>
                  <button onClick={()=> setShowLaunchSheet(true)} style={{
                    background:'transparent', border:'0.5px solid rgba(91,206,201,0.4)', borderRadius:6,
                    color:'#5BCEC9', fontSize:11, padding:'4px 10px', fontFamily:'inherit', cursor:'pointer',
                    fontWeight:600, letterSpacing:'0.04em'
                  }}>+ LANÇAR ITEM</button>
                </div>
                {launches.length === 0 && (
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)', padding:'12px 0', textAlign:'center' }}>
                    Lance itens da conta em tempo real. Cada item é dividido igualmente entre todos.
                  </div>
                )}
                {launches.map(l => (
                  <div key={l.id} style={{ padding:'12px 0', borderTop:'0.5px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <div style={{ width:28, height:28, borderRadius:14, background:'rgba(91,206,201,0.1)', border:'0.5px solid rgba(91,206,201,0.25)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M6 2v8" stroke="#5BCEC9" strokeWidth="1.4" strokeLinecap="round"/></svg>
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13.5, color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{l.desc}</div>
                        <div style={{ fontSize:10.5, color:'rgba(255,255,255,0.4)', marginTop:2 }}>{l.by} · {l.when}</div>
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <div style={{ fontSize:13, color:'#fff', fontWeight:600, fontVariantNumeric:'tabular-nums' }}>R$ {l.value}</div>
                        <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>R$ {(l.value/activeP.length).toFixed(0)} cada</div>
                      </div>
                    </div>
                    {l.photo && (
                      <div onClick={()=> setLightboxPhoto(l.photo)} style={{
                        marginTop:8, marginLeft:40, width:88, height:64, borderRadius:8, overflow:'hidden',
                        cursor:'zoom-in', border:'0.5px solid rgba(255,255,255,0.12)',
                        position:'relative', background:'#f5f1e8'
                      }}>
                        <ReceiptThumb value={l.value} desc={l.desc} variant={l.photo} />
                        <div style={{ position:'absolute', bottom:3, right:4, width:14, height:14, borderRadius:7, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0"/><path d="M3 1h4v4M5 3l-4 4" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            <div style={{ marginTop:22, marginBottom:10 }}><Eyebrow>Participantes</Eyebrow></div>
            <div style={{ display:'flex', flexDirection:'column' }}>
              {split.participants.map((p,i) => (
                <div key={p.handle} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderTop:'0.5px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ width:36, height:36, borderRadius:18, background:'rgba(255,255,255,0.06)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:600, color:'#fff' }}>{p.name[0]}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:14.5, color:'#fff', display:'flex', alignItems:'center', gap:6 }}>
                      {p.name}
                      {p.status==='owner' && <span style={{ fontSize:9, padding:'2px 5px', border:'0.5px solid rgba(255,255,255,0.2)', borderRadius:3, color:'rgba(255,255,255,0.55)', letterSpacing:'0.1em' }}>VOCÊ</span>}
                      {p.isNew && <span style={{ fontSize:9, padding:'2px 6px', background:'rgba(91,206,201,0.15)', borderRadius:3, color:'#5BCEC9', letterSpacing:'0.08em', fontWeight:600 }}>NOVO</span>}
                    </div>
                    <div style={{ fontSize:11.5, color:'rgba(255,255,255,0.4)' }}>{p.handle}</div>
                  </div>
                  <div style={{ fontSize:11, color: p.status==='pending'?'#F59E0B':'#22C55E' }}>
                    {p.status==='pending'?'⏳ pendente':'✓ aceito'}
                    {p.status==='accepted' && isVar && <span style={{ marginLeft:6, color:'rgba(255,255,255,0.5)' }}>🔒 {myBlocked}</span>}
                  </div>
                </div>
              ))}
            </div>

            {split.status==='active' && (
              <div style={{ display:'flex', gap:8, marginTop:24 }}>
                <button style={ghostBtn2}>Reenviar link</button>
                <button style={ghostBtn2}>Estender prazo</button>
              </div>
            )}
          </>
        )}

        {closing && isVar && (
          <>
            <div style={{ fontSize:13, color:'rgba(255,255,255,0.55)', lineHeight:1.5, marginBottom:18 }}>
              Defina o valor final de cada participante. O excedente bloqueado será devolvido automaticamente.
              {launchTotal>0 && <span style={{ display:'block', marginTop:6, color:'rgba(91,206,201,0.85)' }}>R$ {launchTotal} já debitados via lançamentos.</span>}
            </div>

            <Eyebrow>Alocação final</Eyebrow>
            <div style={{ display:'flex', flexDirection:'column', marginTop:6 }}>
              {split.participants.map(p => (
                <div key={p.handle} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 0', borderTop:'0.5px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:14, color:'#fff' }}>{p.name}</div>
                    <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>Bloqueado: {myBlocked}</div>
                  </div>
                  <input type="number" value={allocations[p.handle]} onChange={(e)=> setAllocations(a => ({...a, [p.handle]: e.target.value}))} style={{
                    width:80, textAlign:'right', background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.1)',
                    borderRadius:8, padding:'8px 10px', color:'#fff', fontSize:14, fontFamily:'inherit', outline:'none'
                  }} />
                </div>
              ))}
            </div>
            <div style={{ marginTop:18, padding:'14px 16px', background:'rgba(255,255,255,0.03)', borderRadius:12, border:'0.5px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'rgba(255,255,255,0.6)', marginBottom:6 }}>
                <span>Total alocado</span>
                <span style={{ color:'#fff', fontWeight:600 }}>{total} / {split.target}</span>
              </div>
              <div style={{ height:3, background:'rgba(255,255,255,0.08)', borderRadius:2, overflow:'hidden' }}>
                <div style={{ height:'100%', width: Math.min(100, total/split.target*100)+'%', background: total>split.target?'#EF4444':'#5BCEC9', transition:'width 0.2s' }} />
              </div>
              {total>split.target && <div style={{ fontSize:11, color:'#EF4444', marginTop:8 }}>Excede o teto em {total-split.target} Albers</div>}
            </div>
          </>
        )}
      </div>

      {split.status==='active' && (
        <div style={{ padding:'12px 24px 30px', background:'#000', borderTop:'0.5px solid rgba(255,255,255,0.06)' }}>
          {!closing ? (
            <PrimaryButton onClick={()=> isVar ? setClosing(true) : onPin('split')}>
              {isVar ? 'Fechar split variável' : 'Encerrar split'}
            </PrimaryButton>
          ) : (
            <PrimaryButton disabled={total>split.target} onClick={()=> onPin('split')}>Confirmar fechamento</PrimaryButton>
          )}
        </div>
      )}

      {/* Launch sheet */}
      {showLaunchSheet && (
        <LaunchItemSheet target={split.target} alreadyLaunched={launchTotal} participantCount={activeP.length}
          onClose={()=> setShowLaunchSheet(false)} onAdd={addLaunch} />
      )}

      {/* Photo lightbox */}
      {lightboxPhoto && (
        <div onClick={()=> setLightboxPhoto(null)} style={{
          position:'absolute', inset:0, zIndex:85, background:'rgba(0,0,0,0.92)',
          display:'flex', alignItems:'center', justifyContent:'center', padding:24, cursor:'zoom-out',
          animation:'pop 0.2s ease-out'
        }}>
          <button onClick={()=> setLightboxPhoto(null)} style={{ position:'absolute', top:54, right:24, width:36, height:36, borderRadius:18, background:'rgba(255,255,255,0.08)', border:'0.5px solid rgba(255,255,255,0.15)', color:'#fff', fontSize:14, cursor:'pointer' }}>✕</button>
          <div style={{ width:'100%', maxWidth:300, aspectRatio:'3/4', borderRadius:14, overflow:'hidden', border:'0.5px solid rgba(255,255,255,0.15)', background:'#f5f1e8' }}>
            <ReceiptThumb value={launches.find(l=>l.photo===lightboxPhoto)?.value} desc={launches.find(l=>l.photo===lightboxPhoto)?.desc} variant={lightboxPhoto} fullSize />
          </div>
        </div>
      )}
    </div>
  );
}

// Simulated receipt — variant determines content
function ReceiptThumb({ value=0, desc='', variant='captured', fullSize=false }) {
  const lines = React.useMemo(() => [50,58,66,74,82,90].map(() => 50 + Math.random()*40), [variant]);
  return (
    <svg viewBox="0 0 200 140" preserveAspectRatio={fullSize?"xMidYMid meet":"xMidYMid slice"} style={{ width:'100%', height:'100%' }}>
      <rect width="200" height="140" fill="#f5f1e8"/>
      <rect x="40" y="14" width="120" height="112" fill="#fff" stroke="#d4cdb8" strokeWidth="0.6"/>
      <text x="100" y="32" fontSize="9" fontWeight="600" fill="#222" textAnchor="middle" fontFamily="monospace">{(desc||'CONTA').toUpperCase().slice(0,18)}</text>
      <line x1="48" y1="42" x2="152" y2="42" stroke="#aaa" strokeDasharray="2 1" strokeWidth="0.4"/>
      {[50,58,66,74,82,90].map((y,i) => (
        <g key={i}>
          <rect x="50" y={y} width={lines[i]} height="2" fill="#333" opacity="0.6"/>
          <rect x={138} y={y} width="14" height="2" fill="#333" opacity="0.6"/>
        </g>
      ))}
      <line x1="48" y1="102" x2="152" y2="102" stroke="#222" strokeWidth="0.6"/>
      <text x="50" y="114" fontSize="8" fontWeight="700" fill="#000" fontFamily="monospace">TOTAL</text>
      <text x="150" y="114" fontSize="8" fontWeight="700" fill="#000" textAnchor="end" fontFamily="monospace">R$ {value||0}</text>
    </svg>
  );
}

// Launch item sheet — with optional photo capture
function LaunchItemSheet({ target, alreadyLaunched, participantCount, onClose, onAdd }) {
  const [desc, setDesc] = React.useState('');
  const [value, setValue] = React.useState('');
  const [photo, setPhoto] = React.useState(null);
  const [showCamera, setShowCamera] = React.useState(false);
  const v = parseFloat(value) || 0;
  const wouldExceed = alreadyLaunched + v > target;
  const perPerson = v ? (v/participantCount).toFixed(0) : 0;

  return (
    <>
      <Sheet open onClose={onClose}>
        <div style={{ fontSize:18, fontWeight:600, color:'#fff', marginBottom:6 }}>Lançar item</div>
        <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', marginBottom:18, lineHeight:1.5 }}>
          Será dividido igualmente entre os {participantCount} participantes e debitado em tempo real.
        </div>
        <div style={{ marginBottom:14 }}>
          <Eyebrow>Descrição</Eyebrow>
          <input value={desc} onChange={e=> setDesc(e.target.value)} autoFocus placeholder="Ex: Cerveja rodada 2"
            style={{ width:'100%', background:'transparent', border:'none', borderBottom:'0.5px solid rgba(255,255,255,0.18)', padding:'8px 0', marginTop:6, fontSize:16, color:'#fff', fontFamily:'inherit', outline:'none' }} />
        </div>
        <div style={{ marginBottom:14 }}>
          <Eyebrow>Valor total (R$)</Eyebrow>
          <div style={{ display:'flex', alignItems:'baseline', gap:6, marginTop:6 }}>
            <span style={{ fontSize:24, color:'rgba(255,255,255,0.45)' }}>R$</span>
            <input value={value} onChange={e=> setValue(e.target.value.replace(/[^\d.,]/g,''))} placeholder="0"
              style={{ flex:1, fontSize:32, fontWeight:700, color:wouldExceed?'#EF4444':'#fff', background:'transparent', border:'none', outline:'none', fontFamily:'inherit', letterSpacing:'-0.02em', padding:0 }} />
          </div>
        </div>

        {/* Foto opcional */}
        <div style={{ marginBottom:14 }}>
          <Eyebrow>Foto do comprovante (opcional)</Eyebrow>
          {photo ? (
            <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:64, height:48, borderRadius:8, overflow:'hidden', border:'0.5px solid rgba(255,255,255,0.15)', background:'#f5f1e8', flexShrink:0 }}>
                <ReceiptThumb value={v} desc={desc} variant={photo} />
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:11.5, color:'#5BCEC9', fontWeight:500 }}>📷 Foto capturada</div>
                <div style={{ fontSize:10.5, color:'rgba(255,255,255,0.4)', marginTop:1 }}>Visível para todos os participantes</div>
              </div>
              <button onClick={()=> setShowCamera(true)} style={{ background:'transparent', border:'0.5px solid rgba(255,255,255,0.15)', borderRadius:7, color:'rgba(255,255,255,0.75)', fontSize:11, padding:'6px 10px', cursor:'pointer', fontFamily:'inherit' }}>Substituir</button>
              <button onClick={()=> setPhoto(null)} style={{ background:'transparent', border:'none', color:'rgba(255,255,255,0.45)', fontSize:14, padding:'4px 6px', cursor:'pointer', fontFamily:'inherit' }}>×</button>
            </div>
          ) : (
            <button onClick={()=> setShowCamera(true)} style={{
              marginTop:8, width:'100%', padding:'10px 14px', background:'rgba(255,255,255,0.03)',
              border:'1px dashed rgba(255,255,255,0.18)', borderRadius:10,
              color:'rgba(255,255,255,0.7)', fontSize:12.5, fontFamily:'inherit', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8
            }}>
              <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                <rect x="2" y="4.5" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                <circle cx="9" cy="9.5" r="2.6" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M6 4.5l1-1.5h4l1 1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/>
              </svg>
              Adicionar foto
            </button>
          )}
        </div>

        {v>0 && (
          <div style={{ padding:'10px 14px', background:wouldExceed?'rgba(239,68,68,0.07)':'rgba(91,206,201,0.06)', border:`0.5px solid ${wouldExceed?'rgba(239,68,68,0.25)':'rgba(91,206,201,0.18)'}`, borderRadius:10, marginBottom:14 }}>
            {wouldExceed ? (
              <div style={{ fontSize:12, color:'#EF4444' }}>Excede o teto em R$ {(alreadyLaunched+v-target).toFixed(0)} — ajuste o valor</div>
            ) : (
              <div style={{ fontSize:12, color:'rgba(91,206,201,0.85)' }}>R$ {perPerson} por pessoa · Total da conta após: R$ {alreadyLaunched+v}/{target}</div>
            )}
          </div>
        )}
        <PrimaryButton disabled={!desc || !v || wouldExceed} onClick={()=> onAdd(desc, value, photo)}>Confirmar lançamento</PrimaryButton>
        <button onClick={onClose} style={{ width:'100%', marginTop:10, background:'transparent', border:'none', color:'rgba(255,255,255,0.5)', fontSize:13, padding:'10px 0', cursor:'pointer', fontFamily:'inherit' }}>Cancelar</button>
      </Sheet>

      {showCamera && (
        <PhotoCaptureSheet
          onClose={()=> setShowCamera(false)}
          onCapture={() => { setPhoto('cap_'+Date.now()); setShowCamera(false); }} />
      )}
    </>
  );
}

// Photo capture (simulated camera view)
function PhotoCaptureSheet({ onClose, onCapture }) {
  return (
    <div onClick={(e)=> e.target===e.currentTarget && onClose()} style={{
      position:'absolute', inset:0, background:'rgba(0,0,0,0.95)', zIndex:80, display:'flex', flexDirection:'column'
    }}>
      <div style={{ padding:'54px 24px 0', display:'flex', justifyContent:'space-between' }}>
        <button onClick={onClose} style={{ background:'rgba(255,255,255,0.08)', border:'none', color:'#fff', fontSize:13, padding:'8px 14px', borderRadius:18, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
        <div style={{ fontSize:11, color:'rgba(255,255,255,0.55)', letterSpacing:'0.14em', alignSelf:'center' }}>FOTO DA CONTA</div>
        <div style={{ width:30 }} />
      </div>
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:24, position:'relative' }}>
        {/* Simulated camera viewfinder */}
        <div style={{ width:'100%', maxWidth:280, aspectRatio:'3/4', borderRadius:18, background:'linear-gradient(160deg, #1a1a1a, #050505)', position:'relative', overflow:'hidden', border:'0.5px solid rgba(255,255,255,0.1)' }}>
          {/* Corner marks */}
          {[['0','0'],['100%','0'],['0','100%'],['100%','100%']].map((pos,i) => (
            <div key={i} style={{
              position:'absolute', width:24, height:24,
              left: i%2 ? 'auto':16, right: i%2?16:'auto',
              top: i<2 ? 16:'auto', bottom: i<2?'auto':16,
              borderTop: i<2?'2px solid #5BCEC9':'none',
              borderBottom: i>=2?'2px solid #5BCEC9':'none',
              borderLeft: i%2===0?'2px solid #5BCEC9':'none',
              borderRight: i%2===1?'2px solid #5BCEC9':'none',
            }} />
          ))}
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:6, opacity:0.45 }}>
            <svg width="42" height="42" viewBox="0 0 42 42" fill="none">
              <rect x="6" y="11" width="30" height="22" rx="3" stroke="#fff" strokeWidth="1.4"/>
              <circle cx="21" cy="22" r="6" stroke="#fff" strokeWidth="1.4"/>
              <path d="M14 11l2.5-3.5h9L28 11" stroke="#fff" strokeWidth="1.4" fill="none"/>
            </svg>
            <div style={{ fontSize:11.5, color:'#fff' }}>Aponte para a conta</div>
          </div>
        </div>
      </div>
      <div style={{ padding:'0 24px 36px', display:'flex', justifyContent:'center' }}>
        <button onClick={onCapture} style={{
          width:72, height:72, borderRadius:36, background:'transparent',
          border:'3px solid rgba(255,255,255,0.85)', cursor:'pointer', padding:5
        }}>
          <div style={{ width:'100%', height:'100%', borderRadius:'50%', background:'#fff' }} />
        </button>
      </div>
      <div style={{ position:'absolute', top:'50%', left:0, right:0, textAlign:'center', fontSize:10.5, color:'rgba(255,255,255,0.45)', letterSpacing:'0.1em', pointerEvents:'none' }}>
        SOMENTE CÂMERA · GALERIA INDISPONÍVEL
      </div>
    </div>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div style={{ flex:1, padding:'14px 14px', background:'rgba(255,255,255,0.03)', border:'0.5px solid rgba(255,255,255,0.08)', borderRadius:12 }}>
      <div style={{ fontSize:9.5, color:'rgba(255,255,255,0.4)', letterSpacing:'0.14em' }}>{label}</div>
      <div style={{ marginTop:4, display:'flex', alignItems:'baseline', gap:5 }}>
        <span style={{ fontSize:22, fontWeight:700, color:'#fff', letterSpacing:'-0.02em' }}>{value}</span>
        <span style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{unit}</span>
      </div>
    </div>
  );
}

const ghostBtn2 = {
  flex:1, padding:'12px 0', background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.09)',
  borderRadius:10, color:'rgba(255,255,255,0.85)', fontSize:12.5, fontWeight:500, fontFamily:'inherit', cursor:'pointer'
};

// Split create wizard
function SplitCreateScreen({ onClose, onDone }) {
  const [step, setStep] = React.useState(1);
  const [data, setData] = React.useState({ name:'', type:'fixo', total:'', count:4, target:'', validity:'24h' });

  const update = (k,v) => setData(d => ({...d, [k]:v}));
  const perPerson = data.total && data.count ? (parseFloat(data.total)/data.count).toFixed(0) : 0;
  const blockPer = data.target && data.count ? (parseFloat(data.target)/data.count).toFixed(0) : 0;

  if (step===1) return (
    <FlowShell title="Novo Split" subtitle="Etapa 1 de 3" onClose={onClose}>
      <Eyebrow>Nome do split</Eyebrow>
      <input value={data.name} onChange={(e)=> update('name', e.target.value)} placeholder="Ex: Jantar de domingo" autoFocus style={inputStyle} />

      <div style={{ marginTop:28 }}>
        <Eyebrow>Tipo</Eyebrow>
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:12 }}>
          {[
            { id:'fixo', t:'Split Fixo', d:'Valor total dividido em partes iguais. Cobrado na adesão.' },
            { id:'variavel', t:'Split Variável', d:'Teto reservado de cada participante. Você define o valor final ao fechar.' },
          ].map(o => (
            <div key={o.id} onClick={()=> update('type', o.id)} style={{
              padding:'14px 16px', borderRadius:12, cursor:'pointer',
              background: data.type===o.id ? 'rgba(255,255,255,0.07)':'rgba(255,255,255,0.02)',
              border: `0.5px solid ${data.type===o.id?'rgba(255,255,255,0.3)':'rgba(255,255,255,0.08)'}`
            }}>
              <div style={{ fontSize:14.5, fontWeight:600, color:'#fff', marginBottom:3 }}>{o.t}</div>
              <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', lineHeight:1.4 }}>{o.d}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex:1 }} />
      <PrimaryButton disabled={!data.name} onClick={()=> setStep(2)}>Continuar</PrimaryButton>
    </FlowShell>
  );

  if (step===2) return (
    <FlowShell title="Novo Split" subtitle="Etapa 2 de 3" onClose={()=>setStep(1)} back>
      <Eyebrow>{data.type==='fixo' ? 'Valor total do split' : 'Valor alvo (teto)'}</Eyebrow>
      <div style={{ display:'flex', alignItems:'baseline', gap:6, marginTop:10, marginBottom:18 }}>
        <input value={data.type==='fixo'?data.total:data.target}
          onChange={(e)=> update(data.type==='fixo'?'total':'target', e.target.value.replace(/[^\d]/g,''))} autoFocus
          placeholder="0"
          style={{ flex:1, fontSize:42, fontWeight:700, color:'#fff', background:'transparent', border:'none', outline:'none', fontFamily:'inherit', letterSpacing:'-0.04em', padding:0, minWidth:0 }} />
        <span style={{ fontSize:15, color:'rgba(255,255,255,0.45)' }}>Albers</span>
      </div>

      <Eyebrow>Pessoas (incluindo você)</Eyebrow>
      <div style={{ display:'flex', alignItems:'center', gap:14, marginTop:12 }}>
        <button onClick={()=> update('count', Math.max(2, data.count-1))} style={stepBtn}>−</button>
        <div style={{ flex:1, textAlign:'center', fontSize:24, fontWeight:600, color:'#fff', fontVariantNumeric:'tabular-nums' }}>{data.count}</div>
        <button onClick={()=> update('count', data.count+1)} style={stepBtn}>+</button>
      </div>

      <div style={{ marginTop:24, padding:'14px 16px', background:'rgba(91,206,201,0.06)', border:'0.5px solid rgba(91,206,201,0.18)', borderRadius:10 }}>
        <div style={{ fontSize:11, color:'rgba(91,206,201,0.7)', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:4 }}>
          {data.type==='fixo' ? 'Cada um paga' : 'Cada um terá bloqueado'}
        </div>
        <div style={{ fontSize:24, fontWeight:700, color:'#5BCEC9', letterSpacing:'-0.02em' }}>
          {data.type==='fixo' ? perPerson : blockPer} <span style={{ fontSize:13, color:'rgba(91,206,201,0.6)', fontWeight:400 }}>Albers</span>
        </div>
      </div>

      <div style={{ flex:1 }} />
      <PrimaryButton disabled={!(data.type==='fixo'?data.total:data.target)} onClick={()=>setStep(3)}>Continuar</PrimaryButton>
    </FlowShell>
  );

  if (step===3) return (
    <FlowShell title="Validade do link" subtitle="Etapa 3 de 3" onClose={()=>setStep(2)} back>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {[{id:'1h',l:'1 hora'},{id:'24h',l:'24 horas'},{id:'7d',l:'7 dias'},{id:'custom',l:'Personalizado'}].map(o => (
          <div key={o.id} onClick={()=> update('validity', o.id)} style={{
            padding:'16px 18px', borderRadius:12, cursor:'pointer', display:'flex', alignItems:'center', gap:12,
            background: data.validity===o.id ? 'rgba(255,255,255,0.07)':'rgba(255,255,255,0.02)',
            border: `0.5px solid ${data.validity===o.id?'rgba(255,255,255,0.25)':'rgba(255,255,255,0.08)'}`
          }}>
            <div style={{ width:18, height:18, borderRadius:9, border:'1.3px solid rgba(255,255,255,0.4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              {data.validity===o.id && <div style={{ width:9, height:9, borderRadius:5, background:'#fff' }} />}
            </div>
            <div style={{ fontSize:14.5, color:'#fff' }}>{o.l}</div>
          </div>
        ))}
      </div>

      <div style={{ flex:1 }} />
      <PrimaryButton onClick={()=> setStep('share')}>Criar Split</PrimaryButton>
    </FlowShell>
  );

  if (step==='share') return (
    <FlowShell title="Compartilhar Split" subtitle={data.name} onClose={onClose}>
      <div style={{ marginTop:14, padding:'18px', background:'rgba(91,206,201,0.06)', border:'0.5px solid rgba(91,206,201,0.18)', borderRadius:12, textAlign:'center' }}>
        <div style={{ fontSize:11, color:'rgba(91,206,201,0.7)', letterSpacing:'0.1em', marginBottom:6 }}>SPLIT CRIADO</div>
        <div style={{ fontSize:18, fontWeight:600, color:'#fff' }}>{data.name}</div>
        <div style={{ fontSize:13, color:'rgba(255,255,255,0.55)', marginTop:6 }}>
          {data.type==='fixo' ? `${perPerson} Albers cada · ${data.count} pessoas` : `Até ${blockPer} Albers cada · ${data.count} pessoas`}
        </div>
      </div>

      <div style={{ marginTop:24, padding:'14px', background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.09)', borderRadius:12 }}>
        <div style={{ fontSize:10.5, color:'rgba(255,255,255,0.4)', letterSpacing:'0.14em', marginBottom:6 }}>LINK DO CONVITE</div>
        <div style={{ fontSize:12.5, color:'#fff', fontFamily:'ui-monospace, SFMono-Regular, monospace', wordBreak:'break-all' }}>alber://split/convite/x7p2k9mq</div>
      </div>

      <div style={{ display:'flex', gap:8, marginTop:14 }}>
        <button style={ghostBtn2}>Copiar</button>
        <button style={ghostBtn2}>Compartilhar</button>
      </div>

      <div style={{ marginTop:24 }}><Eyebrow>Contatos no Alber</Eyebrow></div>
      <div style={{ display:'flex', gap:14, marginTop:12, overflowX:'auto', paddingBottom:8 }}>
        {[{n:'João S.', h:'@joaosilva'},{n:'Ana C.', h:'@ana_costa'},{n:'Pedro', h:'@phenrique'},{n:'Cami', h:'@cami'}].map((c,i) => (
          <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, minWidth:54 }}>
            <div style={{ width:48, height:48, borderRadius:24, background:`hsl(${(c.h.charCodeAt(1)*23)%360}, 18%, 22%)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:600, color:'#fff' }}>{c.n[0]}</div>
            <div style={{ fontSize:10.5, color:'rgba(255,255,255,0.7)', textAlign:'center', whiteSpace:'nowrap' }}>{c.n}</div>
          </div>
        ))}
      </div>

      <div style={{ flex:1 }} />
      <PrimaryButton onClick={onDone}>Concluir</PrimaryButton>
    </FlowShell>
  );
}

const inputStyle = {
  width:'100%', background:'transparent', border:'none', borderBottom:'0.5px solid rgba(255,255,255,0.18)',
  padding:'10px 0', marginTop:8, fontSize:18, color:'#fff', fontFamily:'inherit', outline:'none'
};

const stepBtn = {
  width:46, height:46, borderRadius:23, background:'rgba(255,255,255,0.06)', border:'0.5px solid rgba(255,255,255,0.1)',
  color:'#fff', fontSize:20, fontFamily:'inherit', cursor:'pointer'
};

Object.assign(window, { SplitListScreen, SplitDetailScreen, SplitCreateScreen, MOCK_SPLITS });
