# FinishKit AUDIO-ENGINE-RULES section 9 acceptance run. Usage: python3 s9.py <url> [out.json]
import asyncio, base64, json, sys, re, io, wave, os, numpy as np, mido
from playwright.async_api import async_playwright
URL=sys.argv[1]; OUT=sys.argv[2] if len(sys.argv)>2 else 's9.json'; OD=os.path.join(os.path.dirname(os.path.abspath(OUT)),'out'); os.makedirs(OD,exist_ok=True)
F="window.__finishkit"
HELP="""()=>{ const f=window.__finishkit; const b64=b=>{let s=''; for(let i=0;i<b.length;i+=32768) s+=String.fromCharCode.apply(null,b.subarray(i,i+32768)); return btoa(s);};
 window.__qa={ b64,
  wav: async o=>{ const r=await f.exportWavBytes(o||{}); return {name:r.name,b64:b64(r.bytes),frames:r.frames}; },
  mid: o=>{ const r=f.exportMidBytes(o||{}); return {name:r.name,b64:b64(r.bytes)}; },
  loop: (role,moves)=>{ const s=f.loopSection('Your loop'); if(role) s.role=role; s.moves=(moves||[]).map(([id,o],k)=>f.newMove(id,o,11+k)); return s; },
  withMove: id=>{ const m=f.MOVES[id], L=window.__qa.loop(null, m.where?[]:[[id,{}]]); if(!m.where) return {arr:[L]};
    const sec=f.newSection(id,{},7); const arr=[L]; if(m.where==='start'||m.where==='before') arr.unshift(sec); else arr.push(sec); return {arr}; } }; }"""
MOCK="""(()=>{ const sent=[]; window.__midiSent=sent; const inp={id:'in1',name:'Mock Keys 49',type:'input',onmidimessage:null}; const out={id:'out1',name:'Mock Synth Out',type:'output',send:(d,t)=>sent.push({d:[...d],t})};
 const acc={inputs:new Map([['in1',inp]]),outputs:new Map([['out1',out]]),onstatechange:null}; window.__mockIn=inp; navigator.requestMIDIAccess=()=>Promise.resolve(acc); })();"""
ARGS=['--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture='+os.path.join(os.path.dirname(os.path.abspath(__file__)),'fake-mic.wav')]
def load(b):
  w=wave.open(io.BytesIO(b)); n=w.getnframes(); raw=np.frombuffer(w.readframes(n),dtype=np.uint8).reshape(-1,3)
  v=(raw[:,0].astype(np.int32)|(raw[:,1].astype(np.int32)<<8)|(raw[:,2].astype(np.int32)<<16)); v[v>=1<<23]-=1<<24
  return w.getframerate(),w.getsampwidth(),n,(v/8388607.0).reshape(-1,w.getnchannels()),w.getnchannels()
async def wav(pg,o=None):
  r=await pg.evaluate("o=>window.__qa.wav(o)",o or {}); return r['name'],base64.b64decode(r['b64'])
def midinfo(fn):
  mf=mido.MidiFile(fn); t0=mf.tracks[0]
  return mf,{'type':mf.type,'tracks':[t.name for t in mf.tracks],'tempo_bpm':round(mido.tempo2bpm([e for e in t0 if e.type=='set_tempo'][0].tempo),3),'timesig':[f"{e.numerator}/{e.denominator}" for e in t0 if e.type=='time_signature'],
    'markers':[e.text for e in t0 if e.type=='marker'],'length_s':round(mf.length,4),'notes_per_track':[sum(1 for e in t if e.type=='note_on' and e.velocity>0) for t in mf.tracks],
    'channels':sorted({e.channel+1 for t in mf.tracks for e in t if e.type=='note_on'}),'programs':sorted({e.program for t in mf.tracks for e in t if e.type=='program_change'})}
async def boot(pg):
  await pg.click('#tapBtn'); await pg.wait_for_function("document.getElementById('tap').classList.contains('hide')"); await pg.evaluate(HELP)
  await pg.wait_for_function("document.getElementById('loadStatus').textContent.startsWith('All')",timeout=90000)
