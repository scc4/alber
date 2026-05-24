// Shared Alber UI primitives
const { COLORS, SPACE_SKINS, TYPE } = window.ALBER;

// Logo glyph — uses window.__ALBER_LOGO_D (loaded inline)
function AlberA({ size = 28, color = '#fff', opacity = 1 }) {
  // Real path bbox: x −309 → 428 (w=737), y −2 → 701 (h=703)
  // Pad 8 each side so the glyph never kisses the edge.
  return (
    <svg width={size} height={size * (719/753)} viewBox="-317 -10 753 719" style={{ opacity, flexShrink: 0, overflow:'visible' }}>
      <path d={window.__ALBER_LOGO_D} fill={color} />
    </svg>
  );
}

function AlberWatermark({ skin }) {
  return (
    <svg viewBox="-317 -10 753 719" style={{
      position:'absolute', top:'50%', left:'50%',
      transform:'translate(-50%,-52%)', width:340, height:324,
      opacity: skin.wm, pointerEvents:'none', zIndex:1, overflow:'visible'
    }}>
      <path d={window.__ALBER_LOGO_D} fill="#fff" />
    </svg>
  );
}

// Status bar (custom — dark mode)
function StatusBar({ time = '9:41', dark = true }) {
  const c = dark ? '#fff' : '#000';
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'14px 28px 8px', height:44, position:'relative', zIndex:30
    }}>
      <span style={{ fontFamily:'-apple-system,SF Pro,system-ui', fontWeight:600, fontSize:15, color:c, letterSpacing:'-0.01em' }}>{time}</span>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="6" width="3" height="5" rx="0.6" fill={c}/><rect x="4.5" y="4" width="3" height="7" rx="0.6" fill={c}/><rect x="9" y="2" width="3" height="9" rx="0.6" fill={c}/><rect x="13.5" y="0" width="3" height="11" rx="0.6" fill={c}/></svg>
        <svg width="15" height="11" viewBox="0 0 15 11" fill={c}><path d="M7.5 2.8c2 0 3.8.8 5.1 2.1l1-1A8.7 8.7 0 0 0 7.5 1.3 8.7 8.7 0 0 0 1.4 3.9l1 1A7.2 7.2 0 0 1 7.5 2.8Z"/><path d="M7.5 6c1.2 0 2.3.5 3 1.2l1-1a5.8 5.8 0 0 0-4-1.6 5.8 5.8 0 0 0-4 1.6l1 1c.7-.7 1.8-1.2 3-1.2Z"/><circle cx="7.5" cy="9.4" r="1.3"/></svg>
        <svg width="24" height="11" viewBox="0 0 24 11"><rect x="0.5" y="0.5" width="20" height="10" rx="3" stroke={c} strokeOpacity="0.4" fill="none"/><rect x="2" y="2" width="17" height="7" rx="1.5" fill={c}/><path d="M22 3.5v4c.7-.2 1.3-1 1.3-2s-.6-1.8-1.3-2Z" fill={c} fillOpacity="0.5"/></svg>
      </div>
    </div>
  );
}

function HomeIndicator({ dark = true }) {
  return (
    <div style={{ display:'flex', justifyContent:'center', padding:'8px 0 8px', position:'relative', zIndex:30 }}>
      <div style={{ width:134, height:5, borderRadius:3, background: dark? 'rgba(255,255,255,0.85)':'#000' }} />
    </div>
  );
}

// iPhone bezel
function PhoneFrame({ children, dark = true }) {
  return (
    <div style={{
      width: 390, height: 844, borderRadius: 54,
      background: '#000', position: 'relative', overflow: 'hidden',
      boxShadow: '0 0 0 12px #1a1a1a, 0 0 0 13px #2a2a2a, 0 30px 80px rgba(0,0,0,0.6)',
      fontFamily: TYPE.family,
    }}>
      {/* Dynamic Island */}
      <div style={{
        position:'absolute', top:11, left:'50%', transform:'translateX(-50%)',
        width:124, height:36, borderRadius:20, background:'#000', zIndex:50
      }} />
      <div style={{ width:'100%', height:'100%', position:'relative', overflow:'hidden', background:'#000' }}>
        {children}
      </div>
    </div>
  );
}

