// Lounges, Atividade, Perfil, Achar (internal: SPACES_LIST kept stable for compat)
const SPACES_LIST = [
  { id:'surf', name:'Surf Club', members:1240, role:'membro', accent:'#5BCEC9', bg:'linear-gradient(135deg, #06181f, #0a2a30)', desc:'Comunidade de surfistas. Eventos mensais, swap de pranchas e trips.' },
  { id:'nomads', name:'Nomads Club', members:840, role:'membro', accent:'#C9B06A', bg:'linear-gradient(135deg, #13120a, #2a2510)' },
  { id:'gourmet', name:'Gourmet Club', members:312, role:'dono', accent:'#E07D7D', bg:'linear-gradient(135deg, #120808, #2a1010)' },
  { id:'tech', name:'Tech Builders', members:560, role:'membro', accent:'#7DA3E0', bg:'linear-gradient(135deg, #080a14, #101830)' },
];

const EXPLORE = [
  { id:'arte', name:'Arte Contemporânea SP', members:489, accent:'#B58FE0', bg:'linear-gradient(135deg, #1a0d24, #2a1840)' },
  { id:'corredores', name:'Corredores RJ', members:2150, accent:'#E0B05B', bg:'linear-gradient(135deg, #1a1408, #2a2010)' },
  { id:'cinema', name:'Cinema Clube', members:178, accent:'#7DC0E0', bg:'linear-gradient(135deg, #08141a, #102530)' },
];

// Sort: dono always first, then membros
function sortedMineSpaces() {
  return [...SPACES_LIST].sort((a,b) => {
    if (a.role==='dono' && b.role!=='dono') return -1;
    if (a.role!=='dono' && b.role==='dono') return 1;
    return 0;
  });
}