async def main():
  res={}
  async with async_playwright() as p:
    br=await p.chromium.launch(args=ARGS)
    ctx=await br.new_context(viewport={'width':1280,'height':900},accept_downloads=True); await ctx.add_init_script(MOCK); pg=await ctx.new_page(); errs=[]; reqs=[]
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text)); pg.on('request',lambda r: reqs.append(r.url))
    await pg.goto(URL); await pg.evaluate("()=>localStorage.clear()"); await pg.reload(); await pg.screenshot(path=OD+'/shot-tap.png')
    await boot(pg)
    res['live_ctx']=await pg.evaluate(f"()=>({{sampleRate:{F}.ctx.sampleRate,state:{F}.ctx.state,load:document.getElementById('loadStatus').textContent}})")
    # ---- c1: exact length, downbeat at 0, peak
    name,b=await wav(pg); open(OD+'/'+name,'wb').write(b); sr,sw,n,x,nc=load(b); m=np.abs(x).max(1); pk=np.abs(x).max()
    exp=round(8*4*60/92*48000); fi=int(np.argmax(m>0.01*pk))
    _,bk=await wav(pg,{'only':['gdrums']}); xk1=load(bk)[3]; mk=np.abs(xk1).max(1); fk=int(np.argmax(mk>0.05*mk.max()))
    res['c1']={'file':name,'sr':sr,'bits':sw*8,'ch':nc,'frames':n,'expected':exp,'peak_dBFS':round(20*np.log10(pk),3),'first_sample_over_1pct_peak':fi,'first_transient_ms':round(fi/48,3),
      'drums_only_first_onset_5pct_ms':round(fk/48,3),'level_first_1ms_dBFS':round(20*np.log10(np.abs(x[:48]).max()+1e-12),2)}
    res['c1']['pass']=n==exp==1001739 and sr==48000 and sw==3 and res['c1']['peak_dBFS']<=-1.0 and fi/48<=1.0 and fk/48<=1.0
    other={}
    for bpm,bars in [(60,4),(180,16),(137,8)]:
      await pg.evaluate(f"()=>{{{F}.state.bpm={bpm}; {F}.state.loopBars={bars}; {F}.save();}}")
      _,bb=await wav(pg); s=load(bb); a=np.abs(s[3]); other[f'{bpm}bpm_{bars}bars']={'frames':s[2],'expected':round(bars*4*60/bpm*48000),'peak_dBFS':round(20*np.log10(a.max()),3)}
    await pg.evaluate(f"()=>{{{F}.state.bpm=92; {F}.state.loopBars=8; {F}.save();}}")
    res['c1_other_lengths']=other; res['c1_other_pass']=all(v['frames']==v['expected'] and v['peak_dBFS']<=-1 for v in other.values())
    # ---- c2: 4x loop drift + seam
    x2=load((await wav(pg))[1])[3]; t=np.tile(x,(4,1)); N=len(x); bar=48000*4*60/92
    xk=np.tile(xk1[:,0],4); pkk=np.abs(xk).max(); dev=[]
    for k in range(32):
      e=int(round(k*bar)); w=np.abs(xk[max(0,e-200):e+200]); dev.append(int(np.argmax(w>0.05*pkk))+max(0,e-200)-e)
    seam=await pg.evaluate("""async()=>{const f=window.__finishkit, L=window.__qa.loop('verse'); const a=await f.renderRange({pv:{arr:[L]},all:true,noNorm:true}), b=await f.renderRange({pv:{arr:[L,L]},all:true,noNorm:true});
      let mx=0, mxSeam=0; for(let c=0;c<2;c++) for(let i=0;i<b.N;i++){ const d=Math.abs(b.ch[c][i]-a.ch[c][i%a.N]); if(d>mx) mx=d; if(Math.abs(i-a.N)<480 && d>mxSeam) mxSeam=d; } let pk=0; for(const x of a.ch[0]) pk=Math.max(pk,Math.abs(x)); return {N1:a.N,N2:b.N,maxdiff_tiled_vs_continuous_rel:mx/pk,maxdiff_within_10ms_of_seam_rel:mxSeam/pk};}""")
    d=np.abs(np.diff(t[:,0])); typ=float(np.percentile(d,99.99)); sp=max(max(dev[i::4])-min(dev[i::4]) for i in range(4)); tr=float(np.polyfit(range(32),dev,1)[0]*32)
    res['c2']={'total_frames_4x':len(t),'expected_4x':4*exp,'drift_samples':len(t)-4*exp,'kick_downbeat_onsets_32bars_samples':sorted(set(dev)),'onset_spread_within_same_chord_bars':sp,'onset_trend_samples_over_32_bars':round(tr,3),
      'seam_vs_continuous_render':seam,'seam_abs_sample_step':[round(float(d[k*N-1]),5) for k in (1,2,3)],'sample_step_p99.99_in_file':round(typ,5),'deterministic_maxdiff':float(np.abs(x-x2).max())}
    res['c2']['pass']=res['c2']['drift_samples']==0 and sp<=5 and abs(tr)<1 and seam['N2']==2*seam['N1'] and seam['maxdiff_within_10ms_of_seam_rel']<0.01 and max(res['c2']['seam_abs_sample_step'])<=max(typ,1e-3)
    # ---- determinism (not a section 9 item; reported separately): same seed -> identical notes; repeat renders agree to below -120 dBFS
    ev=await pg.evaluate(f"()=>{{const f={F}; const a=JSON.stringify(f.buildSong(f.state).events), b=JSON.stringify(f.buildSong(f.state).events); return {{events:f.buildSong(f.state).events.length, identical:a===b}}}}")
    rd=float(np.abs(x-x2).max()); res['determinism']={'events':ev['events'],'event_lists_identical':ev['identical'],'repeat_render_maxdiff':rd,'repeat_render_maxdiff_LSB24':round(rd*8388607,2),'repeat_render_maxdiff_dBFS':round(20*np.log10(rd+1e-12),1),
      'note':'Chrome sums node inputs in an unspecified order, so float32 rounding can differ by ~1e-7 between renders; bound is -120 dBFS (CHORDLOCK used 1 LSB)'}
    res['determinism']['pass']=ev['identical'] and rd<=10**(-120/20)
    # ---- c6: real sustain, held string pad at 60 BPM
    c6={}
    for inst in ['strings','organ']:
      r=await pg.evaluate("""async(i)=>{const f=window.__finishkit, q=window.__qa; f.state.bpm=60; f.save(); const pv={arr:[q.loop(null,[['pad',{i,style:'held'}]])]}; await f.ensureInstruments([i]);
        const r=await f.exportWavBytes({pv,all:true,only:['pad']}); f.state.bpm=92; f.save(); return {b64:q.b64(r.bytes)}}""",inst)
      s=load(base64.b64decode(r['b64']))[3].mean(1); bn=int(48000*4); rms=lambda a: float(np.sqrt((a**2).mean())); seg=s[bn:2*bn]; mid=rms(seg[int(bn*.3):int(bn*.5)]); end=rms(seg[int(bn*.92):int(bn*.99)])
      c6[inst+'_60bpm']={'note_s':4.0,'rms_30-50%':round(mid,4),'rms_92-99%':round(end,4),'end/mid':round(end/mid,3)}
    c6['pass']=all(v['end/mid']>0.8 for v in c6.values() if isinstance(v,dict)); res['c6']=c6
    # ---- MIDI file of the loop and of a full arrangement
    mm=await pg.evaluate("()=>window.__qa.mid({})"); fn=OD+'/'+mm['name']; open(fn,'wb').write(base64.b64decode(mm['b64'])); _,mi=midinfo(fn); mi['file']=mm['name']; mi['expected_s']=round(8*4*60/92,4)
    await pg.evaluate(f"()=>{{ {F}.autoArrange(); {F}.render(); }}"); await pg.wait_for_function("document.getElementById('loadStatus').textContent.startsWith('All')",timeout=90000)
    sgb=await pg.evaluate(f"()=>({{bars:{F}.song().totalBars, secs:{F}.song().S.map(s=>s.sec.name)}})")
    ma=await pg.evaluate("()=>window.__qa.mid({all:true})"); fa=OD+'/'+ma['name']; open(fa,'wb').write(base64.b64decode(ma['b64'])); _,mai=midinfo(fa); mai['file']=ma['name']; mai['expected_s']=round(sgb['bars']*4*60/92,4); mai['sections']=sgb['secs']
    res['midi']={'loop':mi,'arranged_song':mai}
    res['midi_pass']=all(v['type']==1 and v['tempo_bpm']==92 and v['timesig'][:1]==['4/4'] and abs(v['length_s']-v['expected_s'])<1e-3 and len(v['tracks'])>2 for v in res['midi'].values()) and len(mai['markers'])>=len(sgb['secs']) and 10 in mai['channels']
    # ---- whole song plays by default; section loop is opt-in
    await pg.evaluate("""()=>{const f=window.__finishkit, q=window.__qa; const a=q.loop('verse'), b=q.loop('chorus'); a.bars=2; b.bars=2; a.name='A'; b.name='B'; f.state.arr=[a,b]; f.state.sel=b.id; f.state.bpm=180; f.state.loopSection=false; f.save(); f.render();}""")
    await pg.click('#play'); await pg.wait_for_timeout(7500)
    w1=await pg.evaluate(f"()=>({{steps:window.__schedLog.map(e=>e.step), playing:!!{F}.play, status:document.getElementById('status').textContent}})")
    await pg.click('#loopSection'); await pg.click('#play'); await pg.wait_for_timeout(4500)
    w2=await pg.evaluate(f"()=>({{steps:window.__schedLog.map(e=>e.step), playing:!!{F}.play}})"); await pg.click('#stopBtn'); await pg.click('#loopSection')
    st1=w1['steps'][-64:]; res['transport']={'default_whole_song':{'first_step':st1[0] if st1 else None,'max_step':max(w1['steps'][-70:]),'song_steps':64,'stopped_at_end':not w1['playing'],'status':w1['status']},
      'loop_section_opt_in':{'steps_range':[min(w2['steps'][-40:]),max(w2['steps'][-40:])],'wrapped':w2['steps'][-40:].count(32)>=2 or any(w2['steps'][i+1]<w2['steps'][i] for i in range(len(w2['steps'])-40,len(w2['steps'])-1)),'playing':w2['playing']}}
    res['transport']['pass']=res['transport']['default_whole_song']['max_step']==63 and res['transport']['default_whole_song']['stopped_at_end'] and res['transport']['loop_section_opt_in']['steps_range'][0]>=32 and res['transport']['loop_section_opt_in']['wrapped']
    await pg.evaluate("()=>{const f=window.__finishkit; f.state.bpm=92; f.state.arr=[window.__qa.loop(null,[['bass',{}]])]; f.state.sel=f.state.arr[0].id; f.save(); f.render();}")
    await pg.wait_for_function("document.getElementById('loadStatus').textContent.startsWith('All')",timeout=90000)
    # ---- c4 live changes (heard on next step, must be within one bar) + MIDI out
    await pg.evaluate("()=>{const s=document.getElementById('midiOut'); s.value='out1'; s.dispatchEvent(new Event('change'))}")
    await pg.click('#play'); await pg.wait_for_timeout(1500); live={}
    acts=[('bpm',"()=>{const e=document.getElementById('bpm');e.value=120;e.dispatchEvent(new Event('change'))}",lambda e,v:e['bpm']==120),
          ('mute_guide_bass',"()=>{const e=document.querySelector('[data-mute=gbass]');e.checked=true;e.dispatchEvent(new Event('input',{bubbles:true}))}",lambda e,v:e['step']%16==0 and not any(n.startswith('gbass:') for n in e['notes'])),
          ('move_option',"()=>{const e=document.querySelector('#secPanel select[data-mvopt]'); e.selectedIndex=(e.selectedIndex+1)%e.options.length; e.dispatchEvent(new Event('change',{bubbles:true}))}",lambda e,v:e['ver']>=v),
          ('add_move',"()=>{window.__finishkit.commitPreview(window.__finishkit.previewFor({id:'shaker',type:'part'},window.__finishkit.state.sel)); window.__finishkit.render();}",lambda e,v:any(n.startswith('perc:') for n in e['notes'])),
          ('key',"()=>{const e=document.getElementById('key');e.value='2';e.dispatchEvent(new Event('change'))}",lambda e,v:e['keyRoot']==2)]
    for nm,act,ok in acts:
      t0=await pg.evaluate(f"()=>{F}.ctx.currentTime"); await pg.evaluate(act); v=await pg.evaluate(f"()=>{F}.ver"); await pg.wait_for_timeout(2600); log=await pg.evaluate("()=>window.__schedLog")
      hit=[e for e in log if e['time']>t0 and ok(e,v)]; barS=4*60/(92 if nm=='bpm' else 120)
      live[nm]={'heard_at_s_after_change':round(hit[0]['time']-t0,3) if hit else None,'one_bar_s':round(barS,3),'pass':bool(hit) and hit[0]['time']-t0<=barS}
    live['still_playing_no_restart']=await pg.evaluate(f"()=>!!{F}.play"); res['c4']=live
    res['c4']['pass']=all(v['pass'] for v in live.values() if isinstance(v,dict)) and live['still_playing_no_restart']
    res['midi_out']={'msgs_sent_while_playing':await pg.evaluate("()=>window.__midiSent.length"),'channels':sorted(await pg.evaluate("()=>[...new Set(window.__midiSent.filter(m=>(m.d[0]&0xF0)==0x90).map(m=>(m.d[0]&15)+1))]")),'selected':await pg.evaluate("()=>document.getElementById('midiOut').value")}
    res['midi_out']['pass']=res['midi_out']['msgs_sent_while_playing']>20 and 10 in res['midi_out']['channels'] and len(res['midi_out']['channels'])>=3
    # ---- Stop
    await pg.wait_for_timeout(800); res['stop']=await pg.evaluate(f"()=>{F}.measureStopSilence()")
    res['stop']['active_after']=await pg.evaluate(f"()=>{F}.active"); res['stop']['all_notes_off_channels']=await pg.evaluate("()=>new Set(window.__midiSent.filter(m=>(m.d[0]&0xF0)==0xB0&&m.d[1]==123).map(m=>m.d[0]&15)).size")
    res['stop']['pass']=res['stop']['ms'] is not None and res['stop']['ms']<=50 and res['stop']['all_notes_off_channels']==16
    # ---- c3 hidden tab 30 s
    await pg.click('#play'); await pg.wait_for_timeout(1500)
    oth=await ctx.new_page(); await oth.goto('about:blank'); await oth.bring_to_front()
    n0=await pg.evaluate("()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));return window.__schedLog.length}")
    await pg.wait_for_timeout(30000); await pg.bring_to_front()
    await pg.evaluate("()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'))}"); await pg.wait_for_timeout(1500)
    res['c3']={'hidden_s':30,'playing_on_return':await pg.evaluate(f"()=>!!{F}.play"),'steps_scheduled_while_hidden_and_after':await pg.evaluate("()=>window.__schedLog.length")-n0,'active_voices_after':await pg.evaluate(f"()=>{F}.active"),'status':await pg.text_content('#status')}
    res['c3']['pass']=not res['c3']['playing_on_return'] and res['c3']['steps_scheduled_while_hidden_and_after']==0 and res['c3']['active_voices_after']==0; await oth.close()
    # ---- MIDI in
    await pg.evaluate("()=>{const sel=document.getElementById('midiIn'); sel.value='in1'; sel.dispatchEvent(new Event('change'))}")
    mi=await pg.evaluate("""async()=>{const f=window.__finishkit, I=window.__mockIn, snd=d=>I.onmidimessage({data:new Uint8Array(d)}); window.__liveLog.length=0;
      snd([0x90,52,30]); snd([0x80,52,0]); snd([0x90,67,120]); snd([0x80,67,0]); await new Promise(r=>setTimeout(r,50)); const afterOffNoPedal=f.voices.size;
      snd([0x90,64,100]); snd([0xB0,64,127]); snd([0x80,64,0]); await new Promise(r=>setTimeout(r,300));
      const heldAfterOff=f.voices.size, sus=f.sustain; snd([0xB0,64,0]); await new Promise(r=>setTimeout(r,100)); snd([0xFA]); snd([0xF8]);
      return {vels:window.__liveLog.map(e=>[e.note,Math.round(e.vel*127)]), voices_after_noteoff_no_pedal:afterOffNoPedal, held_after_noteoff_with_pedal:heldAfterOff, sustain_flag:sus, after_pedal_up:f.voices.size, playing_after_notes_and_0xFA:!!f.play,
        inputs:[...document.getElementById('midiIn').options].map(o=>o.text), outputs:[...document.getElementById('midiOut').options].map(o=>o.text), note:document.getElementById('midiNote').textContent}}""")
    mi['pass']=mi['vels']==[[52,30],[67,120],[64,100]] and mi['voices_after_noteoff_no_pedal']==0 and mi['held_after_noteoff_with_pedal']==1 and mi['sustain_flag'] and mi['after_pedal_up']==0 and not mi['playing_after_notes_and_0xFA']
    res['midi_in']=mi
    # ---- on-screen + computer keys never start the transport
    await pg.mouse.click(5,5); await pg.keyboard.down('1'); await pg.keyboard.up('1'); await pg.keyboard.press('q'); await pg.keyboard.press('Space'); await pg.click('.pad[data-bar="1"]'); await pg.click('.pkey >> nth=2')
    res['keys']={'log':await pg.evaluate("()=>window.__liveLog.slice(-4).map(e=>[e.note,e.src])"),'playing_after':await pg.evaluate(f"()=>!!{F}.play")}
    res['keys']['pass']=len(res['keys']['log'])==4 and not res['keys']['playing_after']
    # ---- suggestions: every stuck area gives reasons; audition A/B matched loudness; keep; lock survives reroll / auto-arrange
    sg=await pg.evaluate(f"()=>Object.fromEntries(['thin','verse2','chorus','bridge','harder','ending','intro','feel'].map(k=>{{const s={F}.suggest(k,{F}.state.sel); return [k,{{n:s.length, top:s.slice(0,3).map(x=>x.id), reason:s[0]&&s[0].reason}}]}}))")
    res['suggest']={'by_stuck':sg,'pass':all(v['n']>=3 and v['reason'] for v in sg.values())}
    await pg.click('[data-stuck="thin"]'); await pg.click('#sugs [data-aud="s:0"]'); await pg.wait_for_timeout(4000)
    au=await pg.evaluate(f"()=>{{const a={F}.aud; return a&&{{move:a.sug.id, loud:a.loud, playing:!!{F}.play}}}}"); await pg.click('[data-ab="A"]'); await pg.wait_for_timeout(600)
    au['ab_gain_A']=await pg.evaluate(f"()=>{F}.bus.ab.gain.value"); n_before=await pg.evaluate(f"()=>{F}.state.arr[0].moves.length"); await pg.click('#keep'); au['moves_after_keep']=await pg.evaluate(f"()=>{F}.state.arr[0].moves.length")-n_before
    lk=await pg.evaluate(f"""()=>{{const f={F}, m=f.state.arr[0].moves[0]; m.locked=true; const s0=m.seed; f.reroll(); const kept=m.seed===s0; f.state.arr[0].locked=true; const id=f.state.arr[0].id; f.autoArrange(); const r={{locked_move_seed_kept_on_reroll:kept, locked_section_kept_on_auto_arrange:f.state.arr.some(s=>s.id===id), arranged_sections:f.state.arr.length}}; f.state.arr.forEach(s=>s.locked=false); f.render(); return r;}}""")
    res['audition']={**au,**lk}; res['audition']['pass']=bool(au.get('loud')) and au['moves_after_keep']==1 and lk['locked_move_seed_kept_on_reroll'] and lk['locked_section_kept_on_auto_arrange']
    # ---- every move: renders + exports WAV and MIDI
    await pg.evaluate(f"()=>{{ {F}.state.bpm=92; {F}.state.keyRoot=9; {F}.save(); {F}.render(); }}")
    ids=await pg.evaluate(f"()=>Object.keys({F}.MOVES)"); mv={}
    for i in ids:
      r=await pg.evaluate("""async(id)=>{const f=window.__finishkit, q=window.__qa, pv=q.withMove(id); const sg=f.song(pv); await f.ensureInstruments([...new Set(sg.events.map(e=>e.i))].filter(i=>i!=='kit'));
        const w=await f.exportWavBytes({pv,all:true}), m=f.exportMidBytes({pv,all:true}); return {cat:f.MOVES[id].cat, bars:sg.totalBars, events:sg.events.length, chairs:[...new Set(sg.events.map(e=>e.ch))], wav:q.b64(w.bytes), mid:q.b64(m.bytes), name:w.name}}""",i)
      s=load(base64.b64decode(r['wav'])); fnm=OD+f'/move-{i}.mid'; open(fnm,'wb').write(base64.b64decode(r['mid'])); mf,info=midinfo(fnm); expf=round(r['bars']*4*60/92*48000); a=np.abs(s[3])
      mv[i]={'cat':r['cat'],'bars':r['bars'],'events':r['events'],'frames':s[2],'expected':expf,'peak_dBFS':round(20*np.log10(a.max()+1e-12),2),'midi_type':info['type'],'midi_len_ok':abs(info['length_s']-r['bars']*4*60/92)<1e-3,'midi_notes':sum(info['notes_per_track'])}
      mv[i]['pass']=mv[i]['frames']==expf and -1.5<mv[i]['peak_dBFS']<=-1 and info['type']==1 and mv[i]['midi_len_ok'] and mv[i]['midi_notes']>0
    cats={}
    for k,v in mv.items(): cats.setdefault(v['cat'],[]).append(k)
    ui=await pg.evaluate("""async()=>{const out={}; document.querySelector('details#allMovesBox, details')?.setAttribute('open',''); for(const c of [...document.querySelectorAll('#cats [data-cat]')].map(b=>b.dataset.cat)){ document.querySelector(`#cats [data-cat="${c}"]`).click(); await new Promise(r=>setTimeout(r,50)); out[c]=document.querySelectorAll('#allMoves [data-aud]').length; } return out;}""")
    res['moves']={'count':len(mv),'by_category':{k:len(v) for k,v in cats.items()},'browse_cards_by_category':ui,'failed':[k for k,v in mv.items() if not v['pass']],'detail':mv}
    dk=await pg.evaluate(f"""async()=>{{const f={F}, inp=document.getElementById('deskFind'), out={{}}; document.getElementById('browse').open=true;
      for(const k of Object.keys(f.DESKS).concat(Object.keys(f.DESK_NOTES))){{ inp.value=k; inp.dispatchEvent(new Event('input')); const cards=[...document.querySelectorAll('#allMoves .sug')].filter(c=>c.textContent.includes(k)); out[k]=cards.length; }}
      inp.value='WalkFour'; inp.dispatchEvent(new Event('input')); const all=()=>f.state.arr.flatMap(x=>x.moves), n0=all().length, before=new Set(all()); document.querySelector('#allMoves [data-add]').click(); const m=all().find(x=>!before.has(x))||{{}};
      const r={{found:out, walkfour_added:{{id:m.id, opts:m.opts, added:all().length-n0}}}}; inp.value=''; inp.dispatchEvent(new Event('input')); return r;}}""")
    res['moves']['old_desk_lookup']={'desks_found':sum(1 for v in dk['found'].values() if v>0),'desks_total':len(dk['found']),'missing':[k for k,v in dk['found'].items() if v==0],'walkfour_added':dk['walkfour_added']}
    res['moves']['pass']=not res['moves']['failed'] and len(cats)==5 and all(ui.get(k)==len(v) for k,v in cats.items()) and not res['moves']['old_desk_lookup']['missing'] and dk['walkfour_added']['opts'].get('style')=='walk'
    # ---- audio I/O
    await pg.click('#inBtn'); await pg.wait_for_timeout(1500)
    res['audio_io']={'inputs':await pg.evaluate("()=>[...document.getElementById('audioIn').options].map(o=>o.text)"),'outputs':await pg.evaluate("()=>[...document.getElementById('audioOut').options].map(o=>o.text)"),
      'setSinkId_supported':await pg.evaluate("()=>typeof AudioContext.prototype.setSinkId==='function'"),'in_state':await pg.text_content('#inState'),'meter_max_pct_3s':await pg.evaluate("async()=>{let m=0; for(let i=0;i<30;i++){ m=Math.max(m,parseFloat(document.getElementById('meter').style.width)||0); await new Promise(r=>setTimeout(r,100)); } return m;}")}
    await pg.evaluate("()=>{const s=document.getElementById('audioOut'); if(s.options.length>1){ s.value=s.options[1].value; s.dispatchEvent(new Event('change')); }}"); await pg.wait_for_timeout(500)
    res['audio_io']['sink_after_select']=await pg.evaluate(f"()=>{F}.ctx.sinkId"); res['audio_io']['out_note']=await pg.text_content('#audioOutNote')
    res['audio_io']['volume_sliders']=await pg.evaluate("()=>document.querySelectorAll('#mixer input[type=range]').length+(document.getElementById('master')?1:0)+(document.getElementById('liveGain')?1:0)")
    res['audio_io']['pass']=len(res['audio_io']['inputs'])>1 and res['audio_io']['meter_max_pct_3s']>0 and res['audio_io']['volume_sliders']>=16
    await pg.click('#inBtn')
    # ---- persistence
    await pg.fill('#chords','Dm Bb F C'); await pg.press('#chords','Tab'); await pg.fill('#bpm','128'); await pg.press('#bpm','Tab')
    await pg.evaluate(f"()=>{{ {F}.autoArrange(); {F}.render(); }}"); await pg.click('#loopSection')
    before=await pg.evaluate(f"()=>JSON.stringify({F}.state)")
    await pg.reload(); after=await pg.evaluate(f"()=>JSON.stringify({F}.state)")
    res['persist']={'equal_after_reload':before==after,'sample':await pg.evaluate(f"()=>({{bpm:document.getElementById('bpm').value,chords:document.getElementById('chords').value,key:document.getElementById('key').value,mode:document.getElementById('mode').value,sections:{F}.state.arr.length,loopSection:document.getElementById('loopSection').checked,midiOut:{F}.state.midiOut}})")}
    res['persist']['pass']=res['persist']['equal_after_reload'] and res['persist']['sample']['bpm']=='128'
    await boot(pg)
    res['license']={'buy':await pg.text_content('#buy'),'config':await pg.evaluate(f"()=>{F}.LEMON")}
    await pg.fill('#licKey','TEST-KEY'); await pg.click('#licBtn'); await pg.wait_for_timeout(300); res['license']['activate_msg']=await pg.text_content('#licState')
    await pg.click('#exportSongWav'); await pg.wait_for_timeout(200); res['license']['whole_song_gate']=await pg.text_content('#status')
    await pg.click('#exportStems'); await pg.wait_for_timeout(200); res['license']['stems_gate']=await pg.text_content('#status')
    res['license']['pass']='opening soon' in res['license']['buy'].lower() and 'opening soon' in res['license']['activate_msg'].lower() and 'licensed' in res['license']['whole_song_gate']
    async with pg.expect_download() as dl: await pg.click('#exportWav')
    d0=await dl.value; fp=OD+'/'+d0.suggested_filename; await d0.save_as(fp); res['license']['free_section_download']={'file':d0.suggested_filename,'frames':load(open(fp,'rb').read())[2]}
    await pg.click('#play'); await pg.wait_for_timeout(2500); await pg.screenshot(path=OD+'/shot-desk.png',full_page=True); await pg.screenshot(path=OD+'/shot-top.png'); await pg.click('#stopBtn')
    host=URL.split('/')[2]; ext=sorted(set(u.split('/')[2] for u in reqs if host not in u and not u.startswith(('data:','blob:'))))
    res['c5']={'external_hosts':ext,'sample_urls_pinned':all(re.search(r'@[0-9a-f]{40}/|/[0-9a-f]{40}/',u) for u in reqs if 'midi-js-soundfonts' in u),'sample_requests':sum(1 for u in reqs if 'midi-js-soundfonts' in u)}
    src=await pg.evaluate("()=>fetch('app.js').then(r=>r.text())"); html=await pg.evaluate("()=>fetch('index.html').then(r=>r.text())")
    exp_path=src[src.index('// ---------- export'):src.index('// ---------- Lemon')]
    res['c7']={'@main/@gh-pages':len(re.findall(r'@main|@gh-pages|/main/|/gh-pages/',src+html)),'FluidR3_pinned_sha':re.findall(r'SF_SHA = "([0-9a-f]+)"',src),'Math.random_total':src.count('Math.random'),'Math.random_export_path':exp_path.count('Math.random'),
      'setTimeout_used_for_notes':len(re.findall(r'setTimeout\([^)]*(playEvent|liveVoice|liveOn|scheduleStep)',src)),'compressor_in_export_path':exp_path.count('DynamicsCompressor'),'AudioContext_forced_rate':len(re.findall(r'new \(window\.AudioContext[^;]*\)\(\{',src)),
      'LOOKAHEAD_MS=25':'LOOKAHEAD_MS = 25' in src,'SCHEDULE_AHEAD=0.12':'SCHEDULE_AHEAD = 0.12' in src,'auth_or_db':len(re.findall(r'supabase|firebase|firestore|signIn|/api/auth',src+html,re.I)),'ios_silent_note':'silent' in html.lower()}
    vm=await pg.evaluate(f"()=>({{inst:Object.entries({F}.INST).map(([k,v])=>[k,v.dir,v.label]), kit:Object.entries({F}.KIT).map(([k,v])=>[k,v.file,v.label])}})")
    bad=[r for r in vm['inst'] if not any(tok in r[2].lower() for tok in r[1].split('_') if len(tok)>2)]+[r for r in vm['kit'] if not (r[0] in ('kick','snare','rim','ride','crash','shaker') and r[0] in r[2].lower() or r[0] in ('ghost','hat','ohat','htom','ltom','tamb'))]
    used=sorted({u.split('/FluidR3_GM/')[1].split('-mp3')[0] for u in reqs if '/FluidR3_GM/' in u}); res['c7']['voice_name_mismatches']=bad; res['c7']['voices']=vm; res['c7']['fluid_dirs_requested']=used
    res['c7']['requested_dirs_all_declared']=all(any(d==r[1] for r in vm['inst']) for d in used)
    res['c7']['pass']=res['c7']['@main/@gh-pages']==0 and len(res['c7']['FluidR3_pinned_sha'][0])==40 and res['c7']['Math.random_total']==0 and res['c7']['setTimeout_used_for_notes']==0 and res['c7']['compressor_in_export_path']==0 and res['c7']['AudioContext_forced_rate']==0 and res['c7']['LOOKAHEAD_MS=25'] and res['c7']['SCHEDULE_AHEAD=0.12'] and res['c7']['auth_or_db']==0 and not bad and res['c7']['requested_dirs_all_declared']
    res['errors']=errs; await ctx.close()
    # ---- blocked sample host: names the missing instruments
    bc=await br.new_context(viewport={'width':1280,'height':900}); bp=await bc.new_page(); berr=[]; bp.on('pageerror',lambda e:berr.append(str(e)))
    await bc.route(re.compile(r'.*(cdn\.jsdelivr\.net|raw\.githubusercontent\.com).*'),lambda r: r.abort())
    await bp.goto(URL); await bp.click('#tapBtn'); await bp.wait_for_timeout(8000); ls=await bp.text_content('#loadStatus')
    await bp.click('#play'); await bp.wait_for_timeout(1500); stt=await bp.text_content('#status')
    ex=await bp.evaluate(f"async()=>{{try{{await {F}.exportWavBytes(); return 'no error'}}catch(e){{return e.message}}}}")
    res['blocked_host']={'loadStatus':ls,'play_status':stt,'export_error':ex,'playing':await bp.evaluate(f"()=>!!{F}.play"),'errors':berr}
    res['blocked_host']['pass']='Piano' in ls and 'bass' in ls.lower() and 'Missing instruments' in ex and not res['blocked_host']['playing']; await bc.close()
    # ---- mobile
    mob={}
    for dev in ['iPhone 13','Pixel 7']:
      d=p.devices[dev]; mc=await br.new_context(**{k:v for k,v in d.items() if k!='default_browser_type'}); await mc.add_init_script(MOCK); mp=await mc.new_page(); merr=[]; mp.on('pageerror',lambda e:merr.append(str(e)))
      await mp.goto(URL); ios=await mp.evaluate("()=>!document.querySelector('.tap .ios').hidden"); await mp.screenshot(path=OD+f"/shot-{dev.replace(' ','-')}-tap.png"); await mp.tap('#tapBtn')
      await mp.wait_for_function("document.getElementById('loadStatus').textContent.startsWith('All')",timeout=90000)
      await mp.tap('#play'); await mp.wait_for_timeout(1500); steps=await mp.evaluate("()=>window.__schedLog.length")
      ov=await mp.evaluate("()=>({scrollW:document.documentElement.scrollWidth,innerW:innerWidth})"); fn=OD+f"/shot-{dev.replace(' ','-')}.png"; await mp.screenshot(path=fn); await mp.screenshot(path=fn.replace('.png','-full.png'),full_page=True)
      await mp.tap('#stopBtn'); mob[dev]={'viewport':d['viewport'],'ios_silent_note_shown':ios,'ctx':await mp.evaluate(f"()=>{F}.ctx.state"),'steps_scheduled_1_5s':steps,'no_horizontal_overflow':ov['scrollW']<=ov['innerW'],**ov,'errors':merr}
      mob[dev]['pass']=mob[dev]['ctx']=='running' and steps>0 and mob[dev]['no_horizontal_overflow'] and not merr and (ios if dev=='iPhone 13' else True)
      await mc.close()
    res['mobile']=mob
    res['summary']={k:v.get('pass') for k,v in res.items() if isinstance(v,dict) and 'pass' in v}
    for k in ('midi_pass','c1_other_pass'): res['summary'][k]=res[k]
    res['summary']['no_page_errors']=not errs
    print(json.dumps(res['summary'],indent=1)); json.dump(res,open(OUT,'w'),indent=1); await br.close()
if __name__=="__main__": asyncio.run(main())
