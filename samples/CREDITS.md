# FinishKit sample credits

## Melodic instruments: FluidR3 GM (MIT-licensed SoundFont, rendered to MP3 by gleitz/midi-js-soundfonts)
Loaded at runtime from jsDelivr, pinned to commit `044fab8e1456bfafc5776e86dfd6bb8697149aef`
(never @main or @gh-pages):
`https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@044fab8e1456bfafc5776e86dfd6bb8697149aef/FluidR3_GM/<instrument>-mp3/<note>.mp3`

One sample every 4 semitones per instrument (max pitch shift ±2 semitones; glides up to ±4).

## Acoustic drum kit: Virtuosity Drums (CC0 1.0)
sfzinstruments/virtuosity_drums @ `9f04cf9a734527edfbb0a4eee1f674e45bbf71bc`
- kick, snare, hat, ride: same files as the PorchBand desk kit
- ghost = Samples/mid/mid_snare_center_vl4, rim = mid_snare_crossstick_vl10, ohat = mid_hh_open_vl3_rr1,
  crash = mid_crash_crash_vl3_rr1, htom = mid_htom_center_vl12, ltom = mid_ltom_center_vl12

## Shaker and tambourine: VSCO 2 Community Edition (CC0 1.0)
sgossner/VSCO-2-CE @ `440300901dfe9275fd84e0b7763af1f8443ae62e`
- shaker = "VSCO 1 Percussion/varWood/Camo's Shaker/shake1.wav"
- tamb = "Percussion/Tamb1-Hit_v2_rr1_Sum.wav"

Drum files are trimmed with a 120 ms fade-out and stored as 48 kHz 16-bit FLAC in `samples/drums/`.
