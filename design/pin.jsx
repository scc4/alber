// PIN screen with 3 keyboard variants
const { COLORS } = window.ALBER;

const PAIRS = [[0,2],[4,6],[5,7],[8,9],[1,3]];

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

// Variant 1: Pair-grid (original spec — 3 cols, pairs in cells)
function PinKbPairGrid({ onDigit, onBack }) {
  const [pairs, setPairs] = React.useState(() => shuffle(PAIRS));
  // re-shuffle on mount
  React.useEffect(() => { setPairs(shuffle(PAIRS)); }, []);
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:9 }}>
      {pairs.map((p, i) => (
        <button key={i} onClick={()=> onDigit(p[Math.random()<0.5?0:1])} style={kbCellStyle}>
          <span style={{ fontSize:17, fontWeight:500, color:'#fff' }}>{p[0]}</span>
          <span style={{ fontSize:11, color:'rgba(255,255,255,0.28)', margin:'0 4px' }}>|</span>
          <span style={{ fontSize:17, fontWeight:500, color:'#fff' }}>{p[1]}</span>
        </button>
      ))}
      <button onClick={onBack} style={{ ...kbCellStyle, color:'rgba(255,255,255,0.55)' }}>
        <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
          <path d="M19 2v10a1 1 0 0 1-1 1H7l-5-6 5-6h11a1 1 0 0 1 1 1Z" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M11 5l4 4M15 5l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

// Variant 2: Twin-row (pairs split across two horizontal scrolls)
function PinKbTwinRow({ onDigit, onBack }) {
  const [layout, setLayout] = React.useState(() => {
    const p = shuffle(PAIRS);
    return { top: p.map(x=>x[0]), bottom: p.map(x=>x[1]) };
  });
  React.useEffect(() => {
    const p = shuffle(PAIRS);
    setLayout({ top: p.map(x=>x[0]), bottom: p.map(x=>x[1]) });
  }, []);
  const Row = ({ digits, accent }) => (
    <div style={{ display:'flex', gap:8 }}>
      {digits.map((d,i) => (
        <button key={i} onClick={()=> onDigit(d)} style={{
          flex:1, height:54, background:'rgba(255,255,255,0.04)',
          border:`0.5px solid ${accent}`, borderRadius:11, color:'#fff',
          fontSize:18, fontWeight:500, fontFamily:'inherit', cursor:'pointer'
        }}>{d}</button>
      ))}
    </div>
  );
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <Row digits={layout.top} accent="rgba(91,206,201,0.18)" />
      <Row digits={layout.bottom} accent="rgba(255,255,255,0.09)" />
      <button onClick={onBack} style={{
        height:46, background:'rgba(255,255,255,0.03)', border:'0.5px solid rgba(255,255,255,0.08)',
        borderRadius:11, color:'rgba(255,255,255,0.55)', cursor:'pointer',
        display:'flex', alignItems:'center', justifyContent:'center', gap:8, fontSize:12, letterSpacing:'0.06em'
      }}>
        <svg width="16" height="12" viewBox="0 0 20 14" fill="none">
          <path d="M19 2v10a1 1 0 0 1-1 1H7l-5-6 5-6h11a1 1 0 0 1 1 1Z" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M11 5l4 4M15 5l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        APAGAR
      </button>
    </div>
  );
}

