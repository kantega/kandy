//! Decode an arbitrary audio file into the f32 mono 16 kHz PCM the
//! transcription pipeline expects.
//!
//! `symphonia` handles container + codec probing; which containers and codecs
//! are available follows from its feature list in `Cargo.toml`.
//! `SampleBuffer<f32>` handles the per-codec sample-format conversion for us,
//! so we only need to downmix interleaved multi-channel to mono and resample
//! the result to 16 kHz.

use anyhow::{anyhow, Result};
use std::fs::File;
use std::path::Path;
use std::time::Duration;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use super::FrameResampler;

const TARGET_SAMPLE_RATE: u32 = 16_000;
/// Frame size for the resampler — 20 ms matches the recorder's tick.
const RESAMPLER_FRAME_MS: u64 = 20;

/// Decode a file into mono f32 PCM at 16 kHz. Container/codec is inferred from
/// the file extension (as a hint) and confirmed by symphonia's prober.
pub fn decode_to_mono_16k<P: AsRef<Path>>(path: P) -> Result<Vec<f32>> {
    let path = path.as_ref();
    let file = File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;
    let mut format = probed.format;
    // MP4/MOV list every track, video first, and `default_track()` just takes
    // the first one — so a screen recording would hand us an H.264 track and
    // fail. Pick the first track we can actually build an audio decoder for.
    let (track_id, codec_params) = format
        .tracks()
        .iter()
        .find_map(|track| {
            symphonia::default::get_codecs()
                .make(&track.codec_params, &DecoderOptions::default())
                .ok()
                .map(|_| (track.id, track.codec_params.clone()))
        })
        .ok_or_else(|| anyhow!("Audio file has no track this build can decode"))?;

    // Sample rate and channels are read from the codec params when available,
    // but m4a/AAC often leaves both unset until the first frame is decoded.
    // We fall back to the decoded buffer's own spec on first packet.
    let mut source_rate = codec_params.sample_rate;
    let mut channels: Option<usize> = codec_params.channels.map(|c| c.count());

    let mut decoder =
        symphonia::default::get_codecs().make(&codec_params, &DecoderOptions::default())?;

    // Reused across packets. Allocated lazily on the first decoded frame so we
    // can size it from the actual buffer spec.
    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    let mut mono: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                break;
            }
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(e.into()),
        };
        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(e.into()),
        };

        if sample_buf.is_none() {
            let spec = *decoded.spec();
            let duration = decoded.capacity() as u64;
            sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
            // Fill in what the codec params couldn't tell us upfront.
            source_rate.get_or_insert(spec.rate);
            channels.get_or_insert(spec.channels.count());
        }
        let buf = sample_buf.as_mut().expect("initialised above");
        buf.copy_interleaved_ref(decoded);
        append_downmixed(buf.samples(), channels.unwrap_or(1), &mut mono);
    }

    if mono.is_empty() {
        return Err(anyhow!("Decoded audio contained no samples"));
    }

    let rate = source_rate.ok_or_else(|| anyhow!("Audio file missing sample rate"))?;
    Ok(resample_to_16k(mono, rate))
}

/// Downmix interleaved multi-channel f32 into mono by channel averaging.
fn append_downmixed(interleaved: &[f32], channels: usize, out: &mut Vec<f32>) {
    if channels <= 1 {
        out.extend_from_slice(interleaved);
        return;
    }
    let frames = interleaved.len() / channels;
    out.reserve(frames);
    let inv = 1.0 / channels as f32;
    for frame in interleaved.chunks_exact(channels) {
        let sum: f32 = frame.iter().sum();
        out.push(sum * inv);
    }
}

/// Resample mono f32 to 16 kHz. Passthrough when already 16 kHz.
fn resample_to_16k(samples: Vec<f32>, source_rate: u32) -> Vec<f32> {
    if source_rate == TARGET_SAMPLE_RATE {
        return samples;
    }
    let mut resampler = FrameResampler::new(
        source_rate as usize,
        TARGET_SAMPLE_RATE as usize,
        Duration::from_millis(RESAMPLER_FRAME_MS),
    );
    let mut out = Vec::with_capacity(
        samples.len() * TARGET_SAMPLE_RATE as usize / source_rate as usize + 1024,
    );
    resampler.push(&samples, |frame| out.extend_from_slice(frame));
    resampler.finish(|frame| out.extend_from_slice(frame));
    out
}
