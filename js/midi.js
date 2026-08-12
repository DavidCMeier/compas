/* ============================================================
   COMPÁS — lectura y escritura de ficheros MIDI estándar (SMF)
   Exporta formato 1 (una pista por línea + batería en canal 10).
   Importa formato 0 y 1 con cuantización al grid actual.
   ============================================================ */

const Midi = (() => {

  const PPQ = 480; // ticks por negra

  /* ---------- utilidades binarias ---------- */

  function vlq(n){
    // variable-length quantity
    const bytes = [n & 0x7f];
    n >>= 7;
    while (n > 0){ bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
    return bytes;
  }
  function u32(n){ return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]; }
  function u16(n){ return [(n>>>8)&255,n&255]; }
  function str(s){ return [...s].map(c=>c.charCodeAt(0)); }

  /* ---------- exportación ---------- */

  /**
   * song: {
   *   tempo, timeSig:{beats,unit}, bars, stepsPerBeat,
   *   tracks:[{name, gm, channel, notes:[{midi, start, len, vel}] }],  // start/len en pasos
   *   drums: {steps: {sound:[pasos absolutos]}} | null
   * }
   */
  function write(song){
    const stepTicks = stepTicksFor(song);
    const chunks = [];

    // pista 0: metadatos (tempo + compás)
    const meta = [];
    pushEvent(meta, 0, [0xff, 0x03, ...vlqLenStr('Compás')]);
    const usPerQuarter = Math.round(60000000 / song.tempo);
    pushEvent(meta, 0, [0xff, 0x51, 0x03, (usPerQuarter>>16)&255, (usPerQuarter>>8)&255, usPerQuarter&255]);
    const dd = Math.log2(song.timeSig.unit);
    pushEvent(meta, 0, [0xff, 0x58, 0x04, song.timeSig.beats, dd, 24, 8]);
    pushEvent(meta, 0, [0xff, 0x2f, 0x00]);
    chunks.push(trackChunk(meta));

    // pistas melódicas
    song.tracks.forEach((tr, i) => {
      const ch = tr.channel ?? (i % 15 >= 9 ? (i%15)+1 : i%15); // evita canal 9
      const ev = [];
      pushEvent(ev, 0, [0xff, 0x03, ...vlqLenStr(tr.name || ('Pista '+(i+1)))]);
      pushEvent(ev, 0, [0xC0 | ch, tr.gm ?? 0]);
      const events = [];
      for (const n of tr.notes){
        events.push({ tick: Math.round(n.start*stepTicks), data:[0x90|ch, n.midi, Math.round((n.vel??0.9)*127)] });
        events.push({ tick: Math.round((n.start+n.len)*stepTicks), data:[0x80|ch, n.midi, 0] });
      }
      writeSorted(ev, events);
      pushEvent(ev, 0, [0xff, 0x2f, 0x00]);
      chunks.push(trackChunk(ev));
    });

    // batería (canal 10 = índice 9)
    if (song.drums){
      const ev = [];
      pushEvent(ev, 0, [0xff, 0x03, ...vlqLenStr('Batería')]);
      const events = [];
      for (const [sound, steps] of Object.entries(song.drums.steps)){
        const gmNote = AudioEngine.DRUM_GM[sound];
        if (!gmNote) continue;
        for (const s of steps){
          events.push({ tick: Math.round(s*stepTicks), data:[0x99, gmNote, 100] });
          events.push({ tick: Math.round((s+0.5)*stepTicks), data:[0x89, gmNote, 0] });
        }
      }
      writeSorted(ev, events);
      pushEvent(ev, 0, [0xff, 0x2f, 0x00]);
      chunks.push(trackChunk(ev));
    }

    const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ)];
    const bytes = [...header];
    for (const c of chunks) bytes.push(...c);
    return new Uint8Array(bytes);
  }

  function stepTicksFor(song){
    // 1 paso = (1/stepsPerBeat) del pulso; el pulso es la figura del denominador
    return PPQ * (4 / song.timeSig.unit) / song.stepsPerBeat;
  }

  function vlqLenStr(s){ const b = str(s); return [...vlq(b.length), ...b]; }

  let _lastTick = 0;
  function pushEvent(arr, deltaTick, data){
    arr.push(...vlq(deltaTick), ...data);
  }
  function writeSorted(arr, events){
    events.sort((a,b) => a.tick - b.tick || (a.data[0]&0xf0) - (b.data[0]&0xf0));
    let last = 0;
    for (const e of events){
      pushEvent(arr, Math.max(0, e.tick - last), e.data);
      last = e.tick;
    }
  }
  function trackChunk(eventBytes){
    return [...str('MTrk'), ...u32(eventBytes.length), ...eventBytes];
  }

  /* ---------- importación ---------- */

  function read(buffer){
    const d = new DataView(buffer);
    let pos = 0;
    function u32r(){ const v = d.getUint32(pos); pos += 4; return v; }
    function u16r(){ const v = d.getUint16(pos); pos += 2; return v; }
    function u8r(){ return d.getUint8(pos++); }
    function chk(tag){
      const got = String.fromCharCode(u8r(),u8r(),u8r(),u8r());
      if (got !== tag) throw new Error(`MIDI inválido: se esperaba ${tag}, llegó ${got}`);
    }

    chk('MThd');
    const hlen = u32r();
    const format = u16r();
    const ntracks = u16r();
    const division = u16r();
    pos += hlen - 6;
    if (division & 0x8000) throw new Error('MIDI con división SMPTE no soportado');

    let tempo = 120;
    let timeSig = null;
    const tracks = []; // {name, gm, channel, notes:[{midi, tick, lenTicks, vel}]}

    for (let t = 0; t < ntracks; t++){
      chk('MTrk');
      const len = u32r();
      const end = pos + len;
      let tick = 0, running = 0;
      const open = new Map(); // "ch:note" -> {tick, vel}
      const tr = { name:'', gm:0, channel:0, notes:[] };

      function readVlq(){
        let v = 0, b;
        do { b = u8r(); v = (v<<7) | (b & 0x7f); } while (b & 0x80);
        return v;
      }

      while (pos < end){
        tick += readVlq();
        let status = u8r();
        if (status < 0x80){ pos--; status = running; } else running = status;
        const type = status & 0xf0, ch = status & 0x0f;

        if (type === 0x90 || type === 0x80){
          const note = u8r(), vel = u8r();
          const key = ch + ':' + note;
          if (type === 0x90 && vel > 0){
            open.set(key, { tick, vel });
          } else {
            const o = open.get(key);
            if (o){
              tr.notes.push({ midi:note, tick:o.tick, lenTicks: Math.max(1, tick - o.tick), vel:o.vel/127, channel:ch });
              open.delete(key);
            }
          }
          tr.channel = ch;
        }
        else if (type === 0xC0){ tr.gm = u8r(); tr.channel = ch; }
        else if (type === 0xA0 || type === 0xB0 || type === 0xE0){ pos += 2; }
        else if (type === 0xD0){ pos += 1; }
        else if (status === 0xff){
          const metaType = u8r();
          const mlen = readVlq();
          if (metaType === 0x51 && mlen === 3){
            const us = (u8r()<<16)|(u8r()<<8)|u8r();
            tempo = Math.round(60000000/us);
          } else if (metaType === 0x58 && mlen >= 2){
            const nn = u8r(), ddv = u8r();
            timeSig = { beats:nn, unit: Math.pow(2, ddv) };
            pos += mlen - 2;
          } else if (metaType === 0x03){
            let s=''; for (let i=0;i<mlen;i++) s += String.fromCharCode(u8r());
            tr.name = s;
          } else {
            pos += mlen;
          }
        }
        else if (status === 0xf0 || status === 0xf7){
          const slen = readVlq(); pos += slen;
        }
      }
      pos = end;
      if (tr.notes.length || tr.name) tracks.push(tr);
    }

    return { format, division, tempo, timeSig: timeSig ?? {beats:4, unit:4}, tracks };
  }

  return { write, read, PPQ, stepTicksFor };
})();