// Bottom nav
function BottomNav({ active, onNavigate, dark = true }) {
  const items = [
    { id:'perfil', label:'Perfil', icon: <><circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M4 18c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></> },
    { id:'achar', label:'Achar', icon: <><circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M15 15l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></> },
    { id:'spaces', label:'Lounge', icon: <><rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none"/><rect x="11" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none"/><rect x="2" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none"/><rect x="11" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none"/></> },
    { id:'atividade', label:'Atividade', icon: <path d="M3 5h14M3 10h14M3 15h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/> },
  ];
  return (
    <div style={{
      position:'absolute', bottom:0, left:0, right:0, zIndex:70,
      background:'rgba(0,0,0,0.96)',
      backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
      borderTop:'0.5px solid rgba(255,255,255,0.08)',
      display:'flex', padding:'10px 0 28px',
    }}>
      {items.map(it => (
        <div key={it.id}
          onClick={() => onNavigate(it.id)}
          style={{
            flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:5,
            cursor:'pointer', opacity: active===it.id ? 1 : 0.32,
            transition:'opacity 0.18s', color:'#fff'
          }}>
          <svg width="20" height="20" viewBox="0 0 20 20">{it.icon}</svg>
          <span style={{ fontSize:9.5, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase' }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// Generic top header with back button + title
function TopBar({ title, onBack, right, scrolled = false, contextLabel }) {
  return (
    <div style={{
      position:'sticky', top:0, zIndex:20,
      padding:'0 24px', minHeight:56,
      display:'flex', alignItems:'center', gap:12,
      background: scrolled ? 'rgba(0,0,0,0.85)' : 'transparent',
      backdropFilter: scrolled ? 'blur(16px)' : 'none',
      borderBottom: scrolled ? '0.5px solid rgba(255,255,255,0.06)' : 'none',
    }}>
      {onBack && (
        <button onClick={onBack} style={{
          background:'none', border:'none', padding:8, marginLeft:-8,
          cursor:'pointer', color:'rgba(255,255,255,0.85)'
        }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
      <div style={{ flex:1, minWidth:0 }}>
        {contextLabel && (
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:1 }}>{contextLabel}</div>
        )}
        <div style={{ fontSize:17, fontWeight:600, color:'#fff', letterSpacing:'-0.015em', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{title}</div>
      </div>
      {right}
    </div>
  );
}

// Primary button
function PrimaryButton({ children, onClick, disabled, variant='primary', loading, success }) {
  const colors = {
    primary: { bg:'#fff', fg:'#000' },
    destructive: { bg:'#1a1a1a', fg:'#EF4444' },
    confirm: { bg:'#fff', fg:'#000' },
    ghost: { bg:'rgba(255,255,255,0.06)', fg:'#fff' },
  };
  const c = colors[variant] || colors.primary;
  return (
    <button onClick={onClick} disabled={disabled || loading} style={{
      height:50, width:'100%',
      background: c.bg, color: c.fg,
      border: variant==='ghost' ? '0.5px solid rgba(255,255,255,0.12)' : 'none',
      borderRadius:12,
      fontSize:14, fontWeight:700, fontFamily:'inherit',
      letterSpacing:'0.08em', textTransform:'uppercase',
      cursor: disabled?'default':'pointer',
      opacity: disabled?0.3:1,
      transition:'opacity 0.15s, transform 0.1s',
      display:'flex', alignItems:'center', justifyContent:'center', gap:8,
    }}
    onMouseDown={(e)=> !disabled && (e.currentTarget.style.transform='scale(0.98)')}
    onMouseUp={(e)=> e.currentTarget.style.transform='scale(1)'}
    onMouseLeave={(e)=> e.currentTarget.style.transform='scale(1)'}
    >
      {loading ? <span style={{ width:16, height:16, border:'2px solid rgba(0,0,0,0.2)', borderTopColor:'#000', borderRadius:'50%', animation:'spin 0.8s linear infinite'}} /> :
       success ? <span>✓</span> : children}
    </button>
  );
}

// Section divider with subtle rule
function Rule({ style }) {
  return <div style={{ height:'0.5px', background:'rgba(255,255,255,0.07)', ...style }} />;
}

// Fine label
function Eyebrow({ children, color='rgba(255,255,255,0.32)' }) {
  return <div style={{ fontSize:10.5, color, letterSpacing:'0.14em', textTransform:'uppercase', fontWeight:500 }}>{children}</div>;
}

// Action row
function ActionRow({ icon, label, sublabel, onClick, disabled, accent }) {
  return (
    <div onClick={!disabled ? onClick : undefined} style={{
      display:'flex', alignItems:'center', gap:14,
      padding:'15px 0', borderTop:'0.5px solid rgba(255,255,255,0.07)',
      cursor: disabled ? 'default':'pointer',
      opacity: disabled ? 0.4 : 1,
      transition:'opacity 0.12s'
    }}
    onMouseDown={(e)=> !disabled && (e.currentTarget.style.opacity='0.55')}
    onMouseUp={(e)=> !disabled && (e.currentTarget.style.opacity='1')}
    onMouseLeave={(e)=> !disabled && (e.currentTarget.style.opacity='1')}
    >
      <div style={{ width:20, height:20, display:'flex', alignItems:'center', justifyContent:'center', color: accent || 'rgba(255,255,255,0.8)' }}>{icon}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:16, color:'rgba(255,255,255,0.9)', fontWeight:400 }}>{label}</div>
        {sublabel && <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)', marginTop:2 }}>{sublabel}</div>}
      </div>
      <span style={{ color:'rgba(255,255,255,0.2)', fontSize:18 }}>›</span>
    </div>
  );
}

// Banner (warning / info)
function Banner({ tone='warning', text, cta, onClick }) {
  const tones = {
    warning: { color:'#F59E0B', bg:'rgba(245,158,11,0.07)', border:'rgba(245,158,11,0.22)' },
    info: { color:'rgba(255,255,255,0.65)', bg:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.1)' },
    success: { color:'#22C55E', bg:'rgba(34,197,94,0.07)', border:'rgba(34,197,94,0.22)' },
    error: { color:'#EF4444', bg:'rgba(239,68,68,0.07)', border:'rgba(239,68,68,0.22)' },
  };
  const t = tones[tone];
  return (
    <div onClick={onClick} style={{
      background:t.bg, border:`0.5px solid ${t.border}`,
      borderRadius:10, padding:'10px 14px',
      display:'flex', alignItems:'center', gap:10, cursor: onClick?'pointer':'default'
    }}>
      <div style={{ width:6, height:6, borderRadius:'50%', background:t.color, flexShrink:0 }} />
      <div style={{ fontSize:12, color:t.color, lineHeight:1.35, flex:1 }}>{text}</div>
      {cta && <div style={{ fontSize:11, color:t.color, fontWeight:600, letterSpacing:'0.02em', whiteSpace:'nowrap' }}>{cta}</div>}
    </div>
  );
}

// Bottom sheet
function Sheet({ open, onClose, children, height = 'auto' }) {
  return (
    <div onClick={(e)=> e.target===e.currentTarget && onClose && onClose()} style={{
      position:'absolute', inset:0, zIndex:40,
      background:'rgba(0,0,0,0.78)',
      display:'flex', alignItems:'flex-end',
      opacity: open?1:0, pointerEvents: open?'all':'none',
      transition:'opacity 0.2s'
    }}>
      <div style={{
        width:'100%', background:'#0a0a0a',
        borderRadius:'18px 18px 0 0',
        borderTop:'0.5px solid rgba(255,255,255,0.1)',
        padding:'12px 24px 36px',
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition:'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        maxHeight: '80%', overflowY:'auto', height,
      }}>
        <div style={{ width:36, height:4, borderRadius:2, background:'rgba(255,255,255,0.18)', margin:'0 auto 16px' }} />
        {children}
      </div>
    </div>
  );
}

// Input
function Input({ label, value, onChange, placeholder, type='text', mask, autoFocus, hint, error }) {
  return (
    <div>
      {label && <Eyebrow>{label}</Eyebrow>}
      <input type={type} value={value} onChange={(e)=> onChange && onChange(e.target.value)}
        placeholder={placeholder} autoFocus={autoFocus}
        style={{
          width:'100%', background:'transparent', border:'none',
          borderBottom:`0.5px solid ${error ? '#EF4444' : 'rgba(255,255,255,0.18)'}`,
          padding:'10px 0', marginTop:8, fontSize:18,
          color:'#fff', fontFamily:'inherit', outline:'none', letterSpacing:'-0.01em'
        }} />
      {hint && <div style={{ fontSize:11, color: error?'#EF4444':'rgba(255,255,255,0.35)', marginTop:6 }}>{hint}</div>}
    </div>
  );
}

Object.assign(window, { AlberA, AlberWatermark, StatusBar, HomeIndicator, PhoneFrame, BottomNav, TopBar, PrimaryButton, Rule, Eyebrow, ActionRow, Banner, Sheet, Input });