function SpacesScreen({ onBack, onOpen, onCreate, hasActiveLounge }) {
  const [tab, setTab] = React.useState('mine');
  const mineList = React.useMemo(() => sortedMineSpaces(), []);
  // user already owns Gourmet Club → considered "has active lounge"
  const userHasLounge = hasActiveLounge ?? mineList.some(s => s.role === 'dono');
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:50, display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <TopBar title="Lounges" onBack={onBack} />
      <div style={{ display:'flex', gap:6, margin:'8px 24px 16px', padding:3, background:'rgba(255,255,255,0.04)', borderRadius:10 }}>
        {[['mine','Meus Lounges'],['explore','Explorar']].map(([k,l]) => (
          <button key={k} onClick={()=>setTab(k)} style={{
            flex:1, padding:'10px 0', border:'none', cursor:'pointer',
            background: tab===k?'rgba(255,255,255,0.08)':'transparent',
            borderRadius:8, color:'#fff', fontSize:13, fontWeight:500, fontFamily:'inherit',
            opacity: tab===k?1:0.55
          }}>{l}</button>
        ))}
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'0 24px 96px' }}>
        {tab==='mine' && (
          <CreateLoungeButton disabled={userHasLounge} onClick={onCreate} />
        )}
        {(tab==='mine' ? mineList : EXPLORE).map(s => {
          const isDono = s.role==='dono';
          return (
            <div key={s.id} onClick={()=> onOpen(s.id)} style={{
              position:'relative', height:isDono?136:116, marginBottom:12, borderRadius:14,
              overflow:'hidden', background: s.bg, cursor:'pointer',
              border: isDono ? `1px solid ${s.accent}55` : '0.5px solid rgba(255,255,255,0.08)',
              boxShadow: isDono ? `0 0 16px ${s.accent}18` : 'none',
            }}>
              {/* Subtle accent glow for dono */}
              {isDono && <div style={{ position:'absolute', inset:0, background:`radial-gradient(ellipse at 80% 20%, ${s.accent}18 0%, transparent 60%)` }} />}
              <div style={{ position:'absolute', inset:0, padding:'16px 20px', display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <div style={{ width:8, height:8, borderRadius:4, background:s.accent }} />
                  {s.role && (
                    <div style={{
                      fontSize:9, letterSpacing:'0.14em', padding:'2px 7px', borderRadius:3,
                      background: isDono ? `${s.accent}22` : 'rgba(255,255,255,0.08)',
                      border: isDono ? `0.5px solid ${s.accent}55` : 'none',
                      color: isDono ? s.accent : 'rgba(255,255,255,0.7)',
                    }}>{s.role.toUpperCase()}</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: isDono?22:20, fontWeight:700, color:'#fff', letterSpacing:'-0.02em' }}>{s.name}</div>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.55)', marginTop:3 }}>{s.members} membros</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SURF_EVENTS = [
  { name:'Sunset Session — Itacoatiara', date:'Sáb, 5 mai · 17h', priceR:0, priceA:0 },
  { name:'Workshop: Leitura de ondas', date:'Qui, 10 mai · 19h', priceR:50, priceA:120 },
  { name:'Trip — Saquarema 3 dias', date:'15-17 mai', priceR:680, priceA:1640 },
];

const SPACE_EVENTS = {
  surf: [
    { id:'surf-1', name:'Sunset Session — Itacoatiara', date:'Sáb, 5 mai · 17h', tipo:'gratuito', visibility:'membros', capacidade:40, confirmados:23, recorrente:'mensal' },
    { id:'surf-2', name:'Workshop: Leitura de ondas', date:'Qui, 10 mai · 19h', tipo:'pago', visibility:'todos', capacidade:30, confirmados:18,
      lotes:[
        { name:'1º Lote', priceR:50, priceA:120, qty:10, sold:10, until:'30/abr' },
        { name:'2º Lote', priceR:75, priceA:180, qty:15, sold:8, until:'8/mai' },
        { name:'3º Lote', priceR:100, priceA:240, qty:5, sold:0, until:'10/mai' },
      ] },
    { id:'surf-3', name:'Trip — Saquarema 3 dias', date:'15–17 mai', tipo:'pago', visibility:'membros', capacidade:12, confirmados:7,
      lotes:[
        { name:'Antecipado', priceR:680, priceA:1640, qty:8, sold:7, until:'6/mai' },
        { name:'Normal', priceR:850, priceA:2050, qty:4, sold:0, until:'14/mai' },
      ] },
  ],
  gourmet: [
    { id:'gou-1', name:'Jantar Harmonização — Villa Nova', date:'Sex, 9 mai · 20h', tipo:'pago', visibility:'membros', capacidade:24, confirmados:18,
      lotes:[
        { name:'1º Lote', priceR:220, priceA:530, qty:12, sold:12, until:'1/mai' },
        { name:'2º Lote', priceR:280, priceA:670, qty:12, sold:6, until:'8/mai' },
      ] },
    { id:'gou-2', name:'Visita à Vinícola Miolo', date:'Dom, 11 mai', tipo:'gratuito', visibility:'todos', capacidade:50, confirmados:31, recorrente:null },
    { id:'gou-3', name:'Degustação às Cegas (mensal)', date:'1ª sex de cada mês · 19h', tipo:'pago', visibility:'membros', capacidade:16, confirmados:10, recorrente:'mensal',
      lotes:[ { name:'Único', priceR:180, priceA:430, qty:16, sold:10, until:'4/mai' } ] },
  ],
  nomads: [
    { id:'nom-1', name:'Meetup Nômades SP', date:'Qua, 7 mai · 19h', tipo:'gratuito', visibility:'todos', capacidade:80, confirmados:42 },
  ],
  tech: [
    { id:'tec-1', name:'Hackathon IA — 48h', date:'17–18 mai', tipo:'gratuito', visibility:'membros', capacidade:60, confirmados:28 },
    { id:'tec-2', name:'Talk: React Native na prática', date:'Ter, 6 mai · 19h', tipo:'gratuito', visibility:'todos', capacidade:120, confirmados:67, recorrente:'semanal' },
  ],
};

// Find the active lote (first one with sold < qty and within date)
function activeLote(ev) {
  if (!ev.lotes) return null;
  return ev.lotes.find(l => l.sold < l.qty) || ev.lotes[ev.lotes.length-1];
}

// Display price for an event card (active lote price or 'Gratuito')
function eventDisplayPrice(ev) {
  if (ev.tipo === 'gratuito') return { label:'Gratuito', isFree:true };
  const lote = activeLote(ev);
  return { label: `${lote.priceA} A`, isFree:false, lote };
}

const SPACE_MSGS = {
  surf: { author:'Felipe (gestor)', time:'ontem', text:'Galera, ondas chegando esse final de semana. Pico previsto sábado de manhã. Quem topa?' },
  gourmet: { author:'você (dono)', time:'3 dias', text:'Ingressos do jantar de harmonização com 15% off para membros até quinta. Só 6 vagas!' },
  nomads: { author:'Carol (gestora)', time:'2 dias', text:'Meetup confirmado! Vamos no Bar do Nômade às 19h. Confirme presença aqui.' },
  tech: { author:'Rodrigo (gestor)', time:'1 dia', text:'Repositório do hackathon já está aberto. Formem equipes de 3–4 pessoas até sexta.' },
};

function SpaceDetailScreen({ id, onBack, onSetActive, onCustomize, onBuyTicket, onCreateEvent, onManageEvent }) {
  const sp = SPACES_LIST.find(s => s.id===id) || EXPLORE.find(s => s.id===id);
  if (!sp) return null;
  const isOwner = sp.role==='dono';
  const isManager = sp.role==='dono' || sp.role==='gestor';
  const events = SPACE_EVENTS[id] || [];
  const msg = SPACE_MSGS[id];

  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:50, display:'flex', flexDirection:'column' }}>
      {/* Hero header */}
      <div style={{ position:'relative', height:230, background: sp.bg, flexShrink:0 }}>
        {isOwner && <div style={{ position:'absolute', inset:0, background:`radial-gradient(ellipse at 80% 20%, ${sp.accent}22 0%, transparent 60%)` }} />}
        <StatusBar />
        <button onClick={onBack} style={{ position:'absolute', top:54, left:20, background:'rgba(0,0,0,0.4)', backdropFilter:'blur(10px)', border:'0.5px solid rgba(255,255,255,0.15)', borderRadius:18, width:36, height:36, color:'#fff', fontSize:14, cursor:'pointer' }}>‹</button>
        <div style={{ position:'absolute', bottom:18, left:24, right:24 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:7 }}>
            <div style={{ width:8, height:8, borderRadius:4, background:sp.accent }} />
            {sp.role && (
              <div style={{
                fontSize:9, letterSpacing:'0.14em', padding:'2px 7px', borderRadius:3,
                background: isOwner ? `${sp.accent}22` : 'rgba(0,0,0,0.4)',
                border: isOwner ? `0.5px solid ${sp.accent}55` : '0.5px solid rgba(255,255,255,0.18)',
                color: isOwner ? sp.accent : 'rgba(255,255,255,0.85)',
              }}>{sp.role.toUpperCase()}</div>
            )}
          </div>
          <div style={{ fontSize:27, fontWeight:700, color:'#fff', letterSpacing:'-0.02em' }}>{sp.name}</div>
          <div style={{ fontSize:12.5, color:'rgba(255,255,255,0.6)', marginTop:4 }}>{sp.members} membros</div>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 24px 40px' }}>
        {sp.desc && <div style={{ fontSize:13.5, color:'rgba(255,255,255,0.65)', lineHeight:1.55, marginBottom:20 }}>{sp.desc}</div>}

        {/* CTA row */}
        <div style={{ display:'flex', gap:8, marginBottom:28 }}>
          <button onClick={onSetActive} style={{ flex:2, padding:'12px 0', background:'#fff', color:'#000', border:'none', borderRadius:10, fontSize:12.5, fontWeight:600, fontFamily:'inherit', cursor:'pointer', letterSpacing:'0.03em' }}>Definir como ativo</button>
          {isOwner && <button onClick={onCustomize} style={{ flex:1, padding:'12px 0', background:'rgba(255,255,255,0.06)', color:'#fff', border:'0.5px solid rgba(255,255,255,0.12)', borderRadius:10, fontSize:12.5, fontWeight:500, fontFamily:'inherit', cursor:'pointer' }}>Personalizar</button>}
        </div>

        {/* Events */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <Eyebrow>Eventos</Eyebrow>
          {isManager && (
            <button onClick={onCreateEvent} style={{
              display:'flex', alignItems:'center', gap:5, background:'transparent', border:'none',
              color: sp.accent, fontSize:11.5, fontWeight:600, fontFamily:'inherit', cursor:'pointer', letterSpacing:'0.04em'
            }}>+ Criar evento</button>
          )}
        </div>

        {events.length === 0 ? (
          <div style={{ padding:'20px 0', fontSize:13, color:'rgba(255,255,255,0.35)', textAlign:'center' }}>
            Nenhum evento agendado ainda
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:28 }}>
            {events.map((e) => <EventCard key={e.id} ev={e} accent={sp.accent} isManager={isManager}
              onClick={()=> {
                if (isManager) onManageEvent && onManageEvent(e);
                else if (e.tipo!=='gratuito') onBuyTicket(e);
              }} />)}
          </div>
        )}

        {/* Lounge messages */}
        {msg && (
          <>
            <Eyebrow>Mensagens do Lounge</Eyebrow>
            <div style={{ marginTop:12, padding:'14px 16px', background:`${sp.accent}08`, border:`0.5px solid ${sp.accent}25`, borderRadius:12 }}>
              <div style={{ fontSize:11, color:`${sp.accent}99`, marginBottom:5 }}>{msg.author} · {msg.time}</div>
              <div style={{ fontSize:13.5, color:'rgba(255,255,255,0.85)', lineHeight:1.5 }}>{msg.text}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EventCard({ ev, accent, isManager, onClick }) {
  const price = eventDisplayPrice(ev);
  const lotaPct = ev.capacidade ? Math.round((ev.confirmados / ev.capacidade) * 100) : 0;
  const lotado = ev.capacidade && ev.confirmados >= ev.capacidade;
  return (
    <div onClick={onClick} style={{
      padding:'14px 16px', background:'rgba(255,255,255,0.03)',
      border:`0.5px solid ${price.isFree?'rgba(255,255,255,0.08)':'rgba(255,255,255,0.12)'}`,
      borderRadius:12, cursor:'pointer'
    }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8, marginBottom:6 }}>
        <div style={{ fontSize:14.5, fontWeight:600, color:'#fff', flex:1 }}>{ev.name}</div>
        <span style={{ fontSize:13, fontWeight:600, color: price.isFree?accent:'#fff', whiteSpace:'nowrap' }}>{price.label}</span>
      </div>
      {price.lote && (
        <div style={{ fontSize:10.5, color:accent, letterSpacing:'0.04em', marginBottom:5, fontWeight:500 }}>
          {price.lote.name} · até {price.lote.until} · {price.lote.qty - price.lote.sold} restantes
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:11.5, color:'rgba(255,255,255,0.45)' }}>{ev.date}</span>
        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', justifyContent:'flex-end' }}>
          {ev.recorrente && (
            <span style={{ fontSize:9, color:accent, letterSpacing:'0.08em', border:`0.5px solid ${accent}55`, borderRadius:3, padding:'1px 5px', textTransform:'uppercase' }}>{ev.recorrente}</span>
          )}
          {lotado && <span style={{ fontSize:9, color:'#EF4444', letterSpacing:'0.08em', border:'0.5px solid #EF444455', borderRadius:3, padding:'1px 5px' }}>LOTADO</span>}
          <span style={{ fontSize:9.5, color:'rgba(255,255,255,0.35)', letterSpacing:'0.08em', border:'0.5px solid rgba(255,255,255,0.15)', borderRadius:3, padding:'1px 5px' }}>{ev.visibility}</span>
        </div>
      </div>
      {ev.capacidade && (
        <div style={{ marginTop:8, height:2, background:'rgba(255,255,255,0.06)', borderRadius:1, overflow:'hidden' }}>
          <div style={{ width:`${Math.min(lotaPct,100)}%`, height:'100%', background: lotado?'#EF4444':accent, transition:'width 0.3s' }} />
        </div>
      )}
      {ev.capacidade && (
        <div style={{ marginTop:5, fontSize:10, color:'rgba(255,255,255,0.4)' }}>{ev.confirmados}/{ev.capacidade} confirmados</div>
      )}
      {isManager && (
        <div style={{ marginTop:8, fontSize:10, color:accent, letterSpacing:'0.08em', fontWeight:600 }}>GERENCIAR ›</div>
      )}
    </div>
  );
}

// ─────────── EVENT MANAGEMENT (dono/gestor) ──────────────
function EventManageScreen({ event, accent, onBack, onCancel, onEdit }) {
  const [tab, setTab] = React.useState('overview');
  const [showCancel, setShowCancel] = React.useState(false);

  const CONFIRMADOS = [
    { name:'Ana Lima', handle:'@analima', lote:event.lotes?.[0]?.name, when:'há 2 dias' },
    { name:'João Pedro', handle:'@joaopedro', lote:event.lotes?.[0]?.name, when:'há 3 dias' },
    { name:'Carlos Mendes', handle:'@carlos', lote:event.lotes?.[1]?.name, when:'ontem' },
    { name:'Marina S.', handle:'@marinas', lote:event.lotes?.[1]?.name, when:'ontem' },
    { name:'Felipe R.', handle:'@feliper', lote:event.lotes?.[1]?.name, when:'há 4 horas' },
    { name:'Lucas A.', handle:'@lucas_a', lote:event.lotes?.[1]?.name, when:'há 1 hora' },
  ];

  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:55, display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <TopBar title={event.name} onBack={onBack} contextLabel="GERENCIAR EVENTO" />
      <div style={{ display:'flex', gap:6, margin:'8px 24px 16px', padding:3, background:'rgba(255,255,255,0.04)', borderRadius:10 }}>
        {[['overview','Visão geral'],['confirmados',`Confirmados (${event.confirmados})`]].map(([k,l]) => (
          <button key={k} onClick={()=>setTab(k)} style={{
            flex:1, padding:'9px 0', border:'none', cursor:'pointer',
            background: tab===k?'rgba(255,255,255,0.08)':'transparent',
            borderRadius:8, color:'#fff', fontSize:12, fontWeight:500, fontFamily:'inherit',
            opacity: tab===k?1:0.55
          }}>{l}</button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'0 24px 36px' }}>
        {tab==='overview' && (
          <>
            {/* Stats */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:20 }}>
              <div style={{ padding:'14px', background:`${accent}10`, border:`0.5px solid ${accent}30`, borderRadius:12 }}>
                <div style={{ fontSize:10, color:`${accent}aa`, letterSpacing:'0.1em', marginBottom:4 }}>CONFIRMADOS</div>
                <div style={{ fontSize:24, fontWeight:700, color:'#fff' }}>{event.confirmados}<span style={{ fontSize:13, color:'rgba(255,255,255,0.4)', fontWeight:400 }}>/{event.capacidade}</span></div>
              </div>
              <div style={{ padding:'14px', background:'rgba(255,255,255,0.03)', border:'0.5px solid rgba(255,255,255,0.08)', borderRadius:12 }}>
                <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'0.1em', marginBottom:4 }}>ARRECADADO</div>
                <div style={{ fontSize:24, fontWeight:700, color:'#fff' }}>
                  {event.lotes ? event.lotes.reduce((s,l)=> s + l.priceA*l.sold, 0) : 0}
                  <span style={{ fontSize:13, color:'rgba(255,255,255,0.4)', fontWeight:400 }}> A</span>
                </div>
              </div>
            </div>

            {event.lotes && (
              <>
                <Eyebrow>Lotes</Eyebrow>
                <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:10, marginBottom:24 }}>
                  {event.lotes.map((l,i) => {
                    const isActive = activeLote(event) === l;
                    const sold = l.sold >= l.qty;
                    return (
                      <div key={i} style={{
                        padding:'12px 14px', background:'rgba(255,255,255,0.03)',
                        border:`0.5px solid ${isActive?accent+'55':'rgba(255,255,255,0.08)'}`,
                        borderRadius:10, opacity: sold?0.55:1
                      }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <span style={{ fontSize:13, fontWeight:600, color:'#fff' }}>{l.name}</span>
                            {isActive && <span style={{ fontSize:9, color:accent, letterSpacing:'0.08em', fontWeight:600 }}>ATIVO</span>}
                            {sold && <span style={{ fontSize:9, color:'rgba(255,255,255,0.5)', letterSpacing:'0.08em', fontWeight:500 }}>ESGOTADO</span>}
                          </div>
                          <span style={{ fontSize:13, fontWeight:600, color:'#fff' }}>{l.priceA} A</span>
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'rgba(255,255,255,0.45)' }}>
                          <span>R$ {l.priceR} · até {l.until}</span>
                          <span>{l.sold}/{l.qty} vendidos</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <Eyebrow>Ações</Eyebrow>
            <div style={{ marginTop:8 }}>
              <ActionRow icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M14 3l3 3-9 9-4 1 1-4 9-9z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>}
                label="Editar evento" onClick={onEdit} />
              <ActionRow icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 6h14M8 9v6M12 9v6M5 6l1 11h8l1-11M8 6V3h4v3" stroke="currentColor" strokeWidth="1.3"/></svg>}
                label="Cancelar evento" sublabel="Reembolsa todos os ingressos pagos" accent="#EF4444" onClick={()=>setShowCancel(true)} />
            </div>
          </>
        )}

        {tab==='confirmados' && (
          <div style={{ marginTop:4 }}>
            {CONFIRMADOS.slice(0, event.confirmados).map((p,i) => (
              <div key={i} style={{
                display:'flex', alignItems:'center', gap:12, padding:'12px 0',
                borderTop: i===0?'none':'0.5px solid rgba(255,255,255,0.06)'
              }}>
                <div style={{ width:34, height:34, borderRadius:17, background:'rgba(255,255,255,0.06)',
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:600, color:'rgba(255,255,255,0.8)' }}>
                  {p.name.split(' ').map(s=>s[0]).slice(0,2).join('')}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13.5, color:'#fff' }}>{p.name}</div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{p.handle}{p.lote?` · ${p.lote}`:''}</div>
                </div>
                <span style={{ fontSize:10.5, color:'rgba(255,255,255,0.4)' }}>{p.when}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cancel confirmation */}
      <Sheet open={showCancel} onClose={()=>setShowCancel(false)}>
        <div style={{ fontSize:18, fontWeight:600, color:'#fff', marginBottom:8 }}>Cancelar evento?</div>
        <div style={{ fontSize:13, color:'rgba(255,255,255,0.6)', lineHeight:1.5, marginBottom:20 }}>
          Os <span style={{ color:'#fff', fontWeight:500 }}>{event.confirmados} participantes</span> serão notificados e
          os ingressos pagos serão reembolsados automaticamente em Albers. Esta ação não pode ser desfeita.
        </div>
        <PrimaryButton variant="destructive" onClick={()=>{ setShowCancel(false); onCancel && onCancel(); }}>
          Cancelar e reembolsar todos
        </PrimaryButton>
        <button onClick={()=>setShowCancel(false)} style={{
          width:'100%', marginTop:10, background:'transparent', border:'none', color:'rgba(255,255,255,0.55)',
          fontSize:13, padding:'12px 0', fontFamily:'inherit', cursor:'pointer'
        }}>Voltar</button>
      </Sheet>
    </div>
  );
}

function Chip({ children }) {
  return <span style={{ fontSize:10.5, color:'rgba(255,255,255,0.7)', background:'rgba(255,255,255,0.07)', borderRadius:4, padding:'2px 8px', letterSpacing:'0.04em' }}>{children}</span>;
}

// ─────────── CRIAR EVENTO ──────────────
function EventCreateScreen({ spaceId, onClose, onDone }) {
  const sp = SPACES_LIST.find(s => s.id===spaceId) || {};
  const [step, setStep] = React.useState(1);
  const [data, setData] = React.useState({
    name:'', desc:'', date:'', time:'',
    capacidade:'', recorrente:'nao', frequencia:'mensal',
    tipo:'gratuito',
    lotes:[{ name:'1º Lote', priceR:'', qty:'', until:'' }],
    visibility:'membros'
  });
  const upd = (k,v) => setData(d => ({...d, [k]:v}));
  const updLote = (i,k,v) => setData(d => ({ ...d, lotes: d.lotes.map((l,j)=> i===j?{...l,[k]:v}:l) }));
  const addLote = () => setData(d => ({ ...d, lotes:[...d.lotes, { name:`${d.lotes.length+1}º Lote`, priceR:'', qty:'', until:'' }] }));
  const removeLote = (i) => setData(d => ({ ...d, lotes: d.lotes.filter((_,j)=> j!==i) }));
  const totalCap = data.lotes.reduce((s,l)=> s + (parseInt(l.qty)||0), 0);

  // ETAPA 1
  if (step===1) return (
    <FlowShell title="Criar Evento" subtitle="Etapa 1 de 3" onClose={onClose}>
      <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
        <div>
          <Eyebrow>Nome do evento</Eyebrow>
          <input value={data.name} onChange={e=>upd('name',e.target.value)} autoFocus placeholder="Ex: Jantar de harmonização"
            style={{ width:'100%', background:'transparent', border:'none', borderBottom:'0.5px solid rgba(255,255,255,0.18)', padding:'10px 0', marginTop:8, fontSize:18, color:'#fff', fontFamily:'inherit', outline:'none' }} />
        </div>
        <div>
          <Eyebrow>Descrição</Eyebrow>
          <textarea value={data.desc} onChange={e=>upd('desc',e.target.value)} placeholder="Sobre o evento…"
            style={{ width:'100%', background:'rgba(255,255,255,0.03)', border:'0.5px solid rgba(255,255,255,0.12)', borderRadius:10, padding:'10px 12px', marginTop:8, fontSize:14, color:'#fff', fontFamily:'inherit', outline:'none', resize:'none', minHeight:64 }} />
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <div style={{ flex:1 }}>
            <Eyebrow>Data</Eyebrow>
            <input type="date" value={data.date} onChange={e=>upd('date',e.target.value)}
              style={{ width:'100%', background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.12)', borderRadius:8, padding:'10px', marginTop:8, fontSize:14, color:'#fff', fontFamily:'inherit', outline:'none', colorScheme:'dark' }} />
          </div>
          <div style={{ flex:1 }}>
            <Eyebrow>Horário</Eyebrow>
            <input type="time" value={data.time} onChange={e=>upd('time',e.target.value)}
              style={{ width:'100%', background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.12)', borderRadius:8, padding:'10px', marginTop:8, fontSize:14, color:'#fff', fontFamily:'inherit', outline:'none', colorScheme:'dark' }} />
          </div>
        </div>
        <div>
          <Eyebrow>Capacidade total</Eyebrow>
          <input type="number" value={data.capacidade} onChange={e=>upd('capacidade',e.target.value)} placeholder="Ex: 30 pessoas"
            style={{ width:'100%', background:'transparent', border:'none', borderBottom:'0.5px solid rgba(255,255,255,0.18)', padding:'10px 0', marginTop:8, fontSize:18, color:'#fff', fontFamily:'inherit', outline:'none' }} />
          <div style={{ marginTop:6, fontSize:11, color:'rgba(255,255,255,0.35)' }}>Limite máximo de participantes confirmados</div>
        </div>
        <div>
          <Eyebrow>Recorrência</Eyebrow>
          <div style={{ display:'flex', gap:8, marginTop:10 }}>
            {[{id:'nao',l:'Único'},{id:'sim',l:'Recorrente'}].map(o=>(
              <button key={o.id} onClick={()=>upd('recorrente',o.id)} style={{
                flex:1, padding:'11px 0', borderRadius:9, border:`0.5px solid ${data.recorrente===o.id?'rgba(255,255,255,0.28)':'rgba(255,255,255,0.08)'}`,
                background: data.recorrente===o.id?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.02)',
                color:'#fff', fontSize:12.5, fontWeight:500, fontFamily:'inherit', cursor:'pointer'
              }}>{o.l}</button>
            ))}
          </div>
          {data.recorrente==='sim' && (
            <div style={{ marginTop:10, display:'flex', gap:6 }}>
              {['semanal','quinzenal','mensal'].map(f => (
                <button key={f} onClick={()=>upd('frequencia',f)} style={{
                  flex:1, padding:'8px 0', borderRadius:7, border:`0.5px solid ${data.frequencia===f?(sp.accent||'#fff')+'66':'rgba(255,255,255,0.08)'}`,
                  background: data.frequencia===f?`${sp.accent||'#fff'}15`:'rgba(255,255,255,0.02)',
                  color: data.frequencia===f?(sp.accent||'#fff'):'rgba(255,255,255,0.7)', fontSize:11, fontWeight:500, fontFamily:'inherit', cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.06em'
                }}>{f}</button>
              ))}
            </div>
          )}
        </div>
        <div>
          <Eyebrow>Imagem do evento</Eyebrow>
          <div style={{ marginTop:10, padding:'16px', border:'1px dashed rgba(255,255,255,0.15)', borderRadius:12, textAlign:'center', color:'rgba(255,255,255,0.45)', fontSize:12, cursor:'pointer' }}>
            Toque para enviar · JPG/PNG até 4MB
          </div>
        </div>
      </div>
      <div style={{ flex:1, minHeight:24 }} />
      <PrimaryButton disabled={!data.name || !data.capacidade} onClick={()=>setStep(2)}>Continuar</PrimaryButton>
    </FlowShell>
  );

  // ETAPA 2
  if (step===2) return (
    <FlowShell title="Criar Evento" subtitle="Etapa 2 de 3" onClose={()=>setStep(1)} back>
      <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
        <div>
          <Eyebrow>Tipo</Eyebrow>
          <div style={{ display:'flex', gap:8, marginTop:10 }}>
            {[{id:'gratuito',t:'Gratuito'},{id:'pago',t:'Pago'}].map(o=>(
              <button key={o.id} onClick={()=>upd('tipo',o.id)} style={{
                flex:1, padding:'14px 0', borderRadius:10,
                background: data.tipo===o.id?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.02)',
                border:`0.5px solid ${data.tipo===o.id?'rgba(255,255,255,0.28)':'rgba(255,255,255,0.08)'}`,
                color:'#fff', fontSize:13, fontWeight:500, fontFamily:'inherit', cursor:'pointer'
              }}>{o.t}</button>
            ))}
          </div>
        </div>
        {data.tipo==='pago' && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <Eyebrow>Lotes de venda</Eyebrow>
              <span style={{ fontSize:10.5, color:'rgba(255,255,255,0.4)' }}>Total: {totalCap}/{data.capacidade||0}</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {data.lotes.map((l,i) => {
                const priceA = l.priceR ? Math.round(parseFloat(l.priceR)*2.4) : 0;
                return (
                  <div key={i} style={{ padding:'12px 14px', background:'rgba(255,255,255,0.03)', border:'0.5px solid rgba(255,255,255,0.1)', borderRadius:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                      <input value={l.name} onChange={e=>updLote(i,'name',e.target.value)}
                        style={{ background:'transparent', border:'none', color:'#fff', fontSize:13, fontWeight:600, fontFamily:'inherit', outline:'none', padding:0, flex:1 }} />
                      {data.lotes.length>1 && (
                        <button onClick={()=>removeLote(i)} style={{ background:'transparent', border:'none', color:'rgba(239,68,68,0.7)', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>Remover</button>
                      )}
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                      <div>
                        <div style={{ fontSize:9.5, color:'rgba(255,255,255,0.35)', letterSpacing:'0.1em', marginBottom:4 }}>R$</div>
                        <input type="number" value={l.priceR} onChange={e=>updLote(i,'priceR',e.target.value)} placeholder="0"
                          style={{ width:'100%', background:'rgba(0,0,0,0.3)', border:'0.5px solid rgba(255,255,255,0.08)', borderRadius:6, padding:'7px 8px', fontSize:13, color:'#fff', fontFamily:'inherit', outline:'none' }} />
                      </div>
                      <div>
                        <div style={{ fontSize:9.5, color:'rgba(255,255,255,0.35)', letterSpacing:'0.1em', marginBottom:4 }}>QUANTIDADE</div>
                        <input type="number" value={l.qty} onChange={e=>updLote(i,'qty',e.target.value)} placeholder="0"
                          style={{ width:'100%', background:'rgba(0,0,0,0.3)', border:'0.5px solid rgba(255,255,255,0.08)', borderRadius:6, padding:'7px 8px', fontSize:13, color:'#fff', fontFamily:'inherit', outline:'none' }} />
                      </div>
                    </div>
                    <div style={{ marginTop:8 }}>
                      <div style={{ fontSize:9.5, color:'rgba(255,255,255,0.35)', letterSpacing:'0.1em', marginBottom:4 }}>VENDA ATÉ</div>
                      <input type="date" value={l.until} onChange={e=>updLote(i,'until',e.target.value)}
                        style={{ width:'100%', background:'rgba(0,0,0,0.3)', border:'0.5px solid rgba(255,255,255,0.08)', borderRadius:6, padding:'7px 8px', fontSize:13, color:'#fff', fontFamily:'inherit', outline:'none', colorScheme:'dark' }} />
                    </div>
                    {priceA>0 && (
                      <div style={{ marginTop:8, fontSize:11, color:'rgba(255,255,255,0.5)' }}>
                        Equivale a <span style={{ color:'#fff', fontWeight:600 }}>{priceA} Albers</span> por ingresso
                      </div>
                    )}
                  </div>
                );
              })}
              <button onClick={addLote} style={{
                padding:'10px', background:'transparent', border:`0.5px dashed ${(sp.accent||'#fff')}55`, borderRadius:8,
                color:sp.accent||'#fff', fontSize:11.5, fontWeight:600, fontFamily:'inherit', cursor:'pointer', letterSpacing:'0.04em'
              }}>+ ADICIONAR LOTE</button>
            </div>
          </div>
        )}
        <div>
          <Eyebrow>Visibilidade</Eyebrow>
          <div style={{ display:'flex', gap:8, marginTop:10 }}>
            {[{id:'membros',l:'Só membros'},{id:'todos',l:'Aberto para todos'}].map(o=>(
              <button key={o.id} onClick={()=>upd('visibility',o.id)} style={{
                flex:1, padding:'11px 0', borderRadius:9, border:`0.5px solid ${data.visibility===o.id?'rgba(255,255,255,0.28)':'rgba(255,255,255,0.08)'}`,
                background: data.visibility===o.id?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.02)',
                color:'#fff', fontSize:12.5, fontWeight:500, fontFamily:'inherit', cursor:'pointer'
              }}>{o.l}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ flex:1, minHeight:20 }} />
      <PrimaryButton onClick={()=>setStep(3)}>Revisar</PrimaryButton>
    </FlowShell>
  );

  // ETAPA 3
  const fmtDate = data.date ? new Date(data.date).toLocaleDateString('pt-BR',{day:'numeric',month:'short'}) : '—';
  return (
    <FlowShell title="Revisar e publicar" subtitle="Etapa 3 de 3" onClose={()=>setStep(2)} back>
      <div style={{ padding:'16px', background:'rgba(255,255,255,0.03)', border:`0.5px solid ${sp.accent||'rgba(255,255,255,0.1)'}44`, borderRadius:14, marginBottom:18 }}>
        <div style={{ fontSize:9, color:'rgba(255,255,255,0.4)', letterSpacing:'0.14em', marginBottom:6 }}>PRÉVIA</div>
        <div style={{ fontSize:18, fontWeight:700, color:'#fff', marginBottom:4 }}>{data.name||'(sem nome)'}</div>
        {data.desc && <div style={{ fontSize:12.5, color:'rgba(255,255,255,0.6)', lineHeight:1.4, marginBottom:8 }}>{data.desc}</div>}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {data.date && <Chip>{fmtDate}{data.time?' · '+data.time:''}</Chip>}
          <Chip>Capacidade: {data.capacidade}</Chip>
          {data.recorrente==='sim' && <Chip>{data.frequencia}</Chip>}
          <Chip>{data.tipo==='gratuito'?'Gratuito':'Pago'}</Chip>
          <Chip>{data.visibility==='membros'?'Só membros':'Aberto'}</Chip>
        </div>
      </div>
      {data.tipo==='pago' && (
        <>
          <Eyebrow>Lotes</Eyebrow>
          <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:8, marginBottom:14 }}>
            {data.lotes.map((l,i) => {
              const priceA = l.priceR ? Math.round(parseFloat(l.priceR)*2.4) : 0;
              return (
                <div key={i} style={{ padding:'10px 12px', background:'rgba(255,255,255,0.03)', border:'0.5px solid rgba(255,255,255,0.08)', borderRadius:8, display:'flex', justifyContent:'space-between' }}>
                  <div>
                    <div style={{ fontSize:12.5, color:'#fff', fontWeight:500 }}>{l.name}</div>
                    <div style={{ fontSize:10.5, color:'rgba(255,255,255,0.4)' }}>{l.qty||0} ingressos · até {l.until||'—'}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:12.5, color:'#fff', fontWeight:600 }}>{priceA} A</div>
                    <div style={{ fontSize:10.5, color:'rgba(255,255,255,0.4)' }}>R$ {l.priceR||0}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      <div style={{ flex:1, minHeight:16 }} />
      <PrimaryButton onClick={onDone}>Publicar evento</PrimaryButton>
    </FlowShell>
  );
}

function SpaceCustomizeScreen({ onBack }) {
  const [accent, setAccent] = React.useState('#E07D7D');
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:51, display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <TopBar title="Personalizar Lounge" onBack={onBack} />
      <div style={{ flex:1, overflowY:'auto', padding:'8px 24px 36px' }}>
        <Eyebrow>Preview</Eyebrow>
        <div style={{
          marginTop:12, height:160, borderRadius:14, position:'relative', overflow:'hidden',
          background: `radial-gradient(ellipse at 60% 30%, ${accent}22 0%, #080808 70%)`,
          border:'0.5px solid rgba(255,255,255,0.08)'
        }}>
          <div style={{ position:'absolute', inset:0, padding:18 }}>
            <div style={{ fontSize:9, color:'rgba(255,255,255,0.4)', letterSpacing:'0.14em' }}>SEU LOUNGE ATUAL</div>
            <div style={{ fontSize:20, fontWeight:700, color:'#fff', marginTop:4 }}>Gourmet Club</div>
            <div style={{ marginTop:18 }}>
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.4)', letterSpacing:'0.14em' }}>SEU SALDO</div>
              <div style={{ fontSize:32, fontWeight:700, color:'#fff', letterSpacing:'-0.03em' }}>120 <span style={{ fontSize:13, color:'rgba(255,255,255,0.5)', fontWeight:400 }}>Albers</span></div>
            </div>
          </div>
        </div>

        <div style={{ marginTop:28 }}><Eyebrow>Cor de acento</Eyebrow></div>
        <div style={{ display:'flex', gap:10, marginTop:12 }}>
          {['#E07D7D','#5BCEC9','#C9B06A','#7DA3E0','#B58FE0','#fff'].map(c => (
            <div key={c} onClick={()=>setAccent(c)} style={{
              width:38, height:38, borderRadius:19, background:c, cursor:'pointer',
              border: accent===c?'2px solid #fff':'2px solid rgba(255,255,255,0.1)',
              transition:'transform 0.15s', transform: accent===c?'scale(1.1)':'scale(1)'
            }} />
          ))}
        </div>

        <div style={{ marginTop:28 }}><Eyebrow>Imagem de fundo</Eyebrow></div>
        <div style={{ marginTop:12, padding:'24px', background:'rgba(255,255,255,0.03)', border:'0.5px dashed rgba(255,255,255,0.15)', borderRadius:12, textAlign:'center' }}>
          <div style={{ fontSize:13, color:'rgba(255,255,255,0.55)' }}>Toque para enviar imagem</div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.32)', marginTop:4 }}>JPG ou PNG · até 4MB · 1080×1920</div>
        </div>

        <div style={{ marginTop:14, padding:'12px 14px', background:'rgba(91,206,201,0.05)', border:'0.5px solid rgba(91,206,201,0.18)', borderRadius:10, fontSize:11.5, color:'rgba(91,206,201,0.85)' }}>
          ✓ Contraste suficiente. Shell fixa preservada.
        </div>
      </div>
      <div style={{ padding:'12px 24px 30px', borderTop:'0.5px solid rgba(255,255,255,0.06)' }}>
        <PrimaryButton onClick={onBack}>Salvar customização</PrimaryButton>
      </div>
    </div>
  );
}

// ─────────── ATIVIDADE ──────────────
const TXNS = [
  { d:'HOJE', items:[
    { t:'receber', desc:'@joaosilva', amount:'+120', sub:'Albers · taxa −2', sign:'+' },
    { t:'split_block', desc:'Airbnb Trancoso', amount:'−300', sub:'Reservado · variável', sign:'-r' },
    { t:'carregar', desc:'Carga via Pix', amount:'+R$ 100', sub:'Ana CPF correspondente', sign:'+' },
  ]},
  { d:'ONTEM', items:[
    { t:'event', desc:'Ingresso · Sunset Session', amount:'−0', sub:'Surf Club · Gratuito', sign:'-' },
    { t:'enviar', desc:'@cami', amount:'−45', sub:'Albers · taxa −1', sign:'-' },
  ]},
  { d:'27 ABR', items:[
    { t:'split_release', desc:'Jantar Sushi Yan', amount:'+30', sub:'Excedente devolvido', sign:'+' },
    { t:'descarregar', desc:'Pix enviado', amount:'−R$ 50', sub:'Para chave (11) ****-1234', sign:'-' },
    { t:'fee', desc:'Taxa de saída', amount:'−R$ 0,50', sub:'Descarregar', sign:'-' },
  ]},
];

const TXN_ICONS = {
  receber: '↓', enviar:'↑', carregar:'↓', descarregar:'↑',
  split_block:'🔒', split_release:'🔓', event:'🎫', fee:'%'
};

function AtividadeScreen({ onBack, balance }) {
  const [filter, setFilter] = React.useState('all');
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:50, display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <TopBar title="Atividade" onBack={onBack} />
      <div style={{ padding:'8px 24px 0' }}>
        <div style={{ display:'flex', gap:10 }}>
          <Stat label="Disponível" value={balance} unit="Albers" />
          <Stat label="Reservado" value="300" unit="Albers" />
        </div>
      </div>
      <div style={{ display:'flex', gap:6, padding:'18px 24px 8px', overflowX:'auto' }}>
        {[['all','Todas'],['in','Entradas'],['out','Saídas'],['split','Splits'],['ticket','Ingressos']].map(([k,l]) => (
          <button key={k} onClick={()=>setFilter(k)} style={{
            padding:'7px 14px', borderRadius:14, fontSize:11.5, fontFamily:'inherit', cursor:'pointer',
            background: filter===k?'#fff':'rgba(255,255,255,0.05)',
            color: filter===k?'#000':'rgba(255,255,255,0.7)',
            border: filter===k?'none':'0.5px solid rgba(255,255,255,0.1)', whiteSpace:'nowrap'
          }}>{l}</button>
        ))}
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'0 24px 96px' }}>
        {TXNS.map(g => (
          <div key={g.d} style={{ marginTop:12 }}>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.32)', letterSpacing:'0.16em', padding:'10px 0' }}>{g.d}</div>
            {g.items.map((it, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 0', borderTop:'0.5px solid rgba(255,255,255,0.06)' }}>
                <div style={{ width:36, height:36, borderRadius:18, background:'rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13 }}>{TXN_ICONS[it.t]}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, color:'#fff' }}>{it.desc}</div>
                  <div style={{ fontSize:11.5, color:'rgba(255,255,255,0.4)', marginTop:2 }}>{it.sub}</div>
                </div>
                <div style={{ fontSize:14.5, fontWeight:600,
                  color: it.sign==='+'?'#22C55E': it.sign==='-r'?'#F59E0B':'#fff',
                  fontVariantNumeric:'tabular-nums'
                }}>{it.amount}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────── PERFIL ──────────────
function PerfilScreen({ onBack, onLogout, kycStatus, onKYC, onPin }) {
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:50, display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <TopBar title="Perfil" onBack={onBack} />
      <div style={{ flex:1, overflowY:'auto', padding:'8px 24px 96px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:30 }}>
          <div style={{ width:64, height:64, borderRadius:32, background:'linear-gradient(135deg, #5BCEC9, #06181f)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:600, color:'#fff' }}>M</div>
          <div>
            <div style={{ fontSize:18, fontWeight:600, color:'#fff' }}>Mayte Albuquerque</div>
            <div style={{ fontSize:13, color:'rgba(255,255,255,0.5)', display:'flex', alignItems:'center', gap:6 }}>
              @mayte
              <span title="Perfil verificado" style={{
                display:'inline-flex', alignItems:'center', justifyContent:'center',
                width:16, height:16, borderRadius:8, background:'rgba(91,206,201,0.18)',
                border:'0.5px solid rgba(91,206,201,0.45)'
              }}>
                <svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4.5" stroke="#5BCEC9" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
            </div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.32)', marginTop:3 }}>Membro desde abr/2026</div>
          </div>
        </div>

        <div style={{ marginBottom:24 }}>
          <Eyebrow>Conta</Eyebrow>
          <div style={{ marginTop:6 }}>
            <ActionRow icon={<DotIcon/>} label="Dados cadastrais" sublabel="***.***.456-78" onClick={()=>{}} />
            <ActionRow icon={<DotIcon/>} label="@handle" sublabel="@mayte" onClick={()=> onPin('handle')} />
            <ActionRow icon={<DotIcon/>} label="PIN" sublabel="Última troca há 2 meses" onClick={()=> onPin('handle')} />
            <ActionRow icon={<DotIcon/>} label="Chave Pix" sublabel="(11) ****-1234" onClick={()=> onPin('handle')} />
            <ActionRow icon={<DotIcon/>} label="Perguntas de segurança" sublabel="4 cadastradas" onClick={()=>{}} />
            <ActionRow icon={<DotIcon/>} label="Redes sociais" sublabel="Instagram, TikTok · Perfil verificado ✓" accent="#5BCEC9" onClick={()=>{}} />
          </div>
        </div>

        <div style={{ marginBottom:24 }}>
          <Eyebrow>Verificação</Eyebrow>
          <div style={{ marginTop:6 }}>
            <ActionRow
              icon={<DotIcon/>}
              label="KYC"
              sublabel={kycStatus==='approved'?'Verificado ✓':kycStatus==='submitted'?'Em análise ⏳':'Pendente'}
              onClick={onKYC}
              accent={kycStatus==='approved'?'#22C55E':'#F59E0B'}
            />
          </div>
        </div>

        <div style={{ marginBottom:32 }}>
          <Eyebrow>Preferências</Eyebrow>
          <div style={{ marginTop:6 }}>
            <ActionRow icon={<DotIcon/>} label="Notificações" sublabel="3 categorias ativas" onClick={()=>{}} />
          </div>
        </div>

        <button onClick={onLogout} style={{
          width:'100%', padding:'14px 0', background:'transparent', border:'0.5px solid rgba(239,68,68,0.3)',
          borderRadius:11, color:'#EF4444', fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
          letterSpacing:'0.06em'
        }}>Sair da conta</button>
      </div>
    </div>
  );
}

function DotIcon() {
  return <div style={{ width:6, height:6, borderRadius:3, background:'rgba(255,255,255,0.4)' }} />;
}

// ─────────── ACHAR ──────────────
function AcharScreen({ onBack }) {
  const [q, setQ] = React.useState('');
  const recent = [
    { name:'João Silva Pereira', handle:'@joaosilva' },
    { name:'Ana Maria Costa', handle:'@ana_costa' },
    { name:'Pedro Henrique', handle:'@phenrique' },
    { name:'Camila Rocha', handle:'@cami' },
  ];
  const filtered = q ? recent.filter(r => r.handle.toLowerCase().includes(q.toLowerCase()) || r.name.toLowerCase().includes(q.toLowerCase())) : recent;
  return (
    <div style={{ position:'absolute', inset:0, background:'#000', zIndex:50, display:'flex', flexDirection:'column' }}>
      <StatusBar />
      <TopBar title="Achar" onBack={onBack} />
      <div style={{ padding:'8px 24px 0' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px', background:'rgba(255,255,255,0.05)', border:'0.5px solid rgba(255,255,255,0.1)', borderRadius:11 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.3"/><path d="M10 10l3 3" stroke="rgba(255,255,255,0.5)" strokeWidth="1.3" strokeLinecap="round"/></svg>
          <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Buscar por @handle..." style={{
            flex:1, background:'transparent', border:'none', outline:'none', color:'#fff', fontSize:14, fontFamily:'inherit'
          }} />
        </div>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'18px 24px 96px' }}>
        <Eyebrow>{q?'Resultados':'Recentes'}</Eyebrow>
        <div style={{ marginTop:8 }}>
          {filtered.map(p => (
            <div key={p.handle} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderTop:'0.5px solid rgba(255,255,255,0.06)' }}>
              <div style={{ width:38, height:38, borderRadius:19, background:`hsl(${(p.handle.charCodeAt(1)*23)%360}, 18%, 22%)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:600, color:'#fff' }}>{p.name[0]}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, color:'#fff' }}>{p.name}</div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,0.45)' }}>{p.handle}</div>
              </div>
              <span style={{ color:'rgba(255,255,255,0.2)', fontSize:18 }}>›</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Create Lounge CTA — disabled if user already has one
function CreateLoungeButton({ disabled, onClick }) {
  const [showTooltip, setShowTooltip] = React.useState(false);
  return (
    <div style={{ position:'relative', marginBottom:14 }}>
      <button
        onClick={() => {
          if (disabled) {
            setShowTooltip(true);
            setTimeout(() => setShowTooltip(false), 2500);
          } else { onClick(); }
        }}
        style={{
          width:'100%', padding:'14px 16px', borderRadius:14,
          background: disabled ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.05)',
          border: `0.5px dashed ${disabled ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.25)'}`,
          color: disabled ? 'rgba(255,255,255,0.35)' : '#fff',
          fontSize:13.5, fontWeight:500, fontFamily:'inherit', cursor:'pointer', letterSpacing:'0.01em',
          display:'flex', alignItems:'center', gap:10, justifyContent:'center'
        }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        Criar Lounge
        {disabled && <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity:0.6 }}>
          <rect x="3" y="5.5" width="6" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.1"/>
        </svg>}
      </button>
      {showTooltip && (
        <div style={{
          position:'absolute', top:'calc(100% + 6px)', left:'50%', transform:'translateX(-50%)',
          padding:'8px 12px', background:'#1a1a1a', border:'0.5px solid rgba(255,255,255,0.12)',
          borderRadius:8, fontSize:11.5, color:'rgba(255,255,255,0.85)', zIndex:5, whiteSpace:'nowrap',
          boxShadow:'0 4px 16px rgba(0,0,0,0.5)', animation:'pop 0.2s ease-out'
        }}>
          Você já possui um Lounge ativo
        </div>
      )}
    </div>
  );
}

// ─────────── CRIAR LOUNGE (3 etapas) ──────────────
function LoungeCreateScreen({ onClose, onDone }) {
  const [step, setStep] = React.useState(1);
  const [data, setData] = React.useState({ name:'', desc:'', visibility:'publico', accent:'#5BCEC9' });
  const upd = (k,v) => setData(d => ({...d, [k]:v}));
  const PALETTE = ['#5BCEC9','#C9B06A','#E07D7D','#7DA3E0','#B58FE0','#7AB87A','#E0B05B','#9B6B82'];

  if (step===1) return (
    <FlowShell title="Criar Lounge" subtitle="Etapa 1 de 3" onClose={onClose}>
      <Eyebrow>Nome do Lounge</Eyebrow>
      <input value={data.name} onChange={e=>upd('name',e.target.value)} autoFocus placeholder="Ex: Vinhos & Conversa" maxLength={40}
        style={{ width:'100%', background:'transparent', border:'none', borderBottom:'0.5px solid rgba(255,255,255,0.18)', padding:'10px 0', marginTop:8, fontSize:20, color:'#fff', fontFamily:'inherit', outline:'none', letterSpacing:'-0.01em' }} />
      <div style={{ marginTop:6, fontSize:11, color:'rgba(255,255,255,0.35)' }}>{(data.name||'').length}/40</div>
      <div style={{ marginTop:28 }}>
        <Eyebrow>Descrição</Eyebrow>
        <textarea value={data.desc} onChange={e=>upd('desc',e.target.value)}
          placeholder="O que une as pessoas neste Lounge?" maxLength={240}
          style={{ width:'100%', background:'rgba(255,255,255,0.03)', border:'0.5px solid rgba(255,255,255,0.12)', borderRadius:10, padding:'12px', marginTop:8, fontSize:14, color:'#fff', fontFamily:'inherit', outline:'none', resize:'none', minHeight:96, lineHeight:1.5 }} />
        <div style={{ marginTop:6, fontSize:11, color:'rgba(255,255,255,0.35)' }}>{(data.desc||'').length}/240</div>
      </div>
      <div style={{ flex:1 }} />
      <PrimaryButton disabled={!data.name || data.name.length<3} onClick={()=>setStep(2)}>Continuar</PrimaryButton>
    </FlowShell>
  );

  if (step===2) return (
    <FlowShell title="Criar Lounge" subtitle="Etapa 2 de 3" onClose={()=>setStep(1)} back>
      <Eyebrow>Tipo de Lounge</Eyebrow>
      <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:14 }}>
        {[
          { id:'publico', t:'Público', d:'Qualquer pessoa pode encontrar e solicitar entrada. Você aprova ou recusa.' },
          { id:'privado', t:'Privado', d:'Apenas pessoas com link de convite podem entrar. Não aparece na busca.' },
        ].map(o => (
          <div key={o.id} onClick={()=>upd('visibility',o.id)} style={{
            padding:'16px 18px', borderRadius:12, cursor:'pointer',
            background: data.visibility===o.id?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.02)',
            border:`0.5px solid ${data.visibility===o.id?'rgba(255,255,255,0.3)':'rgba(255,255,255,0.08)'}`
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:5 }}>
              <div style={{ width:18, height:18, borderRadius:9, border:'1.3px solid rgba(255,255,255,0.4)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                {data.visibility===o.id && <div style={{ width:9, height:9, borderRadius:5, background:'#fff' }} />}
              </div>
              <div style={{ fontSize:15, fontWeight:600, color:'#fff' }}>{o.t}</div>
            </div>
            <div style={{ fontSize:12.5, color:'rgba(255,255,255,0.55)', lineHeight:1.45, marginLeft:28 }}>{o.d}</div>
          </div>
        ))}
      </div>
      <div style={{ flex:1 }} />
      <PrimaryButton onClick={()=>setStep(3)}>Continuar</PrimaryButton>
    </FlowShell>
  );

  return (
    <FlowShell title="Criar Lounge" subtitle="Etapa 3 de 3" onClose={()=>setStep(2)} back>
      <Eyebrow>Preview</Eyebrow>
      <div style={{
        marginTop:12, height:160, borderRadius:14, position:'relative', overflow:'hidden',
        background: `radial-gradient(ellipse at 60% 30%, ${data.accent}28 0%, #050505 75%)`,
        border:`0.5px solid ${data.accent}33`
      }}>
        <div style={{ position:'absolute', inset:'auto 0 0 0', padding:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
            <div style={{ width:8, height:8, borderRadius:4, background:data.accent }} />
            <div style={{ fontSize:9, color:data.accent, letterSpacing:'0.14em', padding:'2px 7px', background:`${data.accent}22`, border:`0.5px solid ${data.accent}55`, borderRadius:3 }}>DONO</div>
          </div>
          <div style={{ fontSize:22, fontWeight:700, color:'#fff', letterSpacing:'-0.02em' }}>{data.name || 'Nome do Lounge'}</div>
          <div style={{ fontSize:11.5, color:'rgba(255,255,255,0.55)', marginTop:3 }}>1 membro · {data.visibility==='publico'?'público':'privado'}</div>
        </div>
      </div>
      <div style={{ marginTop:24 }}><Eyebrow>Cor de acento</Eyebrow></div>
      <div style={{ display:'flex', gap:10, marginTop:12, flexWrap:'wrap' }}>
        {PALETTE.map(c => (
          <div key={c} onClick={()=>upd('accent',c)} style={{
            width:38, height:38, borderRadius:19, background:c, cursor:'pointer',
            border: data.accent===c?'2px solid #fff':'2px solid rgba(255,255,255,0.08)',
            transition:'transform 0.15s', transform: data.accent===c?'scale(1.08)':'scale(1)'
          }} />
        ))}
      </div>
      <div style={{ marginTop:24 }}><Eyebrow>Imagem de capa</Eyebrow></div>
      <div style={{ marginTop:10, padding:'20px', border:'1px dashed rgba(255,255,255,0.15)', borderRadius:12, textAlign:'center', color:'rgba(255,255,255,0.5)', fontSize:12, cursor:'pointer' }}>
        Toque para enviar · JPG/PNG até 4MB · 1080×1920
      </div>
      <div style={{ marginTop:14, padding:'10px 14px', background:`${data.accent}10`, border:`0.5px solid ${data.accent}30`, borderRadius:10, fontSize:11.5, color:`${data.accent}cc`, lineHeight:1.5 }}>
        Você poderá personalizar mais detalhes depois — imagem de fundo, hero, mensagens e regras de moderação.
      </div>
      <div style={{ flex:1 }} />
      <PrimaryButton onClick={onDone}>Criar Lounge</PrimaryButton>
    </FlowShell>
  );
}

Object.assign(window, { SpacesScreen, SpaceDetailScreen, SpaceCustomizeScreen, EventCreateScreen, EventManageScreen, EventCard, AtividadeScreen, PerfilScreen, AcharScreen, SPACES_LIST, activeLote, LoungeCreateScreen, CreateLoungeButton });