// Variant 3: Wheel (radial / arc)
function PinKbArc({ onDigit, onBack }) {
  const [pairs, setPairs] = React.useState(() => shuffle(PAIRS));
  React.useEffect(() => { setPairs(shuffle(PAIRS)); }, []);
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 }}>
      {pairs.map((p, i) => (
        <div key={i} style={{
          background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.09)',
          borderRadius:14, display:'flex', overflow:'hidden'
        }}>
          <button onClick={()=> onDigit(p[0])} style={{
            flex:1, padding:'18px 0', background:'transparent', border:'none',
            borderRight:'0.5px solid rgba(255,255,255,0.08)',
            fontSize:18, fontWeight:500, color:'#fff', fontFamily:'inherit', cursor:'pointer'
          }}>{p[0]}</button>
          <button onClick={()=> onDigit(p[1])} style={{
            flex:1, padding:'18px 0', background:'transparent', border:'none',
            fontSize:18, fontWeight:500, color:'#fff', fontFamily:'inherit', cursor:'pointer'
          }}>{p[1]}</button>
        </div>
      ))}
      <button onClick={onBack} style={{
        gridColumn:'1 / span 2', height:46,
        background:'rgba(255,255,255,0.03)', border:'0.5px solid rgba(255,255,255,0.08)',
        borderRadius:11, color:'rgba(255,255,255,0.55)', cursor:'pointer', fontFamily:'inherit',
        display:'flex', alignItems:'center', justifyContent:'center', gap:8, fontSize:12, letterSpacing:'0.06em'
      }}>
        <svg width="16" height="12" viewBox="0 0 20 14" fill="none">
          <path d="M19 2v10a1 1 0 0 1-1 1H7l-5-6 5-6h11a1 1 0 0 1 1 1Z" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M11 5l4 4M15 5l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        APAGAR
      </button>
    </div>
  );
}

const kbCellStyle = {
  background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.09)',
  borderRadius:12, padding:'17px 0', textAlign:'center', cursor:'pointer',
  fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center'
};

// PIN screen wrapper — context-aware
function PinScreen({ open, onClose, onComplete, ctx, variant='pairgrid', recipient, amount, unit='Albers', feeFree }) {
  const [count, setCount] = React.useState(0);
  const [error, setError] = React.useState(false);
  const [completing, setCompleting] = React.useState(false);

  React.useEffect(() => {
    if (open) { setCount(0); setError(false); setCompleting(false); }
  }, [open]);

  const handleDigit = () => {
    if (count >= 6) return;
    setCount(c => c + 1);
  };
  const handleBack = () => setCount(c => Math.max(0, c-1));

  const submit = () => {
    setCompleting(true);
    setTimeout(() => { onComplete && onComplete(); setCompleting(false); }, 600);
  };

  const labels = {
    receber: { ctx:'USE ALBER', title:'PIN de Transação' },
    carregar: { ctx:'CARREGAR', title:'Autenticação' },
    descarregar: { ctx:'DESCARREGAR', title:'Confirme a operação' },
    split: { ctx:'FECHAR SPLIT', title:'Confirme o fechamento' },
    evento: { ctx:'INGRESSO', title:'Confirme a compra' },
    handle: { ctx:'TROCAR @HANDLE', title:'Confirme sua identidade' },
  };
  const L = labels[ctx] || labels.receber;

  const KB = variant==='twinrow' ? PinKbTwinRow : variant==='arc' ? PinKbArc : PinKbPairGrid;

  return (
    <div style={{
      position:'absolute', inset:0, background:'#000', zIndex:60,
      padding:'54px 24px 36px', display:'flex', flexDirection:'column',
      opacity: open?1:0, pointerEvents: open?'all':'none',
      transition:'opacity 0.2s', fontFamily: window.ALBER.TYPE.family
    }}>
      <button onClick={onClose} style={{
        position:'absolute', top:54, right:24, background:'none', border:'none',
        color:'rgba(255,255,255,0.45)', fontSize:13, cursor:'pointer', fontFamily:'inherit', letterSpacing:'0.04em'
      }}>Cancelar</button>

      <div style={{ fontSize:10.5, color:'rgba(255,255,255,0.4)', letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:5 }}>{L.ctx}</div>
      <div style={{ fontSize:22, fontWeight:600, color:'#fff', letterSpacing:'-0.02em', marginBottom:22 }}>{L.title}</div>

      {recipient && (
        <div style={{ background:'rgba(255,255,255,0.04)', border:'0.5px solid rgba(255,255,255,0.09)', borderRadius:12, padding:'12px 16px', marginBottom:18 }}>
          <div style={{ fontSize:9.5, color:'rgba(255,255,255,0.32)', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:4 }}>{recipient.label || 'Recebedor'}</div>
          <div style={{ fontSize:14.5, fontWeight:500, color:'#fff' }}>{recipient.name}</div>
          {recipient.id && <div style={{ fontSize:11.5, color:'rgba(255,255,255,0.4)', marginTop:2 }}>{recipient.id}</div>}
        </div>
      )}

      {amount != null && (
        <div style={{ textAlign:'center', marginBottom:18 }}>
          <span style={{ fontSize:42, fontWeight:700, color:'#fff', letterSpacing:'-0.04em' }}>{amount}</span>
          <span style={{ fontSize:14, color:'rgba(255,255,255,0.4)', marginLeft:6 }}>{unit}</span>
          {feeFree && (
            <div style={{ marginTop:6, fontSize:10.5, color:'#22C55E', letterSpacing:'0.08em', fontWeight:500 }}>SEM TAXA</div>
          )}
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'center', gap:10, marginBottom:24, animation: error?'shake 0.3s':'none' }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{
            width:12, height:12, borderRadius:'50%',
            background: count>i ? '#fff' : 'transparent',
            border: count>i ? '1.5px solid #fff' : '1.5px solid rgba(255,255,255,0.25)',
            transition:'all 0.1s'
          }} />
        ))}
      </div>

      <KB onDigit={() => { handleDigit(); }} onBack={handleBack} />

      <button
        disabled={count<6 || completing}
        onClick={submit}
        style={{
          marginTop:14, height:48, background:'#fff', color:'#000',
          border:'none', borderRadius:11, fontSize:13, fontWeight:700,
          letterSpacing:'0.1em', cursor:'pointer', fontFamily:'inherit',
          opacity: (count<6 || completing) ? 0.25 : 1,
          textTransform:'uppercase'
        }}>
        {completing ? '••••••' : 'USE ALBER'}
      </button>
    </div>
  );
}

