// Thirty prototype ideas for Kandy, each rendered as a mock screenshot.
// Every idea is {nav, title, lead, body}. `nav` is the active sidebar item.
// Bodies are HTML built from the building blocks in styles.css.

const wave = (n, dim = false) => {
  let s = `<div class="wave${dim ? " dim" : ""}">`;
  for (let i = 0; i < n; i++) {
    const h =
      6 + Math.round(30 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.3)));
    s += `<i style="height:${h}px"></i>`;
  }
  return s + "</div>";
};

const sidebar = (active, extra = "") => {
  const item = (key, label, badge = "") =>
    `<div class="item ${active === key ? "active" : "dim"}"><span class="ic"></span>${label}${badge}</div>`;
  return `
    <div class="logo"><span class="k">K</span>Kandy</div>
    <div class="group">BRUK</div>
    ${item("meeting", "Møte")}
    ${item("history", "Historikk")}
    ${extra}
    <div class="group">INNSTILLINGER</div>
    ${item("general", "Generelt")}
    ${item("models", "Modeller")}
    ${item("post", "Etterbehandling")}
    ${item("advanced", "Avansert")}
    <div class="spacer"></div>
    ${item("about", "Om")}`;
};

const meetingCard = (title, when, tags = "") =>
  `<div class="card"><div class="row between"><div><h3>${title}</h3><div class="sub">${when}</div></div><div class="row">${tags}</div></div></div>`;

