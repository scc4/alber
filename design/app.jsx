// Main app — root with navigation
const { useState, useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "skin": "surf",
  "pinVariant": "pairgrid",
  "kycStatus": "approved",
  "balance": 480,
  "balanceHidden": false,
  "evaluation": false,
  "authStart": "home"
}/*EDITMODE-END*/;

function App() {
  const [tw, setTw] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = useState({ name: tw.authStart || 'home' });
  const [stack, setStack] = useState([]);

  // Sync route when authStart tweak changes (toggle entry point from panel)
  useEffect(() => {
    if (tw.authStart && tw.authStart !== 'home' && route.name !== tw.authStart) {
      setRoute({ name: tw.authStart });
      setStack([]);
    }
  }, [tw.authStart]);

  const go = (r) => { setStack(s => [...s, route]); setRoute(r); };
  const back = () => {
    setStack(s => {
      if (s.length === 0) { setRoute({ name:'home' }); return s; }
      const next = s[s.length-1];
      setRoute(next);
      return s.slice(0, -1);
    });
  };
  const reset = () => { setStack([]); setRoute({ name:'home' }); };

  const navTo = (id) => {
    if (id === 'home') reset();
    else { setStack([{name:'home'}]); setRoute({ name: id }); }
  };

  const navActive = ['home','spaces','atividade','perfil'].includes(route.name) ? route.name : null;

  return (
    <PhoneFrame>
      {route.name === 'splash' && (
        <SplashScreen onDone={() => { setTw('authStart','home'); setRoute({ name:'welcome' }); }} />
      )}
      {route.name === 'welcome' && (
        <WelcomeScreen
          onSignup={() => setRoute({ name:'onboarding' })}
          onLogin={() => setRoute({ name:'login' })} />
      )}
      {route.name === 'onboarding' && (
        <OnboardingFlow pinVariant={tw.pinVariant}
          onClose={() => setRoute({ name:'welcome' })}
          onComplete={() => { setTw('authStart','home'); setStack([]); setRoute({ name:'home' }); }} />
      )}
      {route.name === 'login' && (
        <LoginFlow pinVariant={tw.pinVariant}
          onClose={() => setRoute({ name:'welcome' })}
          onSignup={() => setRoute({ name:'onboarding' })}
          onForgot={() => setRoute({ name:'forgot' })}
          onComplete={() => { setTw('authStart','home'); setStack([]); setRoute({ name:'home' }); }} />
      )}
      {route.name === 'forgot' && (
        <ForgotPinFlow
          onClose={() => setRoute({ name:'login' })}
          onComplete={() => setRoute({ name:'login' })} />
      )}

      <HomeScreen
        skin={tw.skin}
        balance={tw.balance}
        balanceHidden={tw.balanceHidden}
        kycStatus={tw.kycStatus}
        evaluation={tw.evaluation}
        onToggleBalance={() => setTw('balanceHidden', !tw.balanceHidden)}
        onAction={(a) => {
          if (a === 'receber') go({ name:'receber' });
          else if (a === 'carregar') go({ name:'carregar' });
          else if (a === 'transferir') go({ name:'transferir' });
          else if (a === 'split') go({ name:'splits' });
        }}
        onSpaceClick={() => go({ name:'spaces' })}
        onBannerClick={() => go({ name:'kyc' })}
        onNavBanner={() => go({ name:'atividade' })}
      />

      {route.name === 'receber' && (
        <ReceberFlow pinVariant={tw.pinVariant} onClose={reset}
          onComplete={(amt) => { setTw('balance', tw.balance + amt); reset(); }} />
      )}
      {route.name === 'carregar' && (
        <CarregarFlow pinVariant={tw.pinVariant} onClose={reset} onComplete={reset} />
      )}
      {route.name === 'transferir' && (
        <TransferirFlow pinVariant={tw.pinVariant} balance={tw.balance} onClose={reset}
          onComplete={(amt) => { setTw('balance', tw.balance - amt); reset(); }} />
      )}
      {route.name === 'splits' && (
        <SplitListScreen onBack={back}
          onCreate={() => go({ name:'split-create' })}
          onOpen={(id) => go({ name:'split-detail', id })} />
      )}
      {route.name === 'split-create' && (
        <SplitCreateScreen onClose={back} onDone={() => { setStack([]); setRoute({ name:'splits' }); }} />
      )}
      {route.name === 'split-detail' && (
        <SplitDetailScreen id={route.id} onBack={back} onClose={reset}
          onPin={() => go({ name:'split-pin' })} />
      )}
      {route.name === 'split-pin' && (
        <PinScreen open variant={tw.pinVariant} ctx="split"
          onClose={back} onComplete={() => { setStack([]); setRoute({ name:'splits' }); }} />
      )}

      {route.name === 'spaces' && (
        <SpacesScreen onBack={back}
          onOpen={(id) => go({ name:'space-detail', id })}
          onCreate={() => go({ name:'lounge-create' })} />
      )}
      {route.name === 'lounge-create' && (
        <LoungeCreateScreen onClose={back}
          onDone={() => { setStack([]); setRoute({ name:'spaces' }); }} />
      )}
      {route.name === 'space-detail' && (
        <SpaceDetailScreen id={route.id} onBack={back}
          onSetActive={() => { setTw('skin', route.id); reset(); }}
          onCustomize={() => go({ name:'space-customize' })}
          onBuyTicket={(e) => go({ name:'event-pin', event: e })}
          onCreateEvent={() => go({ name:'event-create', spaceId: route.id })}
          onManageEvent={(e) => go({ name:'event-manage', event: e, spaceId: route.id })} />
      )}
      {route.name === 'event-manage' && (
        <EventManageScreen event={route.event}
          accent={(SPACES_LIST.find(s=>s.id===route.spaceId)||{}).accent || '#fff'}
          onBack={back} onCancel={back} onEdit={back} />
      )}
      {route.name === 'space-customize' && <SpaceCustomizeScreen onBack={back} />}
      {route.name === 'event-create' && (
        <EventCreateScreen spaceId={route.spaceId} onClose={back}
          onDone={() => { setStack([]); setRoute({ name:'space-detail', id: route.spaceId }); }} />
      )}
      {route.name === 'event-pin' && (
        <PinScreen open variant={tw.pinVariant} ctx="evento"
          recipient={{ name: route.event.name, label:'Evento' }}
          amount={activeLote(route.event)?.priceA || 0} unit="Albers"
          onClose={back} onComplete={reset} />
      )}

      {route.name === 'atividade' && <AtividadeScreen onBack={back} balance={tw.balance} />}
      {route.name === 'perfil' && (
        <PerfilScreen onBack={back} onLogout={()=>{}} kycStatus={tw.kycStatus}
          onKYC={() => setTw('kycStatus', 'submitted')}
          onPin={(ctx) => go({ name:'perfil-pin', ctx })} />
      )}
      {route.name === 'perfil-pin' && (
        <PinScreen open variant={tw.pinVariant} ctx={route.ctx || 'handle'}
          onClose={back} onComplete={back} />
      )}
      {route.name === 'achar' && <AcharScreen onBack={back} />}

      {route.name === 'kyc' && (
        <FlowShell title="Verificação" subtitle="KYC" onClose={back}>
          <div style={{ fontSize:14, color:'rgba(255,255,255,0.65)', lineHeight:1.6, marginBottom:24 }}>
            Para carregar e descarregar, precisamos verificar sua identidade. O processo leva até 24h.
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {[
              { n:'1', t:'Documento com foto', s:'RG, CNH ou Passaporte' },
              { n:'2', t:'Selfie com prova de vida', s:'Movimento facial em vídeo curto' },
              { n:'3', t:'Comprovante de endereço', s:'Conta de luz, água ou telefone' },
            ].map(s => (
              <div key={s.n} style={{ padding:'14px 16px', background:'rgba(255,255,255,0.03)', border:'0.5px solid rgba(255,255,255,0.08)', borderRadius:12, display:'flex', gap:12 }}>
                <div style={{ width:26, height:26, borderRadius:13, background:'rgba(255,255,255,0.08)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:600, color:'#fff', flexShrink:0 }}>{s.n}</div>
                <div>
                  <div style={{ fontSize:14, color:'#fff', fontWeight:500 }}>{s.t}</div>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', marginTop:2 }}>{s.s}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ flex:1 }} />
          <PrimaryButton onClick={() => { setTw('kycStatus','submitted'); back(); }}>Iniciar verificação</PrimaryButton>
        </FlowShell>
      )}

      {/* Bottom nav — top-level routes only */}
      {(navActive || route.name === 'achar') && (
        <BottomNav active={route.name === 'achar' ? 'achar' : navActive} onNavigate={(id) => {
          if (id === 'achar') { setStack([{name:'home'}]); setRoute({ name:'achar' }); }
          else navTo(id);
        }} />
      )}

      <HomeIndicator />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Lounge skin">
          <TweakSelect label="Active lounge" value={tw.skin}
            onChange={(v) => setTw('skin', v)}
            options={[
              { value:'none', label:'USE ALBER (default)' },
              { value:'surf', label:'Surf Club' },
              { value:'nomads', label:'Nomads Club' },
              { value:'tech', label:'Tech Builders' },
              { value:'gourmet', label:'Gourmet Club (DONO)' },
            ]} />
        </TweakSection>

        <TweakSection label="PIN keyboard">
          <TweakRadio label="Variant" value={tw.pinVariant}
            onChange={(v) => setTw('pinVariant', v)}
            options={[
              { value:'pairgrid', label:'Pair' },
              { value:'twinrow', label:'Rows' },
              { value:'arc', label:'Split' },
            ]} />
        </TweakSection>

        <TweakSection label="Auth flows">
          <TweakSelect label="Entry point" value={tw.authStart}
            onChange={(v) => { setTw('authStart', v); if (v==='home') { setStack([]); setRoute({name:'home'}); } else { setStack([]); setRoute({ name: v }); } }}
            options={[
              { value:'home', label:'Home (logado)' },
              { value:'splash', label:'Splash' },
              { value:'welcome', label:'Boas-vindas' },
              { value:'onboarding', label:'Onboarding' },
              { value:'login', label:'Login' },
              { value:'forgot', label:'Esqueci PIN' },
            ]} />
        </TweakSection>

        <TweakSection label="Account state">
          <TweakSelect label="KYC" value={tw.kycStatus}
            onChange={(v) => setTw('kycStatus', v)}
            options={[
              { value:'pending', label:'Pendente' },
              { value:'submitted', label:'Em análise' },
              { value:'approved', label:'Aprovado' },
              { value:'rejected', label:'Reprovado' },
            ]} />
          <TweakNumber label="Saldo" value={tw.balance} min={0} max={9999} step={20} unit=" Albers"
            onChange={(v) => setTw('balance', v)} />
          <TweakToggle label="Conta em avaliação" value={tw.evaluation}
            onChange={(v) => setTw('evaluation', v)} />
        </TweakSection>
      </TweaksPanel>
    </PhoneFrame>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
