# FinishKit

**Finish your song from a 4-chord loop.** Live: **https://finishkit.vercel.app**

Enter BPM, key and chords, tell it where you're stuck (no intro, verse 2 feels the same, the bridge, the ending, the chorus doesn't lift...), and it recommends arrangement moves with a plain reason for each. Audition any move against your loop at matched loudness, then stack, edit, lock and reroll. The timeline plays the whole song by default; looping one section is opt-in.

FinishKit replaces 136 of the small 4- and 8-bar arrangement desks from `workinwithai-create` with **38 moves** (9 parts, 9 sections, 10 transitions, 5 endings, 5 feel). Type an old desk's name into **Browse all moves** to load its preset. The full mapping is in [MERGE-PLAN.md](MERGE-PLAN.md). The old repos and deploys are unchanged.

## What it does
- **Song setup:** BPM 60–180, key, and your chord loop, all saved in your browser.
- **Stuck areas** become recommended moves with a reason; every option stays editable (style, bars, sound, pattern).
- **Timeline:** whole-song playback; per-section loop, lock, mute and reroll; Auto-arrange builds a full form from your loop.
- **Audio:** real samples (FluidR3_GM pinned to commit `044fab8e`, plus CC0 drums and percussion from Virtuosity/VSCO 2 CE). A lookahead scheduler (25 ms tick, 0.12 s ahead), held notes that really sustain, and a master limiter.
- **Live play:** Web MIDI in/out, on-screen pads, computer keys (A–K row). Playing notes never starts the transport. Audio input/output selectors and volume sliders per part.
- **Export:**
  - 48 kHz 24-bit WAV at the exact length: downbeat at sample 0, tails folded into the start so loops are seamless, peak at −1.1 dBFS.
  - Multitrack MIDI with tempo, time signature and section markers.
  - Stems ZIP.

## Mobile onboarding
1. Open https://finishkit.vercel.app on your phone and tap **Tap to start audio** (browsers need one tap before they make sound).
2. **iPhone:** turn the silent switch off (no orange showing) or plug in headphones. Web audio is muted in silent mode.
3. Wait for the sample loader to reach 100%. If a sound can't load, the app names it.
4. Enter your chords, tap where you're stuck, and audition. Audio stops if you switch tabs or lock the phone; press Play to resume.

## Pricing
- **Free:** every move, auditions, timeline, live play, MIDI in/out, and WAV + MIDI export of any section up to 8 bars.
- **License: $39 once** (no subscription) unlocks whole-song WAV + MIDI, the stems ZIP, and longer section exports. Sold through Lemon Squeezy. Until the store IDs are filled into `LEMON` in `app.js`, the buy button shows "Checkout opening soon".

## Run locally
Static site with no build step: `python3 -m http.server` from this folder. `npm run build` copies the files to `dist/` for Vercel. There's no auth, no database, and no env vars.

## Tests
`python3 qa/s9.py <url> out.json` runs the full Playwright acceptance suite (AUDIO-ENGINE-RULES §9). Results are in [docs/acceptance-report.md](docs/acceptance-report.md).

## Replaced desks (136)
MuteEight, BarNine, LiftFour, EndEight, FormCut, TurnTwo, OpenEight, VerseTwo, BridgeEight, LastHook, AfterHook, PreEight, ModEight, TagFour, HalfEight, LiftTwo, FillFour, ButtonFour, RideEight, StopFour, CallFour, NeedThree, GhostEight, BreakFour, StabFour, DropEight, OrganEight, MidEight, SoloEight, TurnFour, SlideTwo, ChoirEight, SwellFour, BuildFour, RiseEight, WalkEight, RhodesEight, CongaFour, PedalFour, HarpFour, PizzFour, PivotFour, ChickFour, RimFour, VibesFour, OpenFour, SteelFour, CueFour, BowFour, BridgeFour, ClapFour, GlockFour, LeadFour, DropFour, MarimFour, TomTwo, AltoFour, BassFour, FingerFour, AirFour, RiffFour, HarmFour, AdlibFour, RhodesFour, WalkFour, DrawFour, Exhale, HoldFour, UpStep, ChorusTwo, ThinFour, DieTwice, PickupTwo, OffLoop, ReturnFour, Inkwell, DoorTwo, FromHook, VerseEight, SeamFour, AmenFour, FadeEight, ClimbFour, HalfFour, BreathFour, StrumFour, BorrowFour, OrganFour, ThirdFour, ReplyFour, ShakeFour, EarnFour, LineFour, LandFour, BreakTwo, PreLift, FloorEight, AirCut, PickBar, PedalEight, HoleFour, Unravel, AnswerEight, AndEight, ClaveEight, CoatEight, PassTwo, StackEight, FitFour, CallEight, AirEight, SnapFour, TurnEight, WalkBass, RollFour, TightFour, CompFour, TensionFour, HookLine, ResolveFour, CounterFour, PunchFour, RoomFour, ArcEight, SpaceFour, GhostFour, FormFour, HushFour, VampFour, StrideFour, DoorFour, StackFour, TensionEight, FigureFour, VoicingFour, CadenceFour

Not merged: **ColdNote** (sour-note analysis, not an arrangement move).

## Credits
See [samples/CREDITS.md](samples/CREDITS.md).
