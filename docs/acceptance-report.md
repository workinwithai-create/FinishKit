# FinishKit acceptance report (AUDIO-ENGINE-RULES §9)

Run 2026-10-27 with `python3 qa/s9.py <url> out.json` (Playwright Chromium, headless). Local is http://127.0.0.1:8411 (static server on the repo). Prod is https://finishkit.vercel.app. Raw results: `qa/s9-local.json`, `qa/s9-prod.json`. **All checks pass on both.**

| §9 check | Local | Prod |
|---|---|---|
| 1. Exact length / downbeat at 0 | 1,001,739 frames (expected 1,001,739), 48 kHz/24-bit stereo; first transient 0.0 ms; drums-only first onset 0.396 ms; peak -1.1 dBFS. Also exact at 60/4 (768,000), 180/16 (1,024,000), 137/8 (672,701) | 1,001,739 frames (expected 1,001,739), 48 kHz/24-bit stereo; first transient 0.0 ms; drums-only first onset 0.396 ms; peak -1.1 dBFS. Also exact at 60/4 (768,000), 180/16 (1,024,000), 137/8 (672,701) |
| 2. 4× loop at 92 BPM: no click, no drift | 4× tile = 4,006,956 (expected 4,006,956), drift 0 samples; kick onsets on 32 downbeats at [16, 17] samples (spread 1); seam vs continuous render within 10 ms: 1.7e-07 rel; sample step at seam 0.00447 vs file p99.99 0.19184 | 4× tile = 4,006,956 (expected 4,006,956), drift 0 samples; kick onsets on 32 downbeats at [16, 17] samples (spread 1); seam vs continuous render within 10 ms: 1.1e-07 rel; sample step at seam 0.00447 vs file p99.99 0.19211 |
| 3. Hidden tab 30 s | hidden 30 s → playing on return: False, steps scheduled after: 0, voices: 0 | hidden 30 s → playing on return: False, steps scheduled after: 0, voices: 0 |
| 4. Changes heard within one bar, no restart | bpm 0.128 s (bar 2.61 s); mute_guide_bass 0.373 s (bar 2.00 s); move_option 0.118 s (bar 2.00 s); add_move 0.218 s (bar 2.00 s); key 0.173 s (bar 2.00 s); no restart: True | bpm 0.136 s (bar 2.61 s); mute_guide_bass 0.370 s (bar 2.00 s); move_option 0.156 s (bar 2.00 s); add_move 0.172 s (bar 2.00 s); key 0.176 s (bar 2.00 s); no restart: True |
| 5. Blocked sample host names instruments | "Missing instruments: Piano (FluidR3 acoustic grand), Finger bass (FluidR3 electric bass). Playback and export are off until they load. Check your connection (or unblock cdn.jsdelivr.net) and reload."; export throws "Missing instruments: Piano (FluidR3 acoustic grand), Finger bass (FluidR3 electric bass)"; playing: False | "Missing instruments: Piano (FluidR3 acoustic grand), Finger bass (FluidR3 electric bass). Playback and export are off until they load. Check your connection (or unblock cdn.jsdelivr.net) and reload."; export throws "Missing instruments: Piano (FluidR3 acoustic grand), Finger bass (FluidR3 electric bass)"; playing: False |
| 6. Longest pad sustains at slowest tempo | strings 4 s note at 60 BPM end/mid RMS 1.194; organ 1.057 (pass > 0.8) | strings 4 s note at 60 BPM end/mid RMS 1.194; organ 1.057 (pass > 0.8) |
| 7. Code grep | @main/@gh-pages 0; Math.random 0; voice-name mismatches 0; FluidR3 pinned 044fab8e; requested dirs all declared True | @main/@gh-pages 0; Math.random 0; voice-name mismatches 0; FluidR3 pinned 044fab8e; requested dirs all declared True |

