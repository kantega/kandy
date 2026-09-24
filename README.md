# Kandy

## Ta i bruk Kandy (for alle Mac-brukere i Kantega)

Kandy er Kantegas egen transkibering og møtereferat. Alt du sier transkriberes
**lokalt på din Mac**. Ingenting går til OpenAI, Microsoft eller Google.
Det eneste som kan forlate maskinen er tekst til Kantega LLM-proxy, og
bare hvis du legger inn nøkkel og bruker referat eller etterbehandling.

Det finnes ingen ferdig installasjonsfil ennå, så appen bygges på din
egen maskin. Det tar 10 til 20 minutter første gang og krever ingen
programmeringskunnskap. Kopier én blokk om gangen inn i Terminal.

**1. Installer verktøyene** (hopp over det du allerede har).

```bash
xcode-select --install
```

```bash
curl -fsSL https://bun.sh/install | bash
```

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Lukk Terminal og åpne den igjen etter dette.

**2. Hent og bygg Kandy.**

```bash
git clone https://github.com/kantega/kandy.git
```

```bash
cd kandy && bun install
```

```bash
bun run tauri build
```

**Stopper bygget?** Den vanligste feilen er `cmake` policy error. Bygg
med `CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri build`.

`bun run tauri` legger `/usr/bin` først på `PATH`, så et Python-miljø
kan ikke skygge systemets `xattr` og gi `failed to run xattr`.

Flere feil og varige fikser står i [BUILD.md](BUILD.md#vanlige-feil).

Bygget ligger i `src-tauri/target/release/bundle/dmg/`. Åpne `.dmg`-fila
og dra Kandy til Programmer. Første gang: høyreklikk på Kandy i
Programmer og velg **Åpne**, siden bygget ikke er signert av Apple.

**3. Sett opp appen.**

1. Gi mikrofon- og tilgjengelighetstillatelse når du blir spurt.
2. Velg **Whisper Large v3** som modell (best på norsk, lastes ned én gang).
3. Sett en hurtigtast under **Generelt**.
4. Hold hurtigtasten, snakk, slipp. Teksten limes inn der markøren står.
5. Vil du ha referat fra møter? Legg inn Kantega LLM-proxy-nøkkelen din
   under **Modeller**, gå til **Møte**, trykk **Start opptak**, og få transkripsjon, norsk
   referat og en foreslått tittel når du stopper.

**Oppdatere senere:** `cd kandy && git pull && bun run tauri build`, og
dra den nye appen til Programmer.

---

## Hva Kandy gjør

- **Transkibering.** Hurtigtast, snakk, tekst limes inn i aktivt vindu.
- **Etterbehandling.** Valgfritt: en språkmodell via Kantega LLM-proxy
  rydder i tegnsetting, tall og fyllord. Skru på «Etterbehandle
  automatisk» for alle transkiberinger, eller bruk egen hurtigtast for én.
- **Møtereferat.** Ta opp eller dra inn en lydfil, få transkripsjon og
  norsk referat. Referat kan lages automatisk eller på knappetrykk, og
  promptet kan tilpasses per møte.
- **Historikk.** Alt du har diktert, med lyd, søkbart og eksporterbart til
  Word, PDF og Markdown.

Kandy kjører Whisper lokalt på GPU via Metal.
Whisper er valgt fordi det er den eneste lokale modellfamilien med god
norsk.

## Personvern

| Data                           | Hvor                         |
| ------------------------------ | ---------------------------- |
| Lydopptak                      | Lokalt                       |
| Transkripsjon og historikk     | Lokalt                       |
| Modeller                       | Lokalt                       |
| Tekst til referat/etterbehand. | Kantega LLM-proxy over HTTPS |

Kantega drifter proxyen selv og bruker kun modeller hostet i Europa.

Alt lagres under `~/Library/Application Support/no.kantega.kandy/`.

Slett mappa for å nullstille appen.

## Kjente begrensninger

- **Kandy tar opp det mikrofonen hører.** I et Teams- eller Zoom-møte
  fanger den de andre deltakerne bare når lyden deres spilles over
  høyttaler, slik at mikrofonen plukker den opp. Med hodetelefoner tas
  bare din egen stemme opp. Bruk høyttaler, eller rut møtelyden til en
  virtuell mikrofon (BlackHole).
- **`fn`/Globe-tasten fungerer bare på Apple-tastaturer.** Bruk vanlige
  modifikatorer om du bytter tastatur.
- **Ingen Mac App Store.** Kandy bruker globale hurtigtaster som App
  Store-sandkassen ikke tillater. Distribueres som `.dmg`.
- **Kun macOS.** Ingen Windows- eller Linux-støtte.

## For utviklere

- [BUILD.md](BUILD.md). Bygg fra kilde, CLI-flagg, vanlige feil.
- [CONTRIBUTING.md](CONTRIBUTING.md). Kodestil, oversettelser, PR-flyt.
- [AGENTS.md](AGENTS.md). Arkitektur for mennesker og KI-assistenter.

## Kreditt og lisens

Kandy er en fork av [Handy](https://github.com/cjpais/Handy) av CJ Pais.
Bygger på [Whisper](https://github.com/openai/whisper) via
[transcribe.cpp](https://github.com/ggerganov/whisper.cpp),
[Silero VAD](https://github.com/snakers4/silero-vad) og
[Tauri](https://tauri.app).

MIT. Se [LICENSE](LICENSE).
