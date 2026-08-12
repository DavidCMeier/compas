/* ============================================================
   COMPÁS — motor de audio (Web Audio API)
   Sintetiza todos los instrumentos sin samples externos:
   - sub  : sustractivo (osciladores + filtro + ADSR)
   - fm   : modulación de frecuencia (pianos eléctricos, campanas…)
   - pluck: Karplus–Strong (guitarras, bajo, arpa)
   - voice: filtros de formantes (voces)
   Además: batería sintetizada y metrónomo.
   ============================================================ */

const AudioEngine = (() => {
  let ctx = null;
  let master = null;
  let comp = null;
  let rendering = false; // true mientras se exporta a .wav (OfflineAudioContext)

  function ensure(){
    if (!ctx){
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 20; comp.ratio.value = 6;
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(comp).connect(ctx.destination);
    }
    if (!rendering && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function midiToFreq(m){ return 440 * Math.pow(2, (m - 69) / 12); }

  /* ---------- presets de instrumentos ---------- */
  // gm: número de programa General MIDI para exportar .mid
  const INSTRUMENTS = [
    { id:'piano',      name:'Piano acústico',     gm:0,   engine:'fm',    p:{ ratio:1, index:3.2, idxDecay:.25, attack:.004, decay:1.6, sustain:0, release:.35, gain:.8 } },
    { id:'epiano',     name:'Piano eléctrico',    gm:4,   engine:'fm',    p:{ ratio:2, index:2.2, idxDecay:.35, attack:.004, decay:1.9, sustain:0, release:.4, gain:.7 } },
    { id:'clavi',      name:'Clavinet',           gm:7,   engine:'fm',    p:{ ratio:3, index:4.5, idxDecay:.12, attack:.002, decay:.7, sustain:0, release:.15, gain:.6 } },
    { id:'organ',      name:'Órgano',             gm:16,  engine:'sub',   p:{ oscs:[['sine',0,1],['sine',12,.6],['sine',19,.35],['sine',24,.25]], attack:.02, decay:.1, sustain:.9, release:.12, cutoff:6000, gain:.4 } },
    { id:'accordion',  name:'Acordeón',           gm:21,  engine:'sub',   p:{ oscs:[['sawtooth',0,.6],['sawtooth',.12,.6],['square',12,.15]], attack:.06, decay:.1, sustain:.85, release:.15, cutoff:2800, gain:.35 } },
    { id:'guitar',     name:'Guitarra acústica',  gm:25,  engine:'pluck', p:{ damp:.45, bright:.7, gain:.9 } },
    { id:'eguitar',    name:'Guitarra eléctrica', gm:27,  engine:'pluck', p:{ damp:.3, bright:.5, gain:.9, drive:0 } },
    { id:'dguitar',    name:'Guitarra distorsión',gm:30,  engine:'pluck', p:{ damp:.25, bright:.6, gain:.7, drive:14 } },
    { id:'nylon',      name:'Guitarra española',  gm:24,  engine:'pluck', p:{ damp:.55, bright:.45, gain:.95 } },
    { id:'bass',       name:'Bajo eléctrico',     gm:33,  engine:'pluck', p:{ damp:.6, bright:.35, gain:1.1 } },
    { id:'synthbass',  name:'Bajo sintetizado',   gm:38,  engine:'sub',   p:{ oscs:[['sawtooth',0,.8],['square',-12,.5]], attack:.005, decay:.25, sustain:.6, release:.12, cutoff:900, cutEnv:1200, gain:.55 } },
    { id:'contrabass', name:'Contrabajo',         gm:43,  engine:'sub',   p:{ oscs:[['sawtooth',0,.7],['sine',0,.5]], attack:.06, decay:.2, sustain:.75, release:.2, cutoff:700, gain:.55 } },
    { id:'violin',     name:'Violín',             gm:40,  engine:'sub',   p:{ oscs:[['sawtooth',0,.7],['sawtooth',.08,.7]], attack:.12, decay:.2, sustain:.8, release:.25, cutoff:3800, vib:5.5, vibAmt:6, gain:.35 } },
    { id:'cello',      name:'Violonchelo',        gm:42,  engine:'sub',   p:{ oscs:[['sawtooth',0,.8],['sawtooth',-.09,.7]], attack:.1, decay:.2, sustain:.85, release:.3, cutoff:2200, vib:5, vibAmt:5, gain:.45 } },
    { id:'strings',    name:'Cuerdas (ensemble)', gm:48,  engine:'sub',   p:{ oscs:[['sawtooth',0,.6],['sawtooth',.15,.6],['sawtooth',-.15,.6]], attack:.3, decay:.3, sustain:.85, release:.6, cutoff:3200, gain:.3 } },
    { id:'harp',       name:'Arpa',               gm:46,  engine:'pluck', p:{ damp:.75, bright:.8, gain:.8 } },
    { id:'flute',      name:'Flauta',             gm:73,  engine:'sub',   p:{ oscs:[['sine',0,1],['triangle',12,.15]], attack:.08, decay:.15, sustain:.85, release:.2, cutoff:5000, breath:.02, vib:5, vibAmt:4, gain:.5 } },
    { id:'clarinet',   name:'Clarinete',          gm:71,  engine:'sub',   p:{ oscs:[['square',0,.5],['sine',0,.4]], attack:.07, decay:.15, sustain:.85, release:.18, cutoff:2600, gain:.4 } },
    { id:'trumpet',    name:'Trompeta',           gm:56,  engine:'sub',   p:{ oscs:[['sawtooth',0,.8]], attack:.05, decay:.15, sustain:.85, release:.15, cutoff:1800, cutEnv:2600, gain:.45 } },
    { id:'sax',        name:'Saxofón',            gm:65,  engine:'sub',   p:{ oscs:[['sawtooth',0,.7],['square',0,.25]], attack:.06, decay:.2, sustain:.8, release:.2, cutoff:2200, cutEnv:1500, vib:5, vibAmt:5, gain:.45 } },
    { id:'voiceAah',   name:'Voz «aah» (coro)',   gm:52,  engine:'voice', p:{ formants:[[700,.9,80],[1200,.5,90],[2600,.25,120]], attack:.18, decay:.3, sustain:.85, release:.4, vib:5, vibAmt:5, gain:.5 } },
    { id:'voiceOoh',   name:'Voz «ooh»',          gm:53,  engine:'voice', p:{ formants:[[380,.9,60],[800,.4,80],[2500,.12,120]], attack:.15, decay:.3, sustain:.85, release:.4, vib:5, vibAmt:5, gain:.55 } },
    { id:'marimba',    name:'Marimba',            gm:12,  engine:'fm',    p:{ ratio:4, index:1.6, idxDecay:.08, attack:.002, decay:.9, sustain:0, release:.25, gain:.7 } },
    { id:'vibra',      name:'Vibráfono',          gm:11,  engine:'fm',    p:{ ratio:3.5, index:1.2, idxDecay:.5, attack:.004, decay:2.2, sustain:0, release:.6, vib:4, vibAmt:4, gain:.6 } },
    { id:'musicbox',   name:'Caja de música',     gm:10,  engine:'fm',    p:{ ratio:5, index:2.0, idxDecay:.15, attack:.002, decay:1.4, sustain:0, release:.4, gain:.55 } },
    { id:'bells',      name:'Campanas',           gm:14,  engine:'fm',    p:{ ratio:3.01, index:4, idxDecay:.9, attack:.002, decay:2.8, sustain:0, release:1, gain:.5 } },
    { id:'lead',       name:'Lead sintetizador',  gm:81,  engine:'sub',   p:{ oscs:[['sawtooth',0,.8],['sawtooth',.1,.8]], attack:.01, decay:.15, sustain:.8, release:.15, cutoff:3500, cutEnv:2000, gain:.4 } },
    { id:'pad',        name:'Pad cálido',         gm:89,  engine:'sub',   p:{ oscs:[['sawtooth',0,.5],['triangle',.12,.7],['sawtooth',-12,.3]], attack:.6, decay:.4, sustain:.8, release:1.2, cutoff:1600, gain:.35 } },
  ];

  function preset(id){ return INSTRUMENTS.find(i=>i.id===id) || INSTRUMENTS[0]; }

  /* ---------- motores ---------- */

  function envGain(t, dur, p){
    const g = ctx.createGain();
    const a = p.attack ?? .01, d = p.decay ?? .2, s = p.sustain ?? .7, r = p.release ?? .2;
    const peak = p.gain ?? .5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (s > 0){
      g.gain.linearRampToValueAtTime(peak * s, t + a + d);
      g.gain.setValueAtTime(peak * s, Math.max(t + a + d, t + dur));
      g.gain.linearRampToValueAtTime(0.0001, t + dur + r);
    } else {
      g.gain.exponentialRampToValueAtTime(Math.max(peak,0.001) , t + a); // asegura pico
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + r);
    }
    return { node:g, end: t + (s>0 ? dur + r : (p.attack??0)+(p.decay??.2)+(p.release??.2)) + .05 };
  }

  function addVibrato(oscParams, freqParam, t, p){
    if (!p.vib) return;
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = p.vib;
    lg.gain.value = p.vibAmt ?? 4;
    lfo.connect(lg).connect(freqParam);
    lfo.start(t); lfo.stop(t + 12);
  }

  function playSub(p, midi, t, dur, vel, dest){
    const freq = midiToFreq(midi);
    const { node:env, end } = envGain(t, dur, { ...p, gain:(p.gain??.5)*vel });
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(p.cutoff ?? 4000, t);
    if (p.cutEnv){
      filt.frequency.linearRampToValueAtTime((p.cutoff??4000)+p.cutEnv, t + (p.attack??.05) + .05);
      filt.frequency.linearRampToValueAtTime(p.cutoff??4000, t + dur);
    }
    filt.Q.value = 1;
    filt.connect(env).connect(dest);
    for (const [type, det, amp] of p.oscs){
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * Math.pow(2, det/12);
      addVibrato(o, o.frequency, t, p);
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og).connect(filt);
      o.start(t); o.stop(end);
    }
    if (p.breath){
      const n = noiseSource(t, end - t);
      const ng = ctx.createGain(); ng.gain.value = p.breath;
      const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value = freq*2; bp.Q.value = 2;
      n.connect(bp).connect(ng).connect(env);
    }
  }

  function playFM(p, midi, t, dur, vel, dest){
    const freq = midiToFreq(midi);
    const { node:env, end } = envGain(t, dur, { ...p, sustain:0, gain:(p.gain??.6)*vel });
    const car = ctx.createOscillator(); car.frequency.value = freq;
    const mod = ctx.createOscillator(); mod.frequency.value = freq * p.ratio;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(freq * p.index, t);
    mg.gain.exponentialRampToValueAtTime(freq * p.index * .01 + .01, t + (p.idxDecay ?? .3) * 4);
    mod.connect(mg).connect(car.frequency);
    addVibrato(car, car.frequency, t, p);
    car.connect(env).connect(dest);
    car.start(t); car.stop(end);
    mod.start(t); mod.stop(end);
  }

  // Karplus–Strong con curva de ruido pre-generada
  function playPluck(p, midi, t, dur, vel, dest){
    const freq = midiToFreq(midi);
    const sr = ctx.sampleRate;
    const seconds = Math.min(Math.max(dur + .6, 1.2), 4);
    const N = Math.round(sr / freq);
    const buf = ctx.createBuffer(1, Math.ceil(sr * seconds), sr);
    const data = buf.getChannelData(0);
    // excitación: ruido filtrado según brillo
    let prevN = 0;
    for (let i = 0; i < N; i++){
      const white = Math.random()*2-1;
      prevN = p.bright * white + (1-p.bright) * prevN;
      data[i] = prevN;
    }
    // cuerda: promedio con amortiguación
    const dampCoef = 0.996 - 0.004 * p.damp;
    for (let i = N; i < data.length; i++){
      data[i] = dampCoef * 0.5 * (data[i-N] + data[i-N+1 < data.length ? i-N+1 : i-N]);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime((p.gain ?? .8) * vel, t);
    g.gain.setValueAtTime((p.gain ?? .8) * vel, t + seconds - .3);
    g.gain.linearRampToValueAtTime(0, t + seconds);
    let chainOut = g;
    if (p.drive){
      const sh = ctx.createWaveShaper();
      sh.curve = distCurve(p.drive);
      const post = ctx.createGain(); post.gain.value = .5;
      src.connect(sh).connect(g);
      g.connect(post); chainOut = post;
    } else {
      src.connect(g);
    }
    chainOut.connect(dest);
    src.start(t); src.stop(t + seconds);
  }

  function distCurve(amount){
    const k = amount, n = 512, curve = new Float32Array(n);
    for (let i = 0; i < n; i++){
      const x = i*2/n - 1;
      curve[i] = (3+k) * x * 20 * (Math.PI/180) / (Math.PI + k*Math.abs(x));
    }
    return curve;
  }

  function playVoice(p, midi, t, dur, vel, dest){
    const freq = midiToFreq(midi);
    const { node:env, end } = envGain(t, dur, { ...p, gain:(p.gain??.5)*vel });
    env.connect(dest);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    addVibrato(o, o.frequency, t, p);
    const pre = ctx.createGain(); pre.gain.value = 1;
    o.connect(pre);
    for (const [f, amp, q] of p.formants){
      const bp = ctx.createBiquadFilter();
      bp.type='bandpass'; bp.frequency.value=f; bp.Q.value = f/q;
      const fg = ctx.createGain(); fg.gain.value = amp;
      pre.connect(bp).connect(fg).connect(env);
    }
    o.start(t); o.stop(end);
  }

  let noiseBuf = null;
  function noiseSource(t, dur){
    if (!noiseBuf){
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
    }
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    s.start(t); s.stop(t + dur + .1);
    return s;
  }

  /* ---------- batería ---------- */

  const DRUM_SOUNDS = ['kick','snare','hatC','hatO','tomL','tomH','clap','crash','ride'];
  const DRUM_LABELS = { kick:'Bombo', snare:'Caja', hatC:'Hi-hat', hatO:'Hi-hat abierto', tomL:'Tom grave', tomH:'Tom agudo', clap:'Palmada', crash:'Crash', ride:'Ride' };
  // Notas GM canal 10
  const DRUM_GM = { kick:36, snare:38, hatC:42, hatO:46, tomL:45, tomH:50, clap:39, crash:49, ride:51 };

  function playDrum(sound, t, vel, dest){
    vel = vel ?? 1;
    const out = dest || master;
    switch(sound){
      case 'kick': {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(45, t + .1);
        g.gain.setValueAtTime(1.1*vel, t);
        g.gain.exponentialRampToValueAtTime(.001, t + .35);
        o.connect(g).connect(out); o.start(t); o.stop(t+.4);
        break;
      }
      case 'snare': {
        const n = noiseSource(t, .2), ng = ctx.createGain();
        const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=1400;
        ng.gain.setValueAtTime(.7*vel, t);
        ng.gain.exponentialRampToValueAtTime(.001, t+.18);
        n.connect(hp).connect(ng).connect(out);
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type='triangle'; o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(140, t+.1);
        og.gain.setValueAtTime(.5*vel, t);
        og.gain.exponentialRampToValueAtTime(.001, t+.12);
        o.connect(og).connect(out); o.start(t); o.stop(t+.15);
        break;
      }
      case 'hatC': case 'hatO': {
        const dur = sound==='hatC' ? .05 : .3;
        const n = noiseSource(t, dur), g = ctx.createGain();
        const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=7000;
        g.gain.setValueAtTime(.35*vel, t);
        g.gain.exponentialRampToValueAtTime(.001, t+dur);
        n.connect(hp).connect(g).connect(out);
        break;
      }
      case 'tomL': case 'tomH': {
        const f = sound==='tomL' ? 110 : 180;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f*.55, t+.25);
        g.gain.setValueAtTime(.8*vel, t);
        g.gain.exponentialRampToValueAtTime(.001, t+.3);
        o.connect(g).connect(out); o.start(t); o.stop(t+.35);
        break;
      }
      case 'clap': {
        for (let i=0;i<3;i++){
          const tt = t + i*.012;
          const n = noiseSource(tt, .1), g = ctx.createGain();
          const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1100; bp.Q.value=1.5;
          g.gain.setValueAtTime(.5*vel, tt);
          g.gain.exponentialRampToValueAtTime(.001, tt+.09);
          n.connect(bp).connect(g).connect(out);
        }
        break;
      }
      case 'crash': case 'ride': {
        const dur = sound==='crash' ? 1.2 : .5;
        const n = noiseSource(t, dur), g = ctx.createGain();
        const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value = sound==='crash'?5000:6500;
        g.gain.setValueAtTime((sound==='crash'?.5:.28)*vel, t);
        g.gain.exponentialRampToValueAtTime(.001, t+dur);
        n.connect(hp).connect(g).connect(out);
        break;
      }
    }
  }

  function playClick(t, accent){
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1600 : 1100;
    g.gain.setValueAtTime(accent ? .4 : .22, t);
    g.gain.exponentialRampToValueAtTime(.001, t + .05);
    o.connect(g).connect(master);
    o.start(t); o.stop(t+.06);
  }

  /* ---------- API pública ---------- */

  let trackGains = new Map(); // trackId -> GainNode

  function trackGain(trackId, volume){
    ensure();
    if (!trackGains.has(trackId)){
      const g = ctx.createGain();
      g.connect(master);
      trackGains.set(trackId, g);
    }
    const g = trackGains.get(trackId);
    if (volume !== undefined) g.gain.value = volume;
    return g;
  }

  function playNote(instrumentId, midi, when, dur, vel, trackId, volume){
    ensure();
    const t = when ?? ctx.currentTime;
    const dest = trackId != null ? trackGain(trackId, volume) : master;
    const inst = preset(instrumentId);
    vel = vel ?? .9;
    try {
      switch(inst.engine){
        case 'sub':   playSub(inst.p, midi, t, dur, vel, dest); break;
        case 'fm':    playFM(inst.p, midi, t, dur, vel, dest); break;
        case 'pluck': playPluck(inst.p, midi, t, dur, vel, dest); break;
        case 'voice': playVoice(inst.p, midi, t, dur, vel, dest); break;
      }
    } catch(e){ console.warn('audio error', e); }
  }

  function playChord(instrumentId, midis, dur){
    ensure();
    const t = ctx.currentTime + .02;
    midis.forEach((m,i) => playNote(instrumentId, m, t + i*.012, dur ?? 1.2, .8));
  }

  /* ---------- exportación a .wav (render offline) ---------- */

  // Ejecuta scheduleFn con el motor apuntando a un OfflineAudioContext
  // y devuelve un Blob WAV (16-bit PCM estéreo).
  async function renderToWav(durationSec, scheduleFn){
    ensure();
    const sr = 44100;
    const off = new OfflineAudioContext(2, Math.ceil(sr * Math.max(1, durationSec)), sr);

    const saved = { ctx, master, comp, noiseBuf, trackGains };
    rendering = true;
    ctx = off;
    noiseBuf = null;
    trackGains = new Map();
    comp = off.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 20; comp.ratio.value = 6;
    master = off.createGain();
    master.gain.value = saved.master.gain.value;
    master.connect(comp).connect(off.destination);

    try {
      scheduleFn();
      const buf = await off.startRendering();
      return bufferToWavBlob(buf);
    } finally {
      ({ ctx, master, comp, noiseBuf, trackGains } = saved);
      rendering = false;
    }
  }

  function bufferToWavBlob(buf){
    const numCh = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
    const bytesPerSample = 2, blockAlign = numCh * bytesPerSample;
    const dataSize = len * blockAlign;
    const ab = new ArrayBuffer(44 + dataSize);
    const v = new DataView(ab);
    const wstr = (o, s) => { for (let i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)); };
    wstr(0,'RIFF'); v.setUint32(4, 36 + dataSize, true); wstr(8,'WAVE');
    wstr(12,'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * blockAlign, true); v.setUint16(32, blockAlign, true);
    v.setUint16(34, 16, true);
    wstr(36,'data'); v.setUint32(40, dataSize, true);
    const chans = [];
    for (let c=0;c<numCh;c++) chans.push(buf.getChannelData(c));
    let o = 44;
    for (let i=0;i<len;i++){
      for (let c=0;c<numCh;c++){
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        o += 2;
      }
    }
    return new Blob([ab], { type:'audio/wav' });
  }

  return {
    ensure,
    renderToWav,
    now: () => { ensure(); return ctx.currentTime; },
    sampleRate: () => { ensure(); return ctx.sampleRate; },
    INSTRUMENTS, preset,
    DRUM_SOUNDS, DRUM_LABELS, DRUM_GM,
    playNote, playChord,
    playDrum: (s,t,v) => { ensure(); playDrum(s, t ?? ctx.currentTime, v, master); },
    playClick: (t,a) => { ensure(); playClick(t ?? ctx.currentTime, a); },
    trackGain,
    setMasterVolume: v => { ensure(); master.gain.value = v; },
  };
})();