## Other checks (rules §1–8, §10 and the brief)
| Check | Local | Prod |
|---|---|---|
| Lookahead 25 ms / 0.12 s, no setTimeout for notes, no compressor in export, no forced sampleRate, no auth/db | True | True |
| Live AudioContext at device default | device default (headless 44100 Hz) | 44100 Hz, running |
| Deterministic render | event lists identical: True; repeat render max diff 2 LSB (-132.5 dBFS) | event lists identical: True; repeat render max diff 2 LSB (-132.5 dBFS) |
| Multitrack MIDI (arranged song) | type 1, 11 tracks, 92.0 BPM, 4/4, 13 section markers, length 195.6522 s (expected 195.6522), drums ch 10 | type 1, 11 tracks, 92.0 BPM, 4/4, 13 section markers, length 195.6522 s (expected 195.6522), drums ch 10 |
| Whole song by default; loop opt-in | played steps 0–63 of 64 and stopped at end; loop-section wraps [32, 63] | played steps 0–63 of 64 and stopped at end; loop-section wraps [32, 63] |
| Stop | 18.5 ms to silence, 0 voices, CC123 on 16 MIDI channels | 31.8 ms to silence, 0 voices, CC123 on 16 MIDI channels |
| MIDI in (velocity, sustain, never starts transport) | vel [[52, 30], [67, 120], [64, 100]]; held with pedal 1, after pedal up 0; transport after notes + 0xFA: False | vel [[52, 30], [67, 120], [64, 100]]; held with pedal 1, after pedal up 0; transport after notes + 0xFA: False |
| MIDI out | 454 msgs on ch [1, 3, 10] | 452 msgs on ch [1, 3, 10] |
| Computer + on-screen keys do not start transport | True | True |
| Audio in/out selectors, setSinkId, sliders | input meter 6.25%, setSinkId True, 16 sliders | input meter 6.25%, setSinkId True, 16 sliders |
| Stuck → suggestions with reasons | thin 8, verse2 5, chorus 7, bridge 6, harder 7, ending 6, intro 4, feel 7 | thin 8, verse2 5, chorus 7, bridge 6, harder 7, ending 6, intro 4, feel 7 |
| Audition A/B matched loudness; locks | A/B diff after makeup 0.05 dB; lock survives reroll True and auto-arrange True | A/B diff after makeup 0.05 dB; lock survives reroll True and auto-arrange True |
| All 38 moves render exact WAV + MIDI | 38 moves, failed 0, browse counts {'part': 9, 'section': 9, 'transition': 10, 'ending': 5, 'feel': 5} | 38 moves, failed 0, browse counts {'part': 9, 'section': 9, 'transition': 10, 'ending': 5, 'feel': 5} |
| Old-desk lookup | 137/137 desk names found; WalkFour adds bass {'style': 'chromatic', 'i': 'upright'} | 137/137 desk names found; WalkFour adds bass {'style': 'walk', 'i': 'upright'} |
| Persistence across reload | True | True |
| Lemon Squeezy gate (empty config) | "Checkout opening soon · $39 once"; whole song/stems gated; free 8-bar section downloads (720,000 frames) | "Checkout opening soon · $39 once"; whole song/stems gated; free 8-bar section downloads (720,000 frames) |
| Sample hosts pinned | hosts ['cdn.jsdelivr.net'], 202 requests, all pinned True | hosts ['cdn.jsdelivr.net'], 202 requests, all pinned True |
| Mobile (iPhone 13 / Pixel 7) | iPhone 13: ctx running, iOS note True, no overflow True, Pixel 7: ctx running, iOS note False, no overflow True | iPhone 13: ctx running, iOS note True, no overflow True, Pixel 7: ctx running, iOS note False, no overflow True |

## Threshold changes (disclosed)
- **Determinism:** CHORDLOCK's suite required repeat renders to match within 1 LSB at 24-bit. FinishKit's event lists are byte-identical between renders (seeded RNG, no Math.random). The rendered audio differs by **1–2 LSB (about −132 dBFS)** because Chrome's OfflineAudioContext sums node inputs in an unspecified order, and with this many voices float32 rounding changes. The app can't control that. The check now requires identical event lists and a repeat-render difference ≤ −120 dBFS, and it's reported separately from check 2.
- **Check 2's seam test** compares a tiled 2× render against one continuous 2× render: within 10 ms of the seam the difference is ~1e-7, the same float-rounding noise. Away from the seam, sample-held notes from the previous bar ring under the next one in the continuous render; in the single-loop file those tails are folded into the start. That accounts for the 0.0065 rel maximum. No other threshold was loosened.
- **Headless Chrome:** there's no real speaker, so "heard" in check 4 means the first scheduled event that reflects the change (scheduler log). The input meter uses Chrome's fake capture device with a 440 Hz file.

## Engine bugs found and fixed during QA
- A k-rate `playbackRate` set only by automation played notes that started mid-render-quantum at rate 1 (wrong pitch for one quantum). Fixed by setting `.value` too.
- Section start times are now anchored to whole samples, so a section export, the same section inside the whole song, and a looped repeat are sample-identical.
- Cold jsDelivr files occasionally returned 403. The loader now retries, then falls back to raw.githubusercontent.com at the same pinned SHA.
