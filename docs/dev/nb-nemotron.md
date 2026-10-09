# NB Nemotron: konvertere Nasjonalbibliotekets .nemo til GGUF

Nasjonalbibliotekets `nb-asr-nemotron35-*` er finjusteringer av
`nvidia/nemotron-3.5-asr-streaming-0.6b`. Kandy laster parakeet-familien via
transcribe-cpp, men bare i GGUF-format. NB publiserer `.nemo`, så fila må
konverteres med transcribe.cpp sitt konverteringsverktøy. Repoene er gated på
Hugging Face og krever godkjent tilgang.

## Forutsetninger

- Godkjent tilgang til modellrepoet på Hugging Face (be om tilgang på
  modellsiden, vent på godkjenning).
- Innlogget `hf`-CLI (`hf auth login`). Token lagres av CLI-en utenfor repoet.
- `uv`, `cmake` og Xcode command line tools.

## Steg

```bash
# 1. Hent transcribe.cpp og bygg CLI + quantize
git clone https://github.com/handy-computer/transcribe.cpp ~/Documents/github/transcribe.cpp
cd ~/Documents/github/transcribe.cpp
cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j

# 2. Last ned .nemo
REPO=NbAiLab/nb-asr-nemotron35-lunde07-reading-optimised-150k
uv run --with huggingface_hub hf download "$REPO" \
  --include "*.nemo" "README.md" "SHA256SUMS" \
  --local-dir models/nb-nemotron-src

# 3. Konverter til F32-GGUF
uv run --project scripts/envs/parakeet \
  scripts/convert-parakeet.py models/nb-nemotron-src/nemotron-3.5-asr-streaming-0.6b.nemo

# 4. Kvantiser til Q8_0
build/bin/transcribe-quantize models/*/*-F32.gguf \
  models/nb-nemotron35-reading-Q8_0.gguf --quant Q8_0

# 5. Test på en norsk 16 kHz mono WAV
build/bin/transcribe-cli -m models/nb-nemotron35-reading-Q8_0.gguf \
  --language nb-NO test.wav
```

Konvertereren leser `.nemo`-arkivet direkte og skriver til
`models/<slug>/<slug>-F32.gguf`. Variantnavnet gjenkjennes fra konfigurasjonen
i arkivet; NBs finjustering skal matche `nemotron-3.5-asr-streaming-0.6b`.
Feiler gjenkjenningen, se `scripts/convert-parakeet.py` for flagg som
overstyrer varianten.

## Lisens

Basismodellen er under OpenMDW-1.1, som tillater redistribusjon av avledede
modeller med lisensnotis. NBs egen lisens står på modellkortet og må leses
etter at tilgang er gitt. Repoet er tagget `private-experimental`. Publiser
ikke under Kantegas Hugging Face-konto før begge lisensene er bekreftet.

## Publisere og legge i katalogen

1. Opprett `kantega/nb-nemotron35-reading-gguf` på Hugging Face med
   GGUF-filene og et modellkort som peker på kilde og lisenser.
2. Hent revisjon, størrelser og sha256 fra
   `https://huggingface.co/api/models/<repo>?blobs=true`.
3. Legg inn en oppføring i `src-tauri/src/catalog/nb-whisper.json` etter
   mønster fra Nemotron 3.5-oppføringen (`architecture: parakeet`,
   `experimental: true`, `languages: ["nb-NO"]`, `lang_detect: false`).
4. Kjør `python3 scripts/gen_catalog.py` eller kopier oppføringen manuelt inn
   i `catalog.json`.
