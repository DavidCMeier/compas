/* ============================================================
   COMPÁS — teoría musical
   Notas, escalas, modos, escala personalizada y derivación de acordes.
   ============================================================ */

const Theory = (() => {

  const SHARP_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const FLAT_NAMES  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  // Tonalidades que convencionalmente se escriben con bemoles
  const FLAT_KEYS = new Set(['F','Bb','Eb','Ab','Db','Gb']);

  const ROOTS = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

  const SCALES = [
    { id:'major',        name:'Mayor (Jónico)',      intervals:[0,2,4,5,7,9,11] },
    { id:'minor',        name:'Menor natural (Eólico)', intervals:[0,2,3,5,7,8,10] },
    { id:'harmMinor',    name:'Menor armónica',      intervals:[0,2,3,5,7,8,11] },
    { id:'melMinor',     name:'Menor melódica',      intervals:[0,2,3,5,7,9,11] },
    { id:'dorian',       name:'Dórico',              intervals:[0,2,3,5,7,9,10] },
    { id:'phrygian',     name:'Frigio',              intervals:[0,1,3,5,7,8,10] },
    { id:'lydian',       name:'Lidio',               intervals:[0,2,4,6,7,9,11] },
    { id:'mixolydian',   name:'Mixolidio',           intervals:[0,2,4,5,7,9,10] },
    { id:'locrian',      name:'Locrio',              intervals:[0,1,3,5,6,8,10] },
    { id:'phrygDom',     name:'Frigio dominante (española)', intervals:[0,1,4,5,7,8,10] },
    { id:'pentaMajor',   name:'Pentatónica mayor',   intervals:[0,2,4,7,9] },
    { id:'pentaMinor',   name:'Pentatónica menor',   intervals:[0,3,5,7,10] },
    { id:'blues',        name:'Blues',               intervals:[0,3,5,6,7,10] },
    { id:'custom',       name:'✳ Personalizada…',    intervals:null },
  ];

  const MAJOR_DEGREES = [0,2,4,5,7,9,11]; // base para la escala personalizada

  // ---- utilidades básicas -----------------------------------

  function rootIndex(root){ return FLAT_NAMES.indexOf(root) !== -1 ? FLAT_NAMES.indexOf(root) : SHARP_NAMES.indexOf(root); }

  function noteName(pc, key){
    pc = ((pc % 12) + 12) % 12;
    return (FLAT_KEYS.has(key) || key.includes('b')) ? FLAT_NAMES[pc] : SHARP_NAMES[pc];
  }

  function midiToName(midi, key){
    const pc = midi % 12;
    const oct = Math.floor(midi / 12) - 1;
    return noteName(pc, key) + oct;
  }

  // Escala efectiva (intervalos en semitonos) según selección
  function scaleIntervals(scaleId, customOffsets){
    if (scaleId === 'custom'){
      // customOffsets: array de 7 valores en {-1,0,1} sobre la escala mayor
      return MAJOR_DEGREES.map((s,i)=> s + (customOffsets?.[i] ?? 0));
    }
    const s = SCALES.find(s=>s.id===scaleId);
    return s ? s.intervals.slice() : MAJOR_DEGREES.slice();
  }

  // Pitch classes de la escala
  function scalePitchClasses(root, intervals){
    const r = rootIndex(root);
    return intervals.map(i => (r + i) % 12);
  }

  // Notas MIDI de la escala pintada dos octavas (de baseOct a baseOct+2)
  function scaleMidiTwoOctaves(root, intervals, baseOct){
    const r = rootIndex(root);
    const base = (baseOct + 1) * 12 + r;
    const out = [];
    for (let o = 0; o < 2; o++){
      for (const i of intervals) out.push(base + o*12 + i);
    }
    out.push(base + 24); // tónica final
    return out;
  }

  // ---- acordes ----------------------------------------------

  const CHORD_QUALITIES = [
    { name:'',      label:'',        ints:[0,4,7] },        // mayor
    { name:'m',     label:'m',       ints:[0,3,7] },
    { name:'dim',   label:'°',       ints:[0,3,6] },
    { name:'aug',   label:'+',       ints:[0,4,8] },
    { name:'sus2',  label:'sus2',    ints:[0,2,7] },
    { name:'sus4',  label:'sus4',    ints:[0,5,7] },
  ];
  const SEVENTH_QUALITIES = [
    { name:'maj7',  label:'maj7',    ints:[0,4,7,11] },
    { name:'7',     label:'7',       ints:[0,4,7,10] },
    { name:'m7',    label:'m7',      ints:[0,3,7,10] },
    { name:'m7b5',  label:'m7♭5',    ints:[0,3,6,10] },
    { name:'dim7',  label:'°7',      ints:[0,3,6,9] },
    { name:'mMaj7', label:'m(maj7)', ints:[0,3,7,11] },
    { name:'augMaj7',label:'+maj7',  ints:[0,4,8,11] },
  ];

  const ROMAN = ['I','II','III','IV','V','VI','VII'];

  function qualityFromIntervals(ints3){
    const key = ints3.join(',');
    const map = { '0,4,7':'', '0,3,7':'m', '0,3,6':'°', '0,4,8':'+' };
    return map[key] ?? null;
  }
  function seventhFromIntervals(ints4){
    const key = ints4.join(',');
    const map = { '0,4,7,11':'maj7','0,4,7,10':'7','0,3,7,10':'m7','0,3,6,10':'m7♭5','0,3,6,9':'°7','0,3,7,11':'m(maj7)','0,4,8,11':'+maj7','0,4,8,10':'+7' };
    return map[key] ?? null;
  }

  // Acordes diatónicos por superposición de terceras (escalas de 7 notas)
  function diatonicChords(root, intervals, key, withSevenths){
    const n = intervals.length;
    const pcs = scalePitchClasses(root, intervals);
    const chords = [];
    for (let d = 0; d < n; d++){
      const stack = withSevenths ? [0,2,4,6] : [0,2,4];
      const tones = stack.map(s => pcs[(d+s) % n]);
      const rootPc = tones[0];
      const rel = tones.map(t => ((t - rootPc) + 12) % 12).sort((a,b)=>a-b);
      const label = withSevenths ? seventhFromIntervals(rel) : qualityFromIntervals(rel);
      if (label === null) continue; // acorde no tercial reconocible
      const isMinorish = label.startsWith('m') || label.startsWith('°');
      let roman = ROMAN[d] ?? ('' + (d+1));
      if (isMinorish) roman = roman.toLowerCase();
      chords.push({
        degree: d,
        roman: roman + (label.includes('°') ? '°' : ''),
        name: noteName(rootPc, key) + label,
        rootPc,
        pcs: tones,
        midiNotes: chordMidi(rootPc, rel, 4),
      });
    }
    return chords;
  }

  // Para escalas no heptatónicas: acordes cuyos sonidos caben en la escala
  function compatibleChords(root, intervals, key, withSevenths){
    const pcsSet = new Set(scalePitchClasses(root, intervals));
    const quals = withSevenths ? SEVENTH_QUALITIES : CHORD_QUALITIES;
    const chords = [];
    for (const pc of pcsSet){
      for (const q of quals){
        const tones = q.ints.map(i => (pc + i) % 12);
        if (tones.every(t => pcsSet.has(t))){
          chords.push({
            degree: null,
            roman: '',
            name: noteName(pc, key) + q.label,
            rootPc: pc,
            pcs: tones,
            midiNotes: chordMidi(pc, q.ints, 4),
          });
        }
      }
    }
    return chords;
  }

  function chordMidi(rootPc, relIntervals, oct){
    const base = (oct + 1) * 12 + rootPc;
    return relIntervals.map(i => base + i);
  }

  function chordsFor(root, scaleId, customOffsets, withSevenths){
    const intervals = scaleIntervals(scaleId, customOffsets);
    if (intervals.length === 7) return diatonicChords(root, intervals, root, withSevenths);
    return compatibleChords(root, intervals, root, withSevenths);
  }

  // ---- progresiones sugeridas -------------------------------
  // grados en base 0 sobre la escala actual (solo heptatónicas)
  const PROGRESSIONS = [
    { name:'Pop clásica',        degrees:[0,4,5,3], hint:'I–V–vi–IV' },
    { name:'Balada emotiva',     degrees:[5,3,0,4], hint:'vi–IV–I–V' },
    { name:'Cadencia perfecta',  degrees:[0,3,4,0], hint:'I–IV–V–I' },
    { name:'Jazz ii–V–I',        degrees:[1,4,0,0], hint:'ii–V–I' },
    { name:'Andaluza',           degrees:[5,4,3,2], hint:'vi–V–IV–III (desc.)' },
    { name:'Doo-wop 50s',        degrees:[0,5,3,4], hint:'I–vi–IV–V' },
    { name:'Rock épica',         degrees:[0,6,3,0], hint:'I–VII–IV–I' },
    { name:'Melancólica',        degrees:[0,2,3,5], hint:'I–iii–IV–vi' },
  ];

  return {
    SHARP_NAMES, FLAT_NAMES, ROOTS, SCALES, PROGRESSIONS, MAJOR_DEGREES,
    rootIndex, noteName, midiToName,
    scaleIntervals, scalePitchClasses, scaleMidiTwoOctaves,
    chordsFor,
  };
})();
