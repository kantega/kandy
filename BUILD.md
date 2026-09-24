# Bygging fra kilde

For utviklere. Brukere skal ha et ferdig bygg, se [README.md](README.md).

## Forutsetninger

- [Rust](https://rustup.rs/) (siste stabile)
- [Bun](https://bun.sh)
- [Tauri prerequisites](https://tauri.app/start/prerequisites/)

Kun macOS. Kjør `xcode-select --install` først.

## Bygg

```bash
bun install
bun run tauri dev      # utvikling
bun run tauri build    # produksjon
```

Første `tauri dev` laster ned Silero VAD-modellen. Hvis nettet blokkerer:

```bash
mkdir -p src-tauri/resources/models
curl -o src-tauri/resources/models/silero_vad_v4.onnx \
  https://blob.handy.computer/silero_vad_v4.onnx
```

Før commit:

```bash
bun run lint:fix
bun run format
```

## CLI-flagg

| Flagg                    | Effekt                                 |
| ------------------------ | -------------------------------------- |
| `--toggle-transcription` | Start/stopp opptak i kjørende instans  |
| `--toggle-post-process`  | Start/stopp opptak med etterbehandling |
| `--cancel`               | Avbryt pågående operasjon              |
| `--start-hidden`         | Start uten hovedvindu                  |
| `--no-tray`              | Start uten tray-ikon                   |
| `--debug`                | Trace-logging                          |

Hodeløs transkribering og diagnostikk. Kjører uten mikrofon og avslutter
når de er ferdige. Modellen må være installert.

| Flagg                           | Effekt                                  |
| ------------------------------- | --------------------------------------- |
| `-f`, `--transcribe-file <WAV>` | Transkriber 16 kHz mono-WAV og avslutt  |
| `--model <ID>`                  | Modell-id (standard: valgt modell)      |
| `--device-index <N>`            | Velg compute-enhet, se `--list-devices` |
| `--list-devices`                | List compute-enheter                    |
| `--list-models`                 | List modeller                           |
| `--repeat <N>`                  | Gjenta N ganger, `best_ms` er raskeste  |
| `--json`                        | Maskinlesbar utskrift                   |

På macOS kalles binæren i app-bundlet:

```bash
/Applications/Kandy.app/Contents/MacOS/Kandy --toggle-transcription
```

## Vanlige feil

**macOS: `cmake` policy error.**

```bash
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri dev
```

**macOS: `failed to bundle project: failed to run xattr`.**
Et Python-miljø (typisk `pyenv`) skygger `/usr/bin/xattr`. Skriptet
`tauri` i `package.json` legger `/usr/bin` først på `PATH` og unngår
dette. Kjører du `tauri`-CLI-et direkte, uten `bun run`, må du gjøre det
samme selv:

```bash
PATH=/usr/bin:$PATH bunx tauri build
```

Feiler det fortsatt, kjør
`xattr -crs src-tauri/target/release/bundle/macos/Kandy.app` for å se
den egentlige feilen. Vanlige årsaker er skrivebeskyttede filer under
`src-tauri/resources/` eller at repoet ligger i en iCloud-synket mappe.