// Security confirmation
function SecurityConfirm({ open, onClose, onComplete }) {
  const QUESTIONS = [
    'Cidade onde você nasceu?',
    'Nome da sua mãe?',
    'Primeiro animal de estimação?',
    'Nome da rua da infância?'
  ];
  const ANSWERS = [
    'S** P****', 'M*** S****a', 'B**y', 'R** das F****s'
  ];
  const FAKES = [
    'R** J****o', 'A*a S****a', 'L***a', 'A** B****s',
    'R*****e', 'C****a S****', 'R**', 'P****** A****a'
  ];
  const [q] = React.useState(() => Math.floor(Math.random()*QUESTIONS.length));
  const [opts] = React.useState(() => {
    const correct = ANSWERS[q];
    const fakes = shuffle(FAKES.filter(f => f!==correct)).slice(0,3);
    return shuffle([correct, ...fakes]).map(text => ({ text, correct: text===ANSWERS[q] }));
  });
  const [selected, setSelected] = React.useState(null);

  const pick = (i) => {
    setSelected(i);
    setTimeout(() => onComplete && onComplete(), 350);
  };

  return (
    <div style={{
      position:'absolute', inset:0, background:'#000', zIndex:60,
      padding:'54px 24px 36px', display:'flex', flexDirection:'column',
      opacity: open?1:0, pointerEvents: open?'all':'none',
      transition:'opacity 0.2s', fontFamily: window.ALBER.TYPE.family
    }}>
      <button onClick={onClose} style={{
        position:'absolute', top:54, right:24, background:'none', border:'none',
        color:'rgba(255,255,255,0.45)', fontSize:13, cursor:'pointer', fontFamily:'inherit'
      }}>Cancelar</button>

      <div style={{ fontSize:10.5, color:'rgba(255,255,255,0.4)', letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:5 }}>SEGURANÇA</div>
      <div style={{ fontSize:22, fontWeight:600, color:'#fff', letterSpacing:'-0.02em', marginBottom:8 }}>Confirme sua identidade</div>
      <div style={{ fontSize:14, color:'rgba(255,255,255,0.55)', marginBottom:28 }}>{QUESTIONS[q]}</div>

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {opts.map((o,i) => (
          <button key={i} onClick={()=> pick(i)} style={{
            background: selected===i ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)',
            border:'0.5px solid rgba(255,255,255,0.1)', borderRadius:12,
            padding:'18px 20px', textAlign:'left', color:'#fff', fontSize:15,
            cursor:'pointer', fontFamily:'inherit', transition:'background 0.15s'
          }}>{o.text}</button>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { PinScreen, SecurityConfirm, shuffle });