const ideas = [
  {
    nav: "meeting",
    title: "Møte",
    lead: "Live transkripsjon mens opptaket pågår.",
    body: `
      <div class="hero rec">
        <div class="row between">
          <div class="row"><span class="badge coral">● Tar opp</span><span class="mono" style="font-size:22px">00:14:32</span></div>
          <span class="btn">■ Stopp</span>
        </div>
        ${wave(60, true)}
      </div>
      <div class="card stack">
        <div class="line"><span class="t">14:02</span><span></span><span>…og da tenker jeg at vi bør prioritere e-postklassifiseringen først, siden den har størst volum.</span></div>
        <div class="line"><span class="t">14:19</span><span></span><span>Enig. Hva med tidsplanen, rekker vi en pilot før jul</span></div>
        <div class="line"><span class="t">14:31</span><span></span><span class="cur">Hvis vi får data fra kundeservice innen uke 44 så<span class="cursor"></span></span></div>
      </div>`,
  },
  {
    nav: "meeting",
    title: "Oppstartsmøte for KI-pilot",
    lead: 'Taler-skille i transkripsjonen.<span class="exp">EKSPERIMENTELL</span>',
    body: `
      <div class="tabs"><span>Referat</span><span class="on">Transkripsjon</span></div>
      <div class="card stack">
        <div class="line"><span class="t">00:12</span><span class="spk s1">Taler 1</span><span>Velkommen, da setter vi i gang. Målet i dag er å lande omfanget for piloten.</span></div>
        <div class="line"><span class="t">00:28</span><span class="spk s2">Taler 2</span><span>Vi har to kandidater. E-postklassifisering og chat-oppsummering.</span></div>
        <div class="line"><span class="t">00:41</span><span class="spk s1">Taler 1</span><span>E-post har størst volum. Jeg foreslår at vi starter der.</span></div>
        <div class="line"><span class="t">00:55</span><span class="spk s3">Taler 3</span><span>Da trenger vi tilgang til arkivet. Jeg tar det med IT i morgen.</span></div>
        <div class="line"><span class="t">01:10</span><span class="spk s2">Taler 2</span><span>Fint. Da skriver jeg inn det som en avhengighet.</span></div>
      </div>
      <div class="legend"><span><b style="background:var(--coral)"></b>Taler 1</span><span><b style="background:var(--info)"></b>Taler 2</span><span><b style="background:var(--success)"></b>Taler 3</span></div>`,
  },
  {
    nav: "meeting",
    title: "Oppstartsmøte for KI-pilot",
    lead: "Gi talerne navn etter møtet.",
    body: `
      <div class="card">
        <h3>Hvem er hvem?</h3>
        <div class="sub">Navnene brukes i transkripsjon og referat. Lagres bare lokalt.</div>
        <div class="stack" style="margin-top:12px">
          <div class="row"><span class="spk s1" style="min-width:70px">Taler 1</span><div class="search grow" style="padding:7px 12px;color:var(--purple)">Nora</div><span class="muted small">12 min</span></div>
          <div class="row"><span class="spk s2" style="min-width:70px">Taler 2</span><div class="search grow" style="padding:7px 12px;color:var(--purple)">Jonas</div><span class="muted small">9 min</span></div>
          <div class="row"><span class="spk s3" style="min-width:70px">Taler 3</span><div class="search grow" style="padding:7px 12px">Navn …</div><span class="muted small">3 min</span></div>
        </div>
      </div>
      <div class="card stack">
        <div class="quote">"Jeg tar det med IT i morgen."</div>
        <div class="row"><span class="btn ghost" style="color:var(--purple);border-color:var(--line)">▶ Spill av 00:55</span><span class="muted small">Lytt for å kjenne igjen stemmen</span></div>
      </div>`,
  },
  {
    nav: "meeting",
    title: "Oppstartsmøte for KI-pilot",
    lead: "Handlingspunkter trukket ut av referatet.",
    body: `
      <div class="tabs"><span class="on">Referat</span><span>Handlingspunkter</span><span>Transkripsjon</span></div>
      <div class="card">
        <div class="section">HANDLINGSPUNKTER</div>
        <div class="check"><b class="on"></b><span>Be IT om tilgang til e-postarkivet <span class="badge">Taler 3</span> <span class="badge info">i morgen</span></span></div>
        <div class="check"><b></b><span>Sette opp evalueringssett med 200 e-poster <span class="badge">Nora</span> <span class="badge info">uke 44</span></span></div>
        <div class="check"><b></b><span>Avklare personvernvurdering med DPO <span class="badge">Jonas</span></span></div>
        <div class="check"><b></b><span>Book statusmøte annenhver uke</span></div>
      </div>
      <div class="row"><span class="btn outline sm">Kopier som liste</span><span class="btn outline sm">Eksporter til Markdown</span></div>`,
  },
  {
    nav: "meeting",
    title: "Møte",
    lead: "Søk på tvers av møter med treff i kontekst.",
    body: `
      <div class="search" style="color:var(--purple)">🔍 personvernvurdering</div>
      <div class="section">3 TREFF I 2 MØTER</div>
      <div class="card">
        <h3>Oppstartsmøte for KI-pilot</h3><div class="sub">30. september 2026</div>
        <div class="quote" style="margin-top:8px">"…avklare <b>personvernvurdering</b> med DPO før vi henter ut data."</div>
        <div class="quote" style="margin-top:6px">"…den <b>personvernvurderingen</b> fra i fjor dekker ikke e-post."</div>
      </div>
      <div class="card">
        <h3>Kantega om modellering og styring av inneklima</h3><div class="sub">1. oktober 2026</div>
        <div class="quote" style="margin-top:8px">"…sensordata er ikke personopplysninger, så ingen <b>personvernvurdering</b> trengs."</div>
      </div>`,
  },
  {
    nav: "meeting",
    title: "Oppstartsmøte for KI-pilot",
    lead: "Tidslinje med klikkbar lyd per avsnitt.",
    body: `
      <div class="card stack">
        <div class="row"><span class="btn sm">▶</span><span class="mono small">14:02 / 47:10</span><div class="grow"><div class="timeline"><i class="a" style="left:0;width:30%"></i><i class="b" style="left:30%;width:22%"></i><i class="a" style="left:52%;width:18%"></i><i class="c" style="left:70%;width:30%"></i></div></div></div>
        <div class="legend"><span><b style="background:var(--coral)"></b>Innledning</span><span><b style="background:var(--info)"></b>Omfang</span><span><b style="background:var(--success)"></b>Neste steg</span></div>
      </div>
      <div class="card stack">
        <div class="line"><span class="t">13:40</span><span></span><span>Vi må bestemme oss for ett bruksområde først.</span></div>
        <div class="line"><span class="t">14:02</span><span></span><span class="cur">E-post har størst volum. Jeg foreslår at vi starter der.</span></div>
        <div class="line"><span class="t">14:19</span><span></span><span>Enig. Hva med tidsplanen?</span></div>
      </div>`,
  },
  {
    nav: "meeting",
    title: "Styremøte BOB 12. oktober",
    lead: "Automatiske kapitler i lange møter.",
    body: `
      <div class="cols" style="grid-template-columns: 240px 1fr">
        <div class="card stack">
          <div class="section">KAPITLER</div>
          <div class="row"><span class="t">00:00</span><span>Godkjenning av innkalling</span></div>
          <div class="row"><span class="t">04:12</span><span>Økonomirapport Q3</span></div>
          <div class="row" style="color:var(--coral);font-weight:600"><span class="t">21:40</span><span>KI-målbilde</span></div>
          <div class="row"><span class="t">48:05</span><span>Styreportal, status</span></div>
          <div class="row"><span class="t">63:30</span><span>Eventuelt</span></div>
        </div>
        <div class="card stack">
          <h3>KI-målbilde</h3>
          <div class="sub">21:40 til 48:05, 26 minutter</div>
          <p style="margin:6px 0;font-size:14px">Styret diskuterte de fem metodikkene fra workshopen og ba administrasjonen prioritere to av dem til neste møte. Risiko knyttet til datakvalitet ble løftet som hovedbekymring.</p>
          <div class="row wrap"><span class="badge">beslutning</span><span class="badge">risiko</span><span class="badge">oppfølging</span></div>
        </div>
      </div>`,
  },
  {
    nav: "advanced",
    title: "Avansert",
    lead: "Ordlister per kunde eller prosjekt.",
    body: `
      <div class="card">
        <div class="row between"><h3>Ordlister</h3><span class="btn outline sm">+ Ny liste</span></div>
        <div class="setting"><div><b>BOB</b><div class="d">Styreportalen, Kantega, borettslag, generalforsamling …</div></div><span class="badge coral">Aktiv</span></div>
        <div class="setting"><div><b>Digdir</b><div class="d">agentidentitet, Altinn, ID-porten, Sopra Steria …</div></div><span class="toggle"></span></div>
        <div class="setting"><div><b>AAKP</b><div class="d">veiviser, modul 2, kompetanseplan …</div></div><span class="toggle"></span></div>
        <div class="setting"><div><b>Internt</b><div class="d">LLM-proxy, Kandy, Conscia …</div></div><span class="toggle on"></span></div>
      </div>
      <div class="card"><div class="sub">Lister som er på, slås sammen og brukes som ordforråd for Whisper og som rettelser etterpå.</div></div>`,
  },
  {
    nav: "general",
    title: "Generelt",
    lead: "Diktering med live tekst i overlayet.",
    body: `
      <div class="desktop">
        <div class="stack" style="align-items:center;gap:14px">
          <div class="popover" style="width:420px"><div class="row"><span class="badge coral">●</span><span>Send meg utkastet til tilbudet innen fredag, og legg ved<span class="cursor"></span></span></div></div>
          <div class="overlay-pill">${wave(18, true)}<span class="mono">0:07</span><span class="kbd" style="background:rgba(255,255,255,0.15);color:#fff;border-color:transparent">fn</span></div>
        </div>
      </div>`,
  },
  {
    nav: "meeting",
    title: "Oppstartsmøte for KI-pilot",
    lead: "Eksporter referatet dit det skal brukes.",
    body: `
      <div class="card">
        <h3>Eksporter</h3>
        <div class="cols3" style="margin-top:10px">
          <div class="chip on">Markdown</div><div class="chip">Word</div><div class="chip">PDF</div>
          <div class="chip">Confluence-side</div><div class="chip">Teams-melding</div><div class="chip">E-post</div>
        </div>
      </div>
      <div class="card stack">
        <div class="section">FORHÅNDSVISNING</div>
        <div class="mono small" style="white-space:pre-line;line-height:1.5"># Oppstartsmøte for KI-pilot
30. september 2026, 47 min, 3 deltakere

## Beslutninger
- Piloten starter med e-postklassifisering

## Handlingspunkter
- [ ] Tilgang til e-postarkiv (IT, i morgen)
- [ ] Evalueringssett med 200 e-poster (uke 44)</div>
      </div>`,
  },
  {
    nav: "meeting",
    title: "Møte",
    lead: "Velg møtemal før opptaket starter.",
    body: `
      <div class="hero">
        <div class="row wrap" style="justify-content:center">
          <span class="chip on">Kundemøte</span><span class="chip" style="background:rgba(255,255,255,0.12);color:#fff">Standup</span><span class="chip" style="background:rgba(255,255,255,0.12);color:#fff">Retro</span><span class="chip" style="background:rgba(255,255,255,0.12);color:#fff">Intervju</span><span class="chip" style="background:rgba(255,255,255,0.12);color:#fff">Fritt</span>
        </div>
        <span class="btn">🎙 Start opptak</span>
        <span class="small" style="opacity:0.8">Kundemøte: referat med behov, beslutninger, neste steg og åpne spørsmål.</span>
      </div>
      <div class="card"><div class="section">MALEN STYRER PROMPTEN</div><div class="textarea mono small" style="min-height:60px">Du skriver referat fra et kundemøte. Strukturer som: Kundens behov, Beslutninger, Neste steg, Åpne spørsmål. Bokmål.</div></div>`,
  },
  {
    nav: "meeting",
    title: "Møte",
    lead: "Foreslå tittel og deltakere fra kalenderen.",
    body: `
      <div class="card">
        <div class="row between"><div><h3>Nå: Statusmøte Digdir mini-workshop</h3><div class="sub">13:00 til 14:00 · 4 deltakere · Teams</div></div><span class="btn sm">Bruk som tittel</span></div>
      </div>
      <div class="hero"><span class="btn">🎙 Start opptak</span><span class="small" style="opacity:0.8">Kalender leses lokalt fra macOS. Ingenting sendes.</span></div>
      <div class="section">TIDLIGERE MØTER</div>
      ${meetingCard("KI-foredrag for keepertrenere", "Mandag 14:50")}`,
  },
  {
    nav: "general",
    title: "Generelt",
    lead: "Ta opp både mikrofon og systemlyd.",
    body: `
      <div class="card">
        <div class="setting"><div><b>Mikrofon</b><div class="d">MacBook Pro-mikrofon</div></div><span class="toggle on"></span></div>
        <div class="setting"><div><b>Systemlyd</b><div class="d">Fanger de andre i Teams og Zoom, også med hodetelefoner. Krever skjermopptak-tillatelse.</div></div><span class="toggle on"></span></div>
        <div class="setting"><div><b>Egen kanal per kilde</b><div class="d">Gjør det lettere å skille deg fra de andre i transkripsjonen.</div></div><span class="toggle on"></span></div>
      </div>
      <div class="card stack"><div class="section">NIVÅ</div><div class="row"><span class="t">Mik</span><div class="bar grow"><i style="width:62%"></i></div></div><div class="row"><span class="t">System</span><div class="bar info grow"><i style="width:35%"></i></div></div></div>`,
  },
  {
    nav: "meeting",
    title: "Kickoff with the Oslo team",
    lead: "Språk oppdages per avsnitt.",
    body: `
      <div class="card stack">
        <div class="line"><span class="t">00:04</span><span class="badge">nb</span><span>Da kjører vi i gang. Vi har en gjest fra London i dag, så vi tar det på engelsk.</span></div>
        <div class="line"><span class="t">00:15</span><span class="badge info">en</span><span>Thanks. Quick intro: I lead the data platform team and I'm here to understand the pilot scope.</span></div>
        <div class="line"><span class="t">00:32</span><span class="badge info">en</span><span>We've seen good results with email classification elsewhere.</span></div>
        <div class="line"><span class="t">00:48</span><span class="badge">nb</span><span>Jonas, kan du ta oss gjennom datagrunnlaget?</span></div>
      </div>
      <div class="card"><div class="row between"><span>Referat på</span><div class="row"><span class="chip on">Norsk</span><span class="chip">Engelsk</span><span class="chip">Begge</span></div></div></div>`,
  },
  {
    nav: "models",
    title: "Modeller",
    lead: "Sammenlign to modeller på samme opptak.",
    body: `
      <div class="card"><div class="row between"><span>Testklipp: <b>intern-standup.wav</b> (1:12)</span><span class="btn sm">Kjør begge</span></div></div>
      <div class="cols">
        <div class="card stack"><div class="row between"><h3>Whisper Large v3</h3><span class="badge">8,4 s</span></div><p class="small" style="margin:0">Vi må få på plass tilgang til arkivet før vi kan starte eval av lykke setting med kundeservice.</p></div>
        <div class="card stack" style="box-shadow:0 0 0 2px var(--coral)"><div class="row between"><h3>NB-Whisper Large</h3><span class="badge">9,1 s</span></div><p class="small" style="margin:0">Vi må få på plass tilgang til arkivet før vi kan starte evalueringen med kundeservice.</p></div>
      </div>
      <div class="card"><div class="row between"><span class="small muted">Ulike ord markert: 3</span><span class="btn outline sm">Velg NB-Whisper Large</span></div></div>`,
  },
  {
    nav: "models",
    title: "Modeller",
    lead: "Mål nøyaktighet på din egen stemme.",
    body: `
      <div class="card">
        <h3>Les opp denne teksten</h3>
        <p style="font-size:16px;line-height:1.5;margin:6px 0">«Kantega leverer skreddersydde løsninger til offentlig sektor, og i år har vi tre nye KI-piloter i Bergen.»</p>
        <span class="btn">🎙 Ta opp</span>
      </div>
      <div class="card stack">
        <div class="section">RESULTAT PER MODELL</div>
        <div class="row"><span style="min-width:170px">NB-Whisper Large</span><div class="bar ok grow"><i style="width:96%"></i></div><span class="mono small">96 %</span></div>
        <div class="row"><span style="min-width:170px">Whisper Large v3</span><div class="bar ok grow"><i style="width:91%"></i></div><span class="mono small">91 %</span></div>
        <div class="row"><span style="min-width:170px">Whisper Small</span><div class="bar grow"><i style="width:78%"></i></div><span class="mono small">78 %</span></div>
      </div>`,
  },
  {
    nav: "about",
    title: "Personvern",
    lead: "Hva har forlatt maskinen, og når.",
    body: `
      <div class="cols3">
        <div class="card"><div class="stat">0<small>lydklipp sendt ut</small></div></div>
        <div class="card"><div class="stat">14<small>referat via LLM-proxy</small></div></div>
        <div class="card"><div class="stat">2,1 GB<small>lagret lokalt</small></div></div>
      </div>
      <div class="card">
        <table class="table">
          <tr><th>TID</th><th>HVA</th><th>MOTTAKER</th><th>TEGN</th></tr>
          <tr><td>i dag 14:52</td><td>Referat, Oppstartsmøte KI-pilot</td><td>llm-proxy.kantega.no</td><td>12 480</td></tr>
          <tr><td>i går 09:10</td><td>Tittelforslag</td><td>llm-proxy.kantega.no</td><td>640</td></tr>
          <tr><td>1. okt</td><td>Etterbehandling, diktat</td><td>llm-proxy.kantega.no</td><td>310</td></tr>
        </table>
      </div>`,
  },
  {
    nav: "meeting",
    title: "Oppstartsmøte for KI-pilot",
    lead: "Rediger transkripsjonen med lyden synkronisert.",
    body: `
      <div class="card stack">
        <div class="row"><span class="btn sm">▶</span><span class="mono small">00:41</span><div class="grow">${wave(70)}</div></div>
      </div>
      <div class="card">
        <p style="font-size:15px;line-height:1.8;margin:0">E-post har størst volum. Jeg foreslår at vi <span class="cur" style="outline:2px solid var(--coral)">starter der</span>. Da trenger vi tilgang til arkivet, og det <span style="text-decoration:underline wavy var(--coral)">tar jeg med IT</span> i morgen.</p>
        <div class="row" style="margin-top:10px"><span class="small muted">Klikk på et ord for å høre det. Endringer lagres når du går videre.</span></div>
      </div>`,
  },
  {
    nav: "meeting",
    title: "Oppstartsmøte for KI-pilot",
    lead: "Still spørsmål til møtet.",
    body: `
      <div class="stack" style="flex:1">
        <div class="chat me">Hva ble sagt om tidsplan?</div>
        <div class="chat">Tidsplanen ble diskutert rundt 14:19. Jonas spurte om en pilot før jul er realistisk. Nora svarte at det avhenger av data fra kundeservice innen uke 44. Ingen dato ble vedtatt.</div>
        <div class="chat me">Hvem skulle snakke med IT?</div>
        <div class="chat">Taler 3 sa «Jeg tar det med IT i morgen» (00:55).</div>
      </div>
      <div class="search" style="display:flex;justify-content:space-between"><span>Spør om dette møtet …</span><span class="muted small">via LLM-proxy</span></div>`,
  },
  {
    nav: "meeting",
    title: "Oppstartsmøte for KI-pilot",
    lead: "Oversett referatet.",
    body: `
      <div class="row between"><div class="tabs"><span class="on">Norsk</span><span>English</span><span>Nynorsk</span></div><span class="btn outline sm">Oversett</span></div>
      <div class="cols">
        <div class="card"><div class="section">NORSK</div><p class="small" style="line-height:1.6">Møtet landet på at piloten starter med e-postklassifisering. IT kontaktes for arkivtilgang. Evalueringssett lages innen uke 44.</p></div>
        <div class="card"><div class="section">ENGLISH</div><p class="small" style="line-height:1.6">The meeting agreed that the pilot starts with email classification. IT will be contacted for archive access. An evaluation set will be ready by week 44.</p></div>
      </div>`,
  },
  {
    nav: "meeting",
    title: "Oppstartsmøte for KI-pilot",
    lead: "Taletid per deltaker.",
    body: `
      <div class="cols3">
        <div class="card"><div class="stat">47 min<small>total</small></div></div>
        <div class="card"><div class="stat">3<small>talere</small></div></div>
        <div class="card"><div class="stat">18<small>talerbytter per 10 min</small></div></div>
      </div>
      <div class="card stack">
        <div class="row"><span class="spk s1" style="min-width:80px">Nora</span><div class="bar grow"><i style="width:52%"></i></div><span class="mono small">24 min</span></div>
        <div class="row"><span class="spk s2" style="min-width:80px">Jonas</span><div class="bar info grow"><i style="width:36%"></i></div><span class="mono small">17 min</span></div>
        <div class="row"><span class="spk s3" style="min-width:80px">Taler 3</span><div class="bar ok grow"><i style="width:12%"></i></div><span class="mono small">6 min</span></div>
      </div>`,
  },
  {
    nav: "history",
    title: "Historikk",
    lead: "Fyllord og tempo over tid.",
    body: `
      <div class="cols3">
        <div class="card"><div class="stat">142<small>ord per minutt, snitt</small></div></div>
        <div class="card"><div class="stat">3,1 %<small>fyllord siste 30 dager</small></div></div>
        <div class="card"><div class="stat">↓ 0,8<small>siden forrige måned</small></div></div>
      </div>
      <div class="card">
        <table class="table">
          <tr><th>FYLLORD</th><th>ANTALL</th><th>ANDEL</th></tr>
          <tr><td>eh</td><td>212</td><td>1,4 %</td></tr>
          <tr><td>liksom</td><td>96</td><td>0,6 %</td></tr>
          <tr><td>på en måte</td><td>71</td><td>0,5 %</td></tr>
          <tr><td>altså</td><td>60</td><td>0,4 %</td></tr>
        </table>
      </div>`,
  },
  {
    nav: "meeting",
    title: "Oppstartsmøte for KI-pilot",
    lead: "Spørsmål som ble stilt, men ikke besvart.",
    body: `
      <div class="card">
        <div class="section">ÅPNE SPØRSMÅL</div>
        <div class="check"><b></b><span>Rekker vi en pilot før jul? <span class="muted small">14:19, Jonas</span></span></div>
        <div class="check"><b></b><span>Hvem eier modellen etter piloten? <span class="muted small">22:04, Taler 3</span></span></div>
        <div class="check"><b></b><span>Trenger vi en ny DPIA for e-post? <span class="muted small">31:40, Nora</span></span></div>
      </div>
      <div class="card">
        <div class="section">BESVART</div>
        <div class="check"><b class="on"></b><span class="muted">Hvilket bruksområde starter vi med? <span class="small">E-post, 14:02</span></span></div>
      </div>`,
  },
  {
    nav: "history",
    title: "Beslutninger",
    lead: "Beslutningslogg på tvers av alle møter.",
    body: `
      <div class="search">🔍 Filtrer på kunde, person eller tema …</div>
      <div class="card">
        <table class="table">
          <tr><th>DATO</th><th>BESLUTNING</th><th>MØTE</th><th></th></tr>
          <tr><td>30. sep</td><td>Piloten starter med e-postklassifisering</td><td>Oppstartsmøte KI-pilot</td><td><span class="badge ok">vedtatt</span></td></tr>
          <tr><td>1. okt</td><td>Bruke LightGBM for ventilasjonsplan</td><td>Inneklima i bygg</td><td><span class="badge ok">vedtatt</span></td></tr>
          <tr><td>6. okt</td><td>Workshop i uke 42 for styreportal</td><td>BOB planlegging</td><td><span class="badge warn">forslag</span></td></tr>
          <tr><td>8. okt</td><td>Agentidentitet som spiss for Digdir</td><td>Digdir forberedelse</td><td><span class="badge ok">vedtatt</span></td></tr>
        </table>
      </div>`,
  },
  {
    nav: "meeting",
    title: "Oppstartsmøte for KI-pilot",
    lead: 'Les opp referatet.<span class="exp">EKSPERIMENTELL</span>',
    body: `
      <div class="card stack">
        <div class="row"><span class="btn">▶ Les opp</span><span class="chip on">Norsk stemme</span><span class="chip">1,0×</span><span class="chip">1,25×</span></div>
        <div class="row"><span class="mono small">0:42 / 2:10</span><div class="grow"><div class="timeline"><i class="a" style="left:0;width:32%"></i></div></div></div>
      </div>
      <div class="card"><p style="font-size:15px;line-height:1.7;margin:0">Møtet landet på at <span class="cur">piloten starter med e-postklassifisering</span>. IT kontaktes for arkivtilgang, og et evalueringssett lages innen uke 44. Åpne spørsmål gjelder tidsplan og eierskap til modellen.</p></div>`,
  },
  {
    nav: "meeting",
    title: "Oppstartsmøte for KI-pilot",
    lead: "Del møtet som én kryptert fil.",
    body: `
      <div class="card">
        <h3>Del møtet</h3>
        <div class="check"><b class="on"></b><span>Referat</span></div>
        <div class="check"><b class="on"></b><span>Transkripsjon</span></div>
        <div class="check"><b></b><span>Lydopptak (47 MB)</span></div>
        <div class="setting" style="margin-top:6px"><div><b>Passord</b><div class="d">Mottaker åpner fila i nettleseren, uten installasjon.</div></div><div class="search" style="padding:6px 10px;width:180px">••••••••</div></div>
      </div>
      <div class="row"><span class="btn">Lag fil</span><span class="muted small">oppstartsmote-ki-pilot.kandy.html</span></div>`,
  },
  {
    nav: "general",
    title: "Generelt",
    lead: "Miniopptaker i menylinjen.",
    body: `
      <div class="desktop" style="place-items:start end;padding:10px">
        <div class="stack" style="align-items:flex-end;gap:8px">
          <div class="menubar"><span>🔋</span><span>📶</span><span class="badge coral">● 12:04</span><span>ons. 9. okt 13:12</span></div>
          <div class="popover stack">
            <div class="row between"><b>Statusmøte Digdir</b><span class="mono">12:04</span></div>
            ${wave(30)}
            <div class="row"><span class="btn sm">■ Stopp og transkribér</span><span class="btn outline sm">Pause</span></div>
            <div class="small muted">Referat lages automatisk</div>
          </div>
        </div>
      </div>`,
  },
  {
    nav: "meeting",
    title: "Møte",
    lead: "Importkø for gamle opptak.",
    body: `
      <div class="dropzone">Slipp lydfiler her, eller velg en mappe</div>
      <div class="card">
        <div class="section">KØ · 2 AV 6 FERDIG</div>
        <div class="setting"><div><b>2026-09-12 kundemøte.m4a</b><div class="d">Transkribert og oppsummert</div></div><span class="badge ok">ferdig</span></div>
        <div class="setting"><div><b>2026-09-15 standup.mp3</b><div class="d">Transkribert og oppsummert</div></div><span class="badge ok">ferdig</span></div>
        <div class="setting"><div><b>2026-09-19 workshop del 1.wav</b><div class="d">Transkriberer, 62 %</div></div><div class="bar" style="width:120px"><i style="width:62%"></i></div></div>
        <div class="setting"><div><b>2026-09-19 workshop del 2.wav</b><div class="d">Venter</div></div><span class="badge">i kø</span></div>
        <div class="setting"><div><b>intervju-kandidat-3.m4a</b><div class="d">Venter</div></div><span class="badge">i kø</span></div>
      </div>`,
  },
  {
    nav: "general",
    title: "Generelt",
    lead: "Undertekster i sanntid i eget vindu.",
    body: `
      <div class="desktop" style="place-items:end center">
        <div class="stack" style="align-items:center;gap:10px;width:100%">
          <div class="caption-box" style="max-width:720px">…så hvis vi får data fra kundeservice innen uke 44, rekker vi en pilot før jul</div>
          <div class="overlay-pill" style="font-size:12px"><span>Undertekster</span><span class="kbd" style="background:rgba(255,255,255,0.15);color:#fff;border-color:transparent">⌘⇧C</span><span>Alltid øverst</span></div>
        </div>
      </div>`,
  },
  {
    nav: "models",
    title: "Modeller",
    lead: "Helse og ressursbruk.",
    body: `
      <div class="cols3">
        <div class="card"><div class="stat">3,4 GB<small>modeller på disk</small></div></div>
        <div class="card"><div class="stat">Metal<small>aktiv beregningsenhet</small></div></div>
        <div class="card"><div class="stat">11×<small>raskere enn sanntid</small></div></div>
      </div>
      <div class="card">
        <table class="table">
          <tr><th>MODELL</th><th>STØRRELSE</th><th>SIST BRUKT</th><th></th></tr>
          <tr><td>NB-Whisper Large <span class="badge">Eksperimentell</span></td><td>1,0 GB</td><td>i dag</td><td><span class="badge coral">aktiv</span></td></tr>
          <tr><td>Whisper Large v3</td><td>1,1 GB</td><td>i går</td><td></td></tr>
          <tr><td>Nemotron 3.5 ASR <span class="badge">Eksperimentell</span></td><td>751 MB</td><td>3 dager siden</td><td></td></tr>
          <tr><td>Whisper Small</td><td>582 MB</td><td>august</td><td><span class="btn outline sm">Slett</span></td></tr>
        </table>
      </div>`,
  },
];

function renderWindow(idea, index) {
  return `
    <div class="win">
      <div class="titlebar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="name">Kandy</span></div>
      <div class="body">
        <div class="sidebar">${sidebar(idea.nav)}</div>
        <div class="main">
          <h1>${idea.title}</h1>
          <div class="lead">${idea.lead}</div>
          ${idea.body}
        </div>
      </div>
    </div>`;
}
