/* ============================================================
   COMPÁS — lógica de la aplicación
   Estado (v2 con secciones), secuenciador, piano-roll, batería,
   progresiones + arpegiador, círculo de quintas, letras con
   métrica, grabadora de ideas, import/export (.json/.mid/.wav)
   y guardado local.
   ============================================================ */

(() => {

const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
};

const STORAGE_KEY = 'compas-song-v1';
const DRUMS_ID = '__drums__';
const SECTION_NAMES = ['Estrofa','Estribillo','Puente','Intro','Final','Solo','Pre-estribillo'];

/* ==================== estado ==================== */

function newSection(name, bars){
  return {
    id: uid(),
    name: name ?? 'Sección',
    bars: bars ?? 4,
    notes: {},                                    // trackId -> [{midi,start,len,vel}]
    drums: { style: 'rock', steps: emptyDrums() },
    progression: Array(bars ?? 4).fill(null),
  };
}

function defaultState(){
  const sec = newSection('Estrofa', 4);
  return {
    version: 2,
    title: 'Mi canción',
    key: 'C',
    scaleId: 'major',
    customOffsets: [0,0,0,0,0,0,0],
    tempo: 100,
    timeSig: { beats: 4, unit: 4 },
    swing: 0,
    humanize: 0,
    metronome: false,
    masterVol: 0.85,
    baseOct: 3,
    seventh: false,
    arpMode: 'block',
    playMode: 'section',
    drumsMute: false,
    tracks: [
      { id: uid(), name: 'Guitarra', instrument: 'guitar', volume: 0.9, mute: false },
      { id: uid(), name: 'Bajo',     instrument: 'bass',   volume: 0.9, mute: false },
    ],
    sections: [sec],
    arrangement: [sec.id],
    recordings: [],
    customChords: [],   // [{id, name, root (pc), intervals: [semitonos]}]
    lyrics: '',
  };
}

function emptyDrums(){
  const o = {};
  for (const s of AudioEngine.DRUM_SOUNDS) o[s] = [];
  return o;
}

function uid(){ return Math.random().toString(36).slice(2, 9); }

/* migración desde proyectos v1 (sin secciones) */
function migrate(s){
  if (s.version === 2){
    for (const sec of s.sections)
      for (const snd of AudioEngine.DRUM_SOUNDS) sec.drums.steps[snd] ??= [];
    return { ...defaultState(), ...s };
  }
  const base = defaultState();
  const sec = newSection('Estrofa', s.bars ?? 4);
  sec.drums.style = s.drums?.style ?? 'rock';
  sec.drums.steps = { ...emptyDrums(), ...(s.drums?.steps ?? {}) };
  sec.progression = s.progression ?? Array(sec.bars).fill(null);
  const tracks = (s.tracks ?? base.tracks).map(t => {
    sec.notes[t.id] = t.notes ?? [];
    return { id: t.id, name: t.name, instrument: t.instrument, volume: t.volume ?? .9, mute: !!t.mute };
  });
  return {
    ...base,
    title: s.title ?? base.title, key: s.key ?? 'C', scaleId: s.scaleId ?? 'major',
    customOffsets: s.customOffsets ?? base.customOffsets,
    tempo: s.tempo ?? 100, timeSig: s.timeSig ?? {beats:4,unit:4},
    swing: s.swing ?? 0, metronome: !!s.metronome, masterVol: s.masterVol ?? .85,
    seventh: !!s.seventh, drumsMute: !!(s.drums?.mute),
    tracks, sections: [sec], arrangement: [sec.id],
    lyrics: s.lyrics ?? '',
  };
}

let state = loadState() || defaultState();
let activeSectionId = state.sections[0].id;
let activeTrackId = state.tracks[0]?.id ?? DRUMS_ID;
let insertCursor = 0;
let noteLenSteps = null;

/* ---- derivados ---- */
const stepsPerBeat = () => state.timeSig.unit === 8 ? 2 : 4;
const stepsPerBar  = () => state.timeSig.beats * stepsPerBeat();
const stepDur      = () => (60 / state.tempo) * (4 / state.timeSig.unit) / stepsPerBeat();
const currentIntervals = () => Theory.scaleIntervals(state.scaleId, state.customOffsets);
const activeTrack  = () => state.tracks.find(t => t.id === activeTrackId);
const isDrumsActive = () => activeTrackId === DRUMS_ID;
const defaultNoteLen = () => noteLenSteps ?? stepsPerBeat();
const activeSection = () => state.sections.find(s => s.id === activeSectionId) ?? state.sections[0];
const totalSteps   = () => activeSection().bars * stepsPerBar();
const secNotes = (trackId) => {
  const sec = activeSection();
  return (sec.notes[trackId] ??= []);
};

/* ==================== persistencia ==================== */

function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.tracks) return null;
    return migrate(s);
  } catch { return null; }
}

let saveTimer = null;
let quotaWarned = false;
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      const m = $('#autosaveMsg');
      m.textContent = 'Guardado ✓ ' + new Date().toLocaleTimeString();
      setTimeout(()=> m.textContent = 'Todo se guarda automáticamente en este dispositivo.', 2500);
    } catch {
      if (!quotaWarned){
        quotaWarned = true;
        toast('⚠ El proyecto no cabe en el almacenamiento local (probablemente por las grabaciones). Expórtalo como .json para no perderlo.');
      }
    }
  }, 350);
}

function toast(msg){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> t.classList.add('hidden'), 3200);
}

/* ==================== render: tonalidad y escala ==================== */

function renderRoots(){
  const g = $('#rootGrid');
  g.innerHTML = '';
  for (const r of Theory.ROOTS){
    const b = el('button', 'root-btn' + (state.key === r ? ' active' : ''), r);
    b.onclick = () => { state.key = r; onTheoryChange(); };
    g.appendChild(b);
  }
}

/* ---- círculo de quintas ---- */

const FIFTHS = ['C','G','D','A','E','B','Gb','Db','Ab','Eb','Bb','F'];
const MINOR_FAMILY = new Set(['minor','harmMinor','melMinor','pentaMinor','blues']);

function renderCircle(){
  const wrap = $('#circleFifths');
  wrap.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 230 230');
  const cx = 115, cy = 115;

  const keyPc = Theory.rootIndex(state.key);
  const isMinor = MINOR_FAMILY.has(state.scaleId);
  // índice activo en el círculo
  let activeIdx = -1;
  FIFTHS.forEach((f, i) => {
    const fpc = Theory.rootIndex(f);
    if (!isMinor && fpc === keyPc) activeIdx = i;
    if (isMinor && (fpc + 9) % 12 === keyPc) activeIdx = i;
  });

  const wedge = (r1, r2, i) => {
    const a1 = (i * 30 - 105) * Math.PI / 180;
    const a2 = (i * 30 - 75) * Math.PI / 180;
    const p = (r, a) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d',
      `M ${p(r1, a1)} A ${r1} ${r1} 0 0 1 ${p(r1, a2)} L ${p(r2, a2)} A ${r2} ${r2} 0 0 0 ${p(r2, a1)} Z`);
    return path;
  };
  const label = (r, i, txt, minor) => {
    const a = (i * 30 - 90) * Math.PI / 180;
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', cx + r * Math.cos(a));
    t.setAttribute('y', cy + r * Math.sin(a));
    t.setAttribute('class', 'cf-label' + (minor ? ' minor' : ''));
    t.textContent = txt;
    return t;
  };

  // el vii° de la tonalidad vive en el anillo interior, dos posiciones a la derecha
  const dimIdx = activeIdx >= 0 ? (activeIdx + 2) % 12 : -1;

  FIFTHS.forEach((f, i) => {
    const near = activeIdx >= 0 && (i === (activeIdx + 1) % 12 || i === (activeIdx + 11) % 12);
    // exterior: mayor
    const wOut = wedge(110, 72, i);
    wOut.setAttribute('class', 'cf-seg'
      + (i === activeIdx && !isMinor ? ' active' : '')
      + (near || (i === activeIdx && isMinor) ? ' near' : ''));
    wOut.addEventListener('click', () => {
      state.key = f;
      if (MINOR_FAMILY.has(state.scaleId) || state.scaleId === 'custom') state.scaleId = 'major';
      onTheoryChange();
    });
    svg.appendChild(wOut);
    svg.appendChild(label(91, i, f, false));

    // interior: relativa menor (o el vii° de la tonalidad activa)
    const minorRoot = Theory.ROOTS[(Theory.rootIndex(f) + 9) % 12];
    const isDim = i === dimIdx;
    const wIn = wedge(72, 40, i);
    wIn.setAttribute('class', 'cf-seg'
      + (i === activeIdx && isMinor ? ' active-minor' : '')
      + (near || (i === activeIdx && !isMinor) ? ' near' : '')
      + (isDim ? ' dim7th' : ''));
    wIn.addEventListener('click', () => {
      state.key = minorRoot;
      state.scaleId = 'minor';
      onTheoryChange();
    });
    svg.appendChild(wIn);
    svg.appendChild(label(56, i, minorRoot + (isDim ? '°' : 'm'), true));
  });

  wrap.appendChild(svg);
}

function renderScaleSelect(){
  const sel = $('#scaleSel');
  sel.innerHTML = '';
  for (const s of Theory.SCALES){
    const o = el('option', '', s.name);
    o.value = s.id;
    sel.appendChild(o);
  }
  sel.value = state.scaleId;
  $('#customScale').classList.toggle('hidden', state.scaleId !== 'custom');
  renderDegreeGrid();
}

function renderDegreeGrid(){
  const g = $('#degreeGrid');
  g.innerHTML = '';
  const alts = [ {v:1, l:'♯'}, {v:0, l:'♮'}, {v:-1, l:'♭'} ];
  for (let d = 0; d < 7; d++){
    const box = el('div', 'degree');
    box.appendChild(el('div', 'dnum', String(d+1)));
    const altBox = el('div', 'alts');
    for (const a of alts){
      const b = el('button', 'alt-btn' + ((state.customOffsets[d] ?? 0) === a.v ? ' active' : ''), a.l);
      if (d === 0 && a.v !== 0) b.disabled = true;
      b.onclick = () => { state.customOffsets[d] = a.v; onTheoryChange(); };
      altBox.appendChild(b);
    }
    box.appendChild(altBox);
    g.appendChild(box);
  }
}

function renderScaleStrip(){
  const strip = $('#scaleStrip');
  strip.innerHTML = '';
  const ints = currentIntervals();
  const midis = Theory.scaleMidiTwoOctaves(state.key, ints, state.baseOct + 1);
  const n = ints.length;
  midis.forEach((m, i) => {
    const degree = i % n;
    const isRoot = degree === 0;
    const oct2 = i >= n;
    const b = el('div', 'scale-note' + (isRoot ? ' is-root' : '') + (oct2 ? ' oct2' : ''));
    b.appendChild(el('div', 'nname', Theory.midiToName(m, state.key)));
    b.appendChild(el('div', 'ndeg', isRoot ? '1' : String(degree + 1)));
    b.onclick = () => {
      AudioEngine.playNote(activeTrack()?.instrument ?? 'piano', m, undefined, 0.8, 0.9);
      b.classList.add('flash');
      setTimeout(()=> b.classList.remove('flash'), 300);
    };
    strip.appendChild(b);
  });
}

/* ==================== render: acordes ==================== */

let chordPalette = [];

function renderChords(){
  chordPalette = Theory.chordsFor(state.key, state.scaleId, state.customOffsets, state.seventh);
  // acordes propios del usuario, siempre visibles
  for (const cc of state.customChords){
    chordPalette.push({
      degree: null,
      roman: '✳',
      name: cc.name,
      rootPc: cc.root,
      midiNotes: cc.intervals.map(i => 60 + cc.root + i),
      custom: true,
      id: cc.id,
    });
  }
  const g = $('#chordGrid');
  g.innerHTML = '';
  for (const ch of chordPalette){
    const chip = el('div', 'chord-chip' + (ch.custom ? ' custom' : ''));
    const main = el('button', 'cmain');
    main.appendChild(el('span', 'cname', ch.name));
    if (ch.roman) main.appendChild(el('span', 'croman', ch.roman));
    main.onclick = () => AudioEngine.playChord(activeTrack()?.instrument ?? 'piano', ch.midiNotes, 1.4);
    main.title = 'Escuchar ' + ch.name;
    const add = el('button', 'cadd', '＋');
    add.title = 'Insertar en el paso marcado de la pista activa';
    add.onclick = () => insertChord(ch);
    chip.appendChild(main);
    chip.appendChild(add);
    if (ch.custom){
      const del = el('button', 'cadd cdel', '✕');
      del.title = 'Eliminar este acorde propio';
      del.onclick = () => {
        if (!confirm(`¿Eliminar el acorde «${ch.name}»?`)) return;
        state.customChords = state.customChords.filter(c => c.id !== ch.id);
        renderChords(); renderProgLane(); save();
      };
      chip.appendChild(del);
    }
    g.appendChild(chip);
  }
  $('#btnTriads').classList.toggle('active', !state.seventh);
  $('#btnSevenths').classList.toggle('active', state.seventh);
}

/* ---- creador de acordes propios ---- */

const INTERVAL_LABELS = ['1','♭2','2','♭3','3','4','♭5','5','♯5','6','♭7','7',
                         '8','♭9','9','♯9','10','11','♯11','12','♭13','13','♭14','14','15'];
let cbSelected = new Set([0, 4, 7]);

function renderChordBuilder(){
  const rootSel = $('#cbRoot');
  if (!rootSel.options.length){
    for (const r of Theory.ROOTS){
      const o = el('option', '', r); o.value = r; rootSel.appendChild(o);
    }
  }
  rootSel.value = Theory.ROOTS.includes(state.key) ? state.key : 'C';
  const grid = $('#cbIntervals');
  grid.innerHTML = '';
  INTERVAL_LABELS.forEach((lbl, semis) => {
    const b = el('button', 'int-btn' + (cbSelected.has(semis) ? ' active' : ''), lbl);
    if (semis === 0){ b.disabled = true; b.classList.add('active'); }
    else b.onclick = () => {
      if (cbSelected.has(semis)) cbSelected.delete(semis);
      else cbSelected.add(semis);
      b.classList.toggle('active');
    };
    if (semis === 12) b.classList.add('octave-mark');
    grid.appendChild(b);
  });
}

function builderMidis(){
  const rootPc = Theory.rootIndex($('#cbRoot').value);
  return [...cbSelected].sort((a,b)=>a-b).map(i => 60 + rootPc + i);
}

function saveCustomChord(){
  if (cbSelected.size < 2){ toast('Elige al menos un intervalo además de la fundamental.'); return; }
  const root = $('#cbRoot').value;
  let name = $('#cbName').value.trim() || (root + ' pers.');
  const used = new Set([...chordPalette.map(c => c.name)]);
  let final = name, n = 2;
  while (used.has(final)) final = name + ' (' + n++ + ')';
  state.customChords.push({
    id: uid(),
    name: final,
    root: Theory.rootIndex(root),
    intervals: [...cbSelected].sort((a,b)=>a-b),
  });
  $('#chordBuilder').classList.add('hidden');
  $('#cbName').value = '';
  renderChords(); renderProgLane(); save();
  toast('Acorde «' + final + '» guardado. Lo tienes en la paleta y en las progresiones.');
}

function insertChord(ch){
  if (isDrumsActive()){ toast('Selecciona una línea melódica para insertar acordes.'); return; }
  const tr = activeTrack();
  if (!tr) return;
  const notes = secNotes(tr.id);
  const len = defaultNoteLen();
  const start = Math.min(insertCursor, totalSteps() - 1);
  const fitted = fitToRoll(ch.midiNotes);
  for (const m of fitted){
    const filtered = notes.filter(n => !(n.midi === m && overlaps(n, start, len)));
    notes.length = 0; notes.push(...filtered);
    notes.push({ midi: m, start, len: Math.min(len, totalSteps() - start), vel: 0.9 });
  }
  insertCursor = Math.min(start + len, totalSteps() - 1);
  AudioEngine.playChord(tr.instrument, fitted, len * stepDur());
  renderRoll(); save();
}

function overlaps(note, start, len){
  return note.start < start + len && start < note.start + note.len;
}

// Pliega las notas de un acorde dentro del rango visible del roll
// (dos octavas desde la tónica grave); crea inversiones si hace falta.
function fitToRoll(midis){
  const bottom = (state.baseOct + 1) * 12 + Theory.rootIndex(state.key);
  const top = bottom + 24;
  return [...new Set(midis.map(m => {
    while (m > top) m -= 12;
    while (m < bottom) m += 12;
    return m;
  }))];
}

function renderProgSuggestions(){
  const box = $('#progSuggestions');
  box.innerHTML = '';
  for (const p of Theory.PROGRESSIONS){
    const b = el('button', 'prog-sug');
    const left = el('div');
    left.appendChild(el('div', 'pname', p.name));
    left.appendChild(el('div', 'phint', p.hint));
    b.appendChild(left);
    b.appendChild(el('span', 'phint', '→ usar'));
    b.onclick = () => applyProgressionSuggestion(p);
    box.appendChild(b);
  }
}

function applyProgressionSuggestion(p){
  const byDegree = new Map(chordPalette.filter(c => c.degree !== null).map(c => [c.degree, c]));
  if (byDegree.size === 0){ toast('Esta escala no tiene acordes por grados; elige una escala de 7 notas.'); return; }
  const sec = activeSection();
  sec.progression = Array.from({length: sec.bars}, (_, i) => {
    const deg = p.degrees[i % p.degrees.length];
    const ch = byDegree.get(deg);
    return ch ? { name: ch.name, midiNotes: ch.midiNotes.slice() } : null;
  });
  renderProgLane(); save();
  toast(`Progresión «${p.name}» cargada en «${sec.name}».`);
}

/* ==================== render: secciones y estructura ==================== */

function renderSections(){
  const tabs = $('#sectionTabs');
  tabs.innerHTML = '';
  for (const sec of state.sections){
    const tab = el('div', 'section-tab' + (sec.id === activeSectionId ? ' active' : ''));
    const name = el('span', '', sec.name);
    name.style.cursor = 'pointer';
    name.onclick = () => {
      if (sec.id !== activeSectionId){
        activeSectionId = sec.id;
        insertCursor = 0;
        $('#bars').value = sec.bars;
        renderSections(); renderWorkspace(); renderProgLane();
      }
    };
    name.ondblclick = () => {
      const nn = prompt('Nombre de la sección:', sec.name);
      if (nn){ sec.name = nn.trim() || sec.name; renderSections(); renderArrangement(); save(); }
    };
    tab.appendChild(name);
    if (sec.id === activeSectionId){
      const dup = el('span', 'sx', '⧉');
      dup.title = 'Duplicar sección';
      dup.onclick = (e) => { e.stopPropagation(); duplicateSection(sec); };
      tab.appendChild(dup);
      if (state.sections.length > 1){
        const x = el('span', 'sx', '✕');
        x.title = 'Eliminar sección';
        x.onclick = (e) => {
          e.stopPropagation();
          if (!confirm(`¿Eliminar la sección «${sec.name}» y sus notas?`)) return;
          state.sections = state.sections.filter(s => s.id !== sec.id);
          state.arrangement = state.arrangement.filter(id => id !== sec.id);
          activeSectionId = state.sections[0].id;
          $('#bars').value = activeSection().bars;
          renderSections(); renderArrangement(); renderWorkspace(); renderProgLane(); save();
        };
        tab.appendChild(x);
      }
    }
    tabs.appendChild(tab);
  }
}

function duplicateSection(sec){
  const copy = JSON.parse(JSON.stringify(sec));
  copy.id = uid();
  copy.name = sec.name + ' (copia)';
  state.sections.splice(state.sections.indexOf(sec) + 1, 0, copy);
  activeSectionId = copy.id;
  renderSections(); renderArrangement(); renderWorkspace(); renderProgLane(); save();
}

function addSection(){
  const used = new Set(state.sections.map(s => s.name));
  const name = SECTION_NAMES.find(n => !used.has(n)) ?? ('Sección ' + (state.sections.length + 1));
  const sec = newSection(name, activeSection().bars);
  sec.drums.style = activeSection().drums.style;
  state.sections.push(sec);
  state.arrangement.push(sec.id);
  activeSectionId = sec.id;
  $('#bars').value = sec.bars;
  renderSections(); renderArrangement(); renderWorkspace(); renderProgLane(); save();
}

function renderArrangement(){
  const box = $('#arrangement');
  box.innerHTML = '';
  if (!state.arrangement.length){
    box.appendChild(el('span', 'empty-note', 'Vacío: se reproducirán todas las secciones en orden. Añade entradas para definir la estructura.'));
  }
  state.arrangement.forEach((id, i) => {
    const sec = state.sections.find(s => s.id === id);
    if (!sec) return;
    const chip = el('div', 'arr-chip');
    chip.dataset.arrIdx = i;
    chip.appendChild(el('span', 'anum', String(i+1)));
    chip.appendChild(el('span', '', sec.name));
    const x = el('span', 'ax', '✕');
    x.onclick = () => { state.arrangement.splice(i, 1); renderArrangement(); save(); };
    chip.appendChild(x);
    box.appendChild(chip);
  });

  const adders = $('#arrangeAdders');
  adders.innerHTML = '';
  for (const sec of state.sections){
    const b = el('button', 'mini', '＋ ' + sec.name);
    b.onclick = () => { state.arrangement.push(sec.id); renderArrangement(); save(); };
    adders.appendChild(b);
  }
}

/* ==================== render: pistas ==================== */

function renderTracksBar(){
  const tabs = $('#trackTabs');
  tabs.innerHTML = '';
  for (const tr of state.tracks){
    const tab = el('button', 'track-tab' + (tr.id === activeTrackId ? ' active' : '') + (tr.mute ? ' muted' : ''));
    tab.appendChild(el('span', 'dot'));
    tab.appendChild(el('span', '', tr.name));
    tab.onclick = () => { activeTrackId = tr.id; renderWorkspace(); };
    tabs.appendChild(tab);
  }
  const dtab = el('button', 'track-tab drum-tab' + (isDrumsActive() ? ' active' : '') + (state.drumsMute ? ' muted' : ''));
  dtab.appendChild(el('span', 'dot'));
  dtab.appendChild(el('span', '', 'Batería'));
  dtab.onclick = () => { activeTrackId = DRUMS_ID; renderWorkspace(); };
  tabs.appendChild(dtab);
}

function renderTrackHead(){
  const head = $('#trackHead');
  head.innerHTML = '';

  if (isDrumsActive()){
    const sec = activeSection();
    const g1 = el('div', 'thgroup');
    g1.appendChild(el('label', '', 'Estilo'));
    const sel = el('select');
    for (const s of Drums.STYLES){
      const o = el('option', '', s.name); o.value = s.id; sel.appendChild(o);
    }
    sel.value = sec.drums.style;
    sel.onchange = () => { sec.drums.style = sel.value; save(); };
    g1.appendChild(sel);
    head.appendChild(g1);

    const gen = el('button', 'btn-secondary', '⟳ Generar patrón para ' + state.timeSig.beats + '/' + state.timeSig.unit);
    gen.onclick = () => { generateDrums(); };
    head.appendChild(gen);

    const mute = el('button', 'mini', state.drumsMute ? 'Activar' : 'Silenciar');
    mute.onclick = () => { state.drumsMute = !state.drumsMute; renderTracksBar(); renderTrackHead(); save(); };
    head.appendChild(mute);

    head.appendChild(el('div', 'spacer'));
    const clear = el('button', 'mini', 'Vaciar batería');
    clear.onclick = () => { sec.drums.steps = emptyDrums(); renderRoll(); save(); };
    head.appendChild(clear);
    return;
  }

  const tr = activeTrack();
  if (!tr) return;

  const gName = el('div', 'thgroup');
  gName.appendChild(el('label', '', 'Nombre'));
  const name = el('input');
  name.type = 'text'; name.value = tr.name;
  name.onchange = () => { tr.name = name.value || 'Línea'; renderTracksBar(); save(); };
  gName.appendChild(name);
  head.appendChild(gName);

  const gInst = el('div', 'thgroup');
  gInst.appendChild(el('label', '', 'Instrumento'));
  const inst = el('select');
  for (const i of AudioEngine.INSTRUMENTS){
    const o = el('option', '', i.name); o.value = i.id; inst.appendChild(o);
  }
  inst.value = tr.instrument;
  inst.onchange = () => {
    tr.instrument = inst.value;
    AudioEngine.playNote(tr.instrument, 60, undefined, 0.7, 0.9);
    save();
  };
  gInst.appendChild(inst);
  head.appendChild(gInst);

  const gVol = el('div', 'thgroup');
  gVol.appendChild(el('label', '', 'Volumen'));
  const vol = el('input');
  vol.type = 'range'; vol.min = 0; vol.max = 100; vol.value = Math.round(tr.volume * 100);
  vol.oninput = () => { tr.volume = vol.value / 100; AudioEngine.trackGain(tr.id, tr.volume); save(); };
  gVol.appendChild(vol);
  head.appendChild(gVol);

  const gLen = el('div', 'thgroup');
  gLen.appendChild(el('label', '', 'Duración al escribir'));
  const lenSel = el('select');
  const spb = stepsPerBeat();
  const opts = [
    { v: 1,           l: 'Subdivisión (1 paso)' },
    { v: Math.max(1, spb / 2), l: 'Media parte' },
    { v: spb,         l: '1 parte (pulso)' },
    { v: spb * 2,     l: '2 partes' },
    { v: stepsPerBar(), l: 'Compás entero' },
  ];
  const seen = new Set();
  for (const o of opts){
    if (seen.has(o.v)) continue; seen.add(o.v);
    const opt = el('option', '', o.l); opt.value = o.v; lenSel.appendChild(opt);
  }
  lenSel.value = defaultNoteLen();
  lenSel.onchange = () => { noteLenSteps = parseInt(lenSel.value, 10); };
  gLen.appendChild(lenSel);
  head.appendChild(gLen);

  const mute = el('button', 'mini', tr.mute ? 'Activar' : 'Silenciar');
  mute.onclick = () => { tr.mute = !tr.mute; renderTracksBar(); renderTrackHead(); save(); };
  head.appendChild(mute);

  head.appendChild(el('div', 'spacer'));

  const clear = el('button', 'mini', 'Vaciar notas (sección)');
  clear.onclick = () => { activeSection().notes[tr.id] = []; renderRoll(); save(); };
  head.appendChild(clear);

  const del = el('button', 'mini', '🗑 Eliminar línea');
  del.onclick = () => {
    if (state.tracks.length <= 1){ toast('Debe quedar al menos una línea.'); return; }
    if (!confirm(`¿Eliminar la línea «${tr.name}» en todas las secciones?`)) return;
    state.tracks = state.tracks.filter(t => t.id !== tr.id);
    for (const sec of state.sections) delete sec.notes[tr.id];
    activeTrackId = state.tracks[0].id;
    renderWorkspace(); save();
  };
  head.appendChild(del);
}

/* ==================== piano roll ==================== */

const CELL = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell'));

function renderRoll(){
  const roll = $('#roll');
  roll.innerHTML = '';
  roll.style.setProperty('--beatsteps', stepsPerBeat());

  const ruler = el('div', 'roll-ruler');
  const spb = stepsPerBeat(), spbar = stepsPerBar(), total = totalSteps();
  for (let s = 0; s < total; s++){
    const c = el('div', 'ruler-cell');
    if (s % spbar === 0) { c.classList.add('bar-start'); c.textContent = (s / spbar + 1); }
    else if (s % spb === 0) c.textContent = '·';
    if (s === insertCursor) c.classList.add('cursor');
    c.style.width = CELL() + 'px';
    c.title = 'Situar aquí el cursor (inserción e inicio de reproducción)';
    c.onclick = () => setPlayPosition(s);
    ruler.appendChild(c);
  }
  roll.appendChild(ruler);

  if (isDrumsActive()) renderDrumRows(roll, total);
  else renderMelodicRows(roll, total);

  const ph = el('div', 'playhead');
  ph.id = 'playhead';
  roll.appendChild(ph);
}

function renderMelodicRows(roll, total){
  const tr = activeTrack();
  if (!tr) return;
  const notes = secNotes(tr.id);
  const ints = currentIntervals();
  const rows = Theory.scaleMidiTwoOctaves(state.key, ints, state.baseOct).reverse();
  const n = ints.length;

  rows.forEach((midi, idx) => {
    const degIdxFromTop = (rows.length - 1 - idx) % n;
    const isRoot = degIdxFromTop === 0;
    const row = el('div', 'roll-row' + (isRoot ? ' is-root' : ''));
    if (isRoot && idx !== 0) row.classList.add('oct-line');

    const label = el('div', 'row-label', Theory.midiToName(midi, state.key));
    label.title = 'Escuchar';
    label.onclick = () => AudioEngine.playNote(tr.instrument, midi, undefined, 0.8, 0.9);
    row.appendChild(label);

    const lane = el('div', 'row-lane');
    lane.style.width = (total * CELL()) + 'px';

    // crear nota: clic coloca con la duración del selector;
    // con el ratón, arrastrar en horizontal elige la duración sobre la marcha
    lane.onpointerdown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const rect = lane.getBoundingClientRect();
      const startStep = Math.floor((e.clientX - rect.left) / CELL());
      if (startStep < 0 || startStep >= total) return;
      const isMouse = e.pointerType === 'mouse';
      const startX = e.clientX;
      let dragging = false;
      let dragLen = null;
      let ghost = null;

      if (isMouse){
        try { lane.setPointerCapture(e.pointerId); } catch {}
        ghost = el('div', 'note-block ghost');
        ghost.style.left = (startStep * CELL()) + 'px';
        ghost.style.width = (Math.min(defaultNoteLen(), total - startStep) * CELL() - 2) + 'px';
        lane.appendChild(ghost);
      }

      const move = (ev) => {
        if (!isMouse) return;
        if (Math.abs(ev.clientX - startX) > 5) dragging = true;
        if (!dragging) return;
        const step = Math.floor((ev.clientX - rect.left) / CELL());
        dragLen = Math.max(1, Math.min(step - startStep + 1, total - startStep));
        ghost.style.width = (dragLen * CELL() - 2) + 'px';
      };
      const finish = (commit) => {
        lane.removeEventListener('pointermove', move);
        lane.removeEventListener('pointerup', up);
        lane.removeEventListener('pointercancel', cancel);
        if (ghost) ghost.remove();
        if (!commit) return;
        const len = (dragging && dragLen) ? dragLen : Math.min(defaultNoteLen(), total - startStep);
        notes.push({ midi, start: startStep, len, vel: 0.9 });
        AudioEngine.playNote(tr.instrument, midi, undefined, len * stepDur(), 0.9);
        renderRoll(); save();
      };
      const up = () => finish(true);
      const cancel = () => finish(false); // en táctil, un scroll cancela sin colocar nota
      lane.addEventListener('pointermove', move);
      lane.addEventListener('pointerup', up);
      lane.addEventListener('pointercancel', cancel);
    };

    for (const note of notes.filter(nt => nt.midi === midi)){
      const b = el('div', 'note-block');
      b.style.left = (note.start * CELL()) + 'px';
      b.style.width = (note.len * CELL() - 2) + 'px';
      b.style.touchAction = 'none';
      b.title = Theory.midiToName(midi, state.key) + ' · clic = borrar · arrastra = duración';

      // clic suelto borra; arrastrar cambia la duración
      b.onpointerdown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.stopPropagation();
        const rect = lane.getBoundingClientRect();
        const startX = e.clientX;
        let dragging = false;
        try { b.setPointerCapture(e.pointerId); } catch {}

        const move = (ev) => {
          if (Math.abs(ev.clientX - startX) > 5) dragging = true;
          if (!dragging) return;
          const step = Math.floor((ev.clientX - rect.left) / CELL());
          const newLen = Math.max(1, Math.min(step - note.start + 1, total - note.start));
          if (newLen !== note.len){
            note.len = newLen;
            b.style.width = (newLen * CELL() - 2) + 'px';
          }
        };
        const up = () => {
          b.removeEventListener('pointermove', move);
          b.removeEventListener('pointerup', up);
          b.removeEventListener('pointercancel', up);
          if (!dragging){
            const i = notes.indexOf(note);
            if (i >= 0) notes.splice(i, 1);
          } else {
            AudioEngine.playNote(tr.instrument, midi, undefined, note.len * stepDur(), 0.9);
          }
          renderRoll(); save();
        };
        b.addEventListener('pointermove', move);
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
      };
      lane.appendChild(b);
    }
    row.appendChild(lane);
    roll.appendChild(row);
  });
}

function renderDrumRows(roll, total){
  const steps = activeSection().drums.steps;
  for (const sound of AudioEngine.DRUM_SOUNDS){
    const row = el('div', 'roll-row drum-row');
    const label = el('div', 'row-label', AudioEngine.DRUM_LABELS[sound]);
    label.onclick = () => AudioEngine.playDrum(sound);
    label.title = 'Escuchar';
    row.appendChild(label);

    const lane = el('div', 'row-lane');
    lane.style.width = (total * CELL()) + 'px';
    lane.onclick = (e) => {
      const step = Math.floor(e.offsetX / CELL());
      if (step < 0 || step >= total) return;
      const arr = steps[sound];
      const i = arr.indexOf(step);
      if (i >= 0) arr.splice(i, 1);
      else { arr.push(step); arr.sort((a,b)=>a-b); AudioEngine.playDrum(sound); }
      renderRoll(); save();
    };

    for (const s of steps[sound]){
      const b = el('div', 'note-block');
      b.style.left = (s * CELL()) + 'px';
      b.style.width = (CELL() - 3) + 'px';
      b.onclick = (e) => {
        e.stopPropagation();
        const arr = steps[sound];
        arr.splice(arr.indexOf(s), 1);
        renderRoll(); save();
      };
      lane.appendChild(b);
    }
    row.appendChild(lane);
    roll.appendChild(row);
  }
}

function generateDrums(){
  const sec = activeSection();
  const pattern = Drums.generate(sec.drums.style, state.timeSig.beats, state.timeSig.unit, stepsPerBeat());
  const steps = emptyDrums();
  const spbar = stepsPerBar();
  for (let bar = 0; bar < sec.bars; bar++){
    for (const [sound, sts] of Object.entries(pattern)){
      for (const s of sts){
        if (sound === 'crash' && bar !== 0) continue;
        steps[sound].push(bar * spbar + s);
      }
    }
  }
  sec.drums.steps = steps;
  renderRoll(); save();
  toast('Patrón «' + Drums.STYLES.find(s=>s.id===sec.drums.style).name + '» generado en «' + sec.name + '».');
}

/* ==================== progresión + arpegiador ==================== */

function renderProgLane(){
  const lane = $('#progLane');
  lane.innerHTML = '';
  const sec = activeSection();
  if (sec.progression.length !== sec.bars){
    const p = sec.progression;
    sec.progression = Array.from({length: sec.bars}, (_, i) => p[i] ?? null);
  }
  sec.progression.forEach((chord, i) => {
    const slot = el('div', 'prog-slot');
    slot.appendChild(el('div', 'pbar', 'COMPÁS ' + (i+1)));
    const sel = el('select');
    const none = el('option', '', '—'); none.value = ''; sel.appendChild(none);
    for (const ch of chordPalette){
      const o = el('option', '', ch.name); o.value = ch.name; sel.appendChild(o);
    }
    if (chord && ![...sel.options].some(o => o.value === chord.name)){
      const o = el('option', '', chord.name); o.value = chord.name; sel.appendChild(o);
    }
    sel.value = chord?.name ?? '';
    sel.onchange = () => {
      const ch = chordPalette.find(c => c.name === sel.value);
      sec.progression[i] = ch ? { name: ch.name, midiNotes: ch.midiNotes.slice() } : null;
      if (ch) AudioEngine.playChord(activeTrack()?.instrument ?? 'piano', ch.midiNotes, 1.2);
      save();
    };
    slot.appendChild(sel);
    lane.appendChild(slot);
  });
}

// índices de arpegio para un acorde de `len` notas dentro de `count` golpes
function arpIndices(mode, len, count){
  const out = [];
  for (let k = 0; k < count; k++){
    switch(mode){
      case 'up':      out.push(k % len); break;
      case 'down':    out.push(len - 1 - (k % len)); break;
      case 'updown': {
        const period = Math.max(1, 2 * len - 2);
        const p = k % period;
        out.push(p < len ? p : period - p);
        break;
      }
      case 'pattern': {
        const seq = [0, len - 1, Math.min(1, len - 1), len - 1];
        out.push(seq[k % seq.length]);
        break;
      }
      default: out.push(k % len);
    }
  }
  return out;
}

function applyProgressionToTrack(){
  if (isDrumsActive()){ toast('Selecciona una línea melódica primero.'); return; }
  const tr = activeTrack();
  if (!tr) return;
  const sec = activeSection();
  const notes = secNotes(tr.id);
  const spbar = stepsPerBar();
  const mode = state.arpMode;
  let written = 0;

  sec.progression.forEach((chord, bar) => {
    if (!chord) return;
    const tones = fitToRoll(chord.midiNotes).sort((a,b)=>a-b);
    const barStart = bar * spbar;

    if (mode === 'block'){
      for (const m of tones){
        const filtered = notes.filter(n => !(n.midi === m && overlaps(n, barStart, spbar)));
        notes.length = 0; notes.push(...filtered);
        notes.push({ midi: m, start: barStart, len: spbar, vel: 0.85 });
      }
    } else {
      const stepLen = Math.max(1, Math.floor(stepsPerBeat() / 2)); // corcheas
      const count = Math.floor(spbar / stepLen);
      const idxs = arpIndices(mode, tones.length, count);
      // limpia lo que hubiera del mismo acorde en el compás
      const filtered = notes.filter(n => !(tones.includes(n.midi) && overlaps(n, barStart, spbar)));
      notes.length = 0; notes.push(...filtered);
      idxs.forEach((ti, k) => {
        notes.push({ midi: tones[ti], start: barStart + k * stepLen, len: stepLen, vel: 0.8 + (k % 2 === 0 ? 0.08 : 0) });
      });
    }
    written++;
  });

  if (!written){ toast('La progresión está vacía: elige acordes por compás.'); return; }
  renderRoll(); save();
  const modeName = $('#arpMode').selectedOptions[0].textContent;
  toast(`«${modeName}» escrito en «${tr.name}» (${written} compases de «${sec.name}»).`);
}

/* ==================== secuenciador ==================== */

let playing = false;
let currentStep = 0;
let nextNoteTime = 0;
let schedulerTimer = null;
let playheadRef = { startTime: 0, startStep: 0 };
let playMap = [];
let playSteps = 0;
let lastArrIdx = -1;
let pendingJump = null; // paso local (sección activa) donde empezar al dar a ▶

// Sitúa el cursor: marca el paso de inserción y mueve el punto de reproducción.
function setPlayPosition(s){
  insertCursor = s;
  if (playing){
    const seg = playMap.find(g => g.sec.id === activeSectionId);
    if (seg){
      currentStep = seg.start + Math.min(s, seg.steps - 1);
      nextNoteTime = AudioEngine.now() + 0.05;
      playheadRef = { startTime: nextNoteTime, startStep: currentStep };
    }
  } else {
    pendingJump = s;
  }
  renderRoll();
}

function buildPlayMap(){
  let secs;
  if (state.playMode === 'song'){
    secs = state.arrangement.length
      ? state.arrangement.map(id => state.sections.find(s => s.id === id)).filter(Boolean)
      : state.sections.slice();
  } else {
    secs = [activeSection()];
  }
  playMap = [];
  let off = 0;
  secs.forEach((sec, i) => {
    const steps = sec.bars * stepsPerBar();
    playMap.push({ sec, start: off, steps, arrIdx: i });
    off += steps;
  });
  playSteps = Math.max(1, off);
}

function resolveStep(g){
  for (const seg of playMap){
    if (g < seg.start + seg.steps) return { sec: seg.sec, local: g - seg.start, arrIdx: seg.arrIdx };
  }
  return null;
}

function togglePlay(){
  if (playing) pause(); else play();
}

function play(){
  AudioEngine.ensure();
  buildPlayMap();
  if (pendingJump !== null){
    const seg = playMap.find(g => g.sec.id === activeSectionId);
    if (seg) currentStep = seg.start + Math.min(pendingJump, seg.steps - 1);
    pendingJump = null;
  }
  currentStep = currentStep % playSteps;
  playing = true;
  $('#btnPlay').classList.add('playing');
  $('#btnPlay').textContent = '❚❚';
  nextNoteTime = AudioEngine.now() + 0.08;
  playheadRef = { startTime: nextNoteTime, startStep: currentStep };
  schedulerTimer = setInterval(scheduler, 25);
  requestAnimationFrame(drawPlayhead);
}

function pause(){
  playing = false;
  clearInterval(schedulerTimer);
  $('#btnPlay').classList.remove('playing');
  $('#btnPlay').textContent = '▶';
  const ph = $('#playhead'); if (ph) ph.style.display = 'none';
  markPlayingChip(-1);
}

function stop(){
  pause();
  currentStep = 0;
  pendingJump = null;
}

function scheduler(){
  const ahead = 0.12;
  while (nextNoteTime < AudioEngine.now() + ahead){
    scheduleStep(currentStep, swungTime(currentStep, nextNoteTime), true);
    nextNoteTime += stepDur();
    currentStep = (currentStep + 1) % playSteps;
    if (currentStep === 0){
      playheadRef = { startTime: nextNoteTime, startStep: 0 };
    }
  }
}

function swungTime(step, t){
  if (state.swing > 0 && step % 2 === 1) return t + stepDur() * (state.swing / 100);
  return t;
}

// humanización: pequeñas variaciones aleatorias de tiempo y dinámica
function humT(t){
  const h = state.humanize / 100;
  return h ? t + (Math.random() - 0.5) * 0.03 * h : t;
}
function humV(v){
  const h = state.humanize / 100;
  return h ? Math.max(0.2, Math.min(1, v * (1 + (Math.random() - 0.5) * 0.4 * h))) : v;
}

function scheduleStep(gStep, t, withMetronome){
  const r = resolveStep(gStep);
  if (!r) return;
  const { sec, local } = r;
  const spb = stepsPerBeat(), spbar = stepsPerBar();

  if (withMetronome && state.metronome && local % spb === 0){
    AudioEngine.playClick(t, local % spbar === 0);
  }

  for (const tr of state.tracks){
    if (tr.mute) continue;
    const notes = sec.notes[tr.id];
    if (!notes) continue;
    for (const n of notes){
      if (n.start === local){
        AudioEngine.playNote(tr.instrument, n.midi, humT(t), Math.max(0.05, n.len * stepDur() * 0.95), humV(n.vel ?? 0.9), tr.id, tr.volume);
      }
    }
  }

  if (!state.drumsMute){
    for (const [sound, steps] of Object.entries(sec.drums.steps)){
      if (steps.includes(local)) AudioEngine.playDrum(sound, humT(t), humV(0.95));
    }
  }
}

function markPlayingChip(arrIdx){
  if (arrIdx === lastArrIdx) return;
  lastArrIdx = arrIdx;
  document.querySelectorAll('.arr-chip').forEach(c => {
    c.classList.toggle('playing-now', state.playMode === 'song' && +c.dataset.arrIdx === arrIdx);
  });
}

function drawPlayhead(){
  if (!playing) return;
  const ph = $('#playhead');
  const ruler = $('.roll-ruler');
  const elapsed = AudioEngine.now() - playheadRef.startTime;
  const gStep = playheadRef.startStep + elapsed / stepDur();
  if (gStep >= 0 && gStep < playSteps){
    const r = resolveStep(Math.floor(gStep));
    if (r){
      markPlayingChip(r.arrIdx);
      if (ph && ruler && r.sec.id === activeSectionId){
        const localFloat = gStep - (playMap.find(s => s.sec === r.sec && s.arrIdx === r.arrIdx)?.start ?? 0);
        ph.style.display = 'block';
        ph.style.left = (ruler.offsetLeft + localFloat * CELL()) + 'px';
      } else if (ph){
        ph.style.display = 'none';
      }
    }
  }
  requestAnimationFrame(drawPlayhead);
}

/* ==================== letras: sílabas y rimas ==================== */

let lyricsTimer = null;
function renderLyricsAnalysis(){
  const box = $('#lyricsAnalysis');
  box.innerHTML = '';
  const text = state.lyrics;
  if (!text.trim()){
    box.appendChild(el('div', 'hint', 'Escribe algo y verás aquí las sílabas por verso y las rimas (letras iguales = riman; borde discontinuo = rima asonante).'));
    return;
  }
  const analysis = Lyrics.analyze(text);
  const hueFor = letter => 25 + (letter.charCodeAt(0) - 65) * 53 % 360;
  for (const line of analysis){
    const row = el('div', 'lyr-line');
    row.appendChild(el('span', 'lyr-syll', line.syllables !== null ? String(line.syllables) : ''));
    const txt = el('span', 'lyr-text' + (line.text.trim() ? '' : ' empty'), line.text.trim() ? line.text : '·');
    row.appendChild(txt);
    if (line.group){
      const r = el('span', 'lyr-rhyme' + (line.assonant ? ' assonant' : ''), line.group);
      const h = hueFor(line.group);
      r.style.border = `1px solid hsl(${h}, 70%, 55%)`;
      r.style.color = `hsl(${h}, 75%, 65%)`;
      row.appendChild(r);
    }
    box.appendChild(row);
  }
}

/* ==================== grabadora de ideas ==================== */

let mediaRecorder = null;

async function toggleRec(){
  if (mediaRecorder && mediaRecorder.state === 'recording'){
    mediaRecorder.stop();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('No se pudo acceder al micrófono (revisa los permisos del navegador).');
    return;
  }
  const chunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    const reader = new FileReader();
    reader.onload = () => {
      state.recordings.push({
        id: uid(),
        name: 'Idea ' + (state.recordings.length + 1),
        mime: blob.type,
        dataUrl: reader.result,
        date: new Date().toISOString().slice(0, 10),
      });
      renderRecordings(); save();
      if (reader.result.length > 2_500_000){
        toast('Grabación guardada. Ojo: es grande; el almacenamiento local tiene un límite de unos 5 MB.');
      } else {
        toast('Idea grabada ✓');
      }
    };
    reader.readAsDataURL(blob);
    $('#btnRec').textContent = '● Grabar';
    $('#btnRec').classList.remove('btn-rec-on');
    mediaRecorder = null;
  };
  mediaRecorder.start();
  $('#btnRec').textContent = '■ Detener';
  $('#btnRec').classList.add('btn-rec-on');
}

function renderRecordings(){
  const list = $('#recList');
  list.innerHTML = '';
  for (const rec of state.recordings){
    const item = el('div', 'rec-item');
    const name = el('span', 'rname', rec.name + ' · ' + (rec.date ?? ''));
    name.title = 'Doble clic para renombrar';
    name.ondblclick = () => {
      const nn = prompt('Nombre de la grabación:', rec.name);
      if (nn){ rec.name = nn.trim() || rec.name; renderRecordings(); save(); }
    };
    item.appendChild(name);
    const audio = el('audio');
    audio.controls = true;
    audio.src = rec.dataUrl;
    item.appendChild(audio);
    const dl = el('button', 'mini', '⬇');
    dl.title = 'Descargar';
    dl.onclick = () => {
      const a = document.createElement('a');
      a.href = rec.dataUrl;
      a.download = rec.name.replace(/\s+/g, '-') + (rec.mime?.includes('ogg') ? '.ogg' : '.webm');
      a.click();
    };
    item.appendChild(dl);
    const x = el('button', 'mini', '✕');
    x.title = 'Eliminar';
    x.onclick = () => {
      if (!confirm(`¿Eliminar la grabación «${rec.name}»?`)) return;
      state.recordings = state.recordings.filter(r => r !== rec);
      renderRecordings(); save();
    };
    item.appendChild(x);
    list.appendChild(item);
  }
}

/* ==================== export / import ==================== */

function slug(){
  return (state.title || 'cancion').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'cancion';
}

function download(name, blob){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(()=> URL.revokeObjectURL(a.href), 5000);
}

function exportJson(){
  const blob = new Blob([JSON.stringify({ app:'compas', ...state }, null, 2)], { type:'application/json' });
  download(slug() + '.compas.json', blob);
  toast('Proyecto guardado como .compas.json');
}

// aplana la estructura (arrangement) a notas absolutas
function flattenSong(){
  const secs = state.arrangement.length
    ? state.arrangement.map(id => state.sections.find(s => s.id === id)).filter(Boolean)
    : state.sections.slice();
  const spbar = stepsPerBar();
  const trackNotes = new Map(state.tracks.map(t => [t.id, []]));
  const drumSteps = emptyDrums();
  let off = 0;
  for (const sec of secs){
    for (const tr of state.tracks){
      for (const n of (sec.notes[tr.id] ?? [])){
        trackNotes.get(tr.id).push({ ...n, start: n.start + off });
      }
    }
    for (const [sound, steps] of Object.entries(sec.drums.steps)){
      for (const s of steps) drumSteps[sound].push(s + off);
    }
    off += sec.bars * spbar;
  }
  return { trackNotes, drumSteps, totalSteps: off, sections: secs };
}

function exportMidi(){
  const flat = flattenSong();
  const song = {
    tempo: state.tempo,
    timeSig: state.timeSig,
    stepsPerBeat: stepsPerBeat(),
    tracks: state.tracks.map(tr => {
      const oct = AudioEngine.preset(tr.instrument).oct ?? 0;
      return {
        name: tr.name,
        gm: AudioEngine.preset(tr.instrument).gm,
        notes: (flat.trackNotes.get(tr.id) ?? []).map(n => ({ ...n, midi: n.midi + oct })),
      };
    }),
    drums: Object.values(flat.drumSteps).some(a=>a.length) ? { steps: flat.drumSteps } : null,
  };
  const bytes = Midi.write(song);
  download(slug() + '.mid', new Blob([bytes], { type:'audio/midi' }));
  toast('MIDI exportado (canción completa). Ábrelo en tu DAW favorito.');
}

async function exportWav(){
  const flat = flattenSong();
  const hasNotes = [...flat.trackNotes.values()].some(a => a.length) || Object.values(flat.drumSteps).some(a => a.length);
  if (!hasNotes){ toast('No hay nada que renderizar todavía.'); return; }
  if (playing) stop();

  toast('Renderizando audio… (unos segundos)');
  const sd = stepDur();
  const lead = 0.06;
  const dur = lead + flat.totalSteps * sd + 2;

  try {
    const blob = await AudioEngine.renderToWav(dur, () => {
      for (let g = 0; g < flat.totalSteps; g++){
        let t = lead + g * sd;
        if (state.swing > 0 && g % 2 === 1) t += sd * (state.swing / 100);
        for (const tr of state.tracks){
          if (tr.mute) continue;
          for (const n of flat.trackNotes.get(tr.id) ?? []){
            if (n.start === g){
              AudioEngine.playNote(tr.instrument, n.midi, humT(t), Math.max(0.05, n.len * sd * 0.95), humV(n.vel ?? 0.9), tr.id, tr.volume);
            }
          }
        }
        if (!state.drumsMute){
          for (const [sound, steps] of Object.entries(flat.drumSteps)){
            if (steps.includes(g)) AudioEngine.playDrum(sound, humT(t), humV(0.95));
          }
        }
      }
    });
    download(slug() + '.wav', blob);
    toast('Audio .wav exportado ✓');
  } catch(e){
    console.warn(e);
    toast('No se pudo renderizar el audio: ' + e.message);
  }
}

function importFile(file){
  const reader = new FileReader();
  if (file.name.endsWith('.json')){
    reader.onload = () => {
      try {
        const s = JSON.parse(reader.result);
        if (s.app !== 'compas' && !s.tracks) throw new Error('formato');
        delete s.app;
        state = migrate(s);
        activeSectionId = state.sections[0].id;
        activeTrackId = state.tracks[0]?.id ?? DRUMS_ID;
        renderAll(); save();
        toast('Proyecto importado: «' + state.title + '»');
      } catch { toast('Ese .json no parece un proyecto de Compás.'); }
    };
    reader.readAsText(file);
  } else {
    reader.onload = () => {
      try { importMidiBuffer(reader.result); }
      catch(e){ console.warn(e); toast('No se pudo leer ese MIDI: ' + e.message); }
    };
    reader.readAsArrayBuffer(file);
  }
}

function importMidiBuffer(buffer){
  const mid = Midi.read(buffer);
  state.tempo = Math.min(260, Math.max(30, mid.tempo));
  state.timeSig = (mid.timeSig.unit === 4 || mid.timeSig.unit === 8) ? mid.timeSig : { beats:4, unit:4 };

  const spb = stepsPerBeat();
  const stepTicks = mid.division * (4 / state.timeSig.unit) / spb;

  const newTracks = [];
  const sec = newSection('Importada', 4);
  let maxStep = 0;
  const gmToDrum = invertDrumMap();

  for (const tr of mid.tracks){
    const isDrums = tr.notes.length && tr.notes.every(n => n.channel === 9);
    if (isDrums){
      for (const n of tr.notes){
        const sound = gmToDrum[n.midi];
        if (!sound) continue;
        const s = Math.round(n.tick / stepTicks);
        sec.drums.steps[sound].push(s);
        maxStep = Math.max(maxStep, s + 1);
      }
      continue;
    }
    if (!tr.notes.length) continue;
    const inst = closestInstrument(tr.gm);
    const track = { id: uid(), name: tr.name || inst.name, instrument: inst.id, volume: 0.9, mute: false };
    sec.notes[track.id] = tr.notes.map(n => {
      const start = Math.round(n.tick / stepTicks);
      const len = Math.max(1, Math.round(n.lenTicks / stepTicks));
      maxStep = Math.max(maxStep, start + len);
      return { midi: n.midi, start, len, vel: n.vel };
    });
    newTracks.push(track);
  }

  const hasDrums = Object.values(sec.drums.steps).some(a=>a.length);
  if (!newTracks.length && !hasDrums){
    toast('El MIDI no contenía notas legibles.');
    return;
  }

  const spbar = state.timeSig.beats * spb;
  sec.bars = Math.min(64, Math.max(1, Math.ceil(maxStep / spbar)));
  sec.progression = Array(sec.bars).fill(null);
  const total = sec.bars * spbar;
  for (const k of Object.keys(sec.drums.steps)) sec.drums.steps[k] = [...new Set(sec.drums.steps[k].filter(s => s < total))].sort((a,b)=>a-b);
  for (const id of Object.keys(sec.notes)) sec.notes[id] = sec.notes[id].filter(n => n.start < total);

  state.tracks = newTracks.length ? newTracks : state.tracks;
  state.sections = [sec];
  state.arrangement = [sec.id];
  activeSectionId = sec.id;
  activeTrackId = state.tracks[0]?.id ?? DRUMS_ID;
  renderAll(); save();
  toast('MIDI importado: ' + newTracks.length + ' línea(s)' + (hasDrums ? ' + batería' : '') + '.');
}

function invertDrumMap(){
  const inv = {};
  for (const [sound, note] of Object.entries(AudioEngine.DRUM_GM)) inv[note] = sound;
  inv[35] = 'kick'; inv[40] = 'snare'; inv[44] = 'hatC'; inv[37] = 'snare';
  inv[41] = 'tomL'; inv[43] = 'tomL'; inv[47] = 'tomH'; inv[48] = 'tomH'; inv[50] = 'tomH';
  inv[57] = 'crash'; inv[55] = 'crash'; inv[59] = 'ride'; inv[53] = 'ride';
  return inv;
}

function closestInstrument(gm){
  let best = AudioEngine.INSTRUMENTS[0], bestD = 999;
  for (const i of AudioEngine.INSTRUMENTS){
    const d = Math.abs(i.gm - gm);
    if (d < bestD){ best = i; bestD = d; }
  }
  return best;
}

/* ==================== transposición ==================== */

function transpose(semis){
  const idx = Theory.ROOTS.indexOf(state.key);
  state.key = Theory.ROOTS[(idx + semis + 12) % 12];
  for (const sec of state.sections){
    for (const id of Object.keys(sec.notes)){
      for (const n of sec.notes[id]) n.midi = Math.min(108, Math.max(21, n.midi + semis));
    }
    for (const ch of sec.progression){
      if (ch) ch.midiNotes = ch.midiNotes.map(m => m + semis);
    }
  }
  for (const cc of state.customChords){
    cc.root = (cc.root + semis + 12) % 12;
  }
  onTheoryChange();
  toast('Canción transpuesta a ' + state.key + '.');
}

/* ==================== eventos globales ==================== */

function bindControls(){
  $('#btnPlay').onclick = togglePlay;
  $('#btnStop').onclick = stop;

  $('#btnPlayMode').onclick = () => {
    state.playMode = state.playMode === 'section' ? 'song' : 'section';
    $('#btnPlayMode').textContent = state.playMode === 'section' ? 'Sección' : 'Canción';
    if (playing){ stop(); play(); }
    save();
  };

  $('#tempo').onchange = e => { state.tempo = Math.min(260, Math.max(30, +e.target.value || 100)); e.target.value = state.tempo; save(); };

  let taps = [];
  $('#btnTap').onclick = () => {
    const now = performance.now();
    taps = taps.filter(t => now - t < 3000);
    taps.push(now);
    if (taps.length >= 2){
      const diffs = taps.slice(1).map((t,i) => t - taps[i]);
      const avg = diffs.reduce((a,b)=>a+b,0) / diffs.length;
      state.tempo = Math.min(260, Math.max(30, Math.round(60000 / avg)));
      $('#tempo').value = state.tempo;
      save();
    }
  };

  $('#timeSig').onchange = e => {
    const [b, u] = e.target.value.split('/').map(Number);
    state.timeSig = { beats: b, unit: u };
    clampAllToGrid();
    stop();
    renderWorkspace(); save();
  };

  $('#bars').onchange = e => {
    const sec = activeSection();
    sec.bars = Math.min(64, Math.max(1, +e.target.value || 4));
    e.target.value = sec.bars;
    clampAllToGrid();
    stop();
    renderWorkspace(); renderProgLane(); save();
  };

  $('#swing').oninput = e => { state.swing = +e.target.value; save(); };
  $('#humanize').oninput = e => { state.humanize = +e.target.value; save(); };

  $('#btnMetro').onclick = () => {
    state.metronome = !state.metronome;
    $('#btnMetro').classList.toggle('active', state.metronome);
    save();
  };

  $('#masterVol').oninput = e => {
    state.masterVol = e.target.value / 100;
    AudioEngine.setMasterVolume(state.masterVol);
    save();
  };

  $('#scaleSel').onchange = e => { state.scaleId = e.target.value; onTheoryChange(); };
  $('#btnTriads').onclick = () => { state.seventh = false; renderChords(); renderProgLane(); save(); };
  $('#btnSevenths').onclick = () => { state.seventh = true; renderChords(); renderProgLane(); save(); };

  $('#btnNewChord').onclick = () => {
    const box = $('#chordBuilder');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')){
      cbSelected = new Set([0, 4, 7]);
      renderChordBuilder();
    }
  };
  $('#cbPreview').onclick = () => AudioEngine.playChord(activeTrack()?.instrument ?? 'piano', builderMidis(), 1.4);
  $('#cbSave').onclick = saveCustomChord;
  $('#cbCancel').onclick = () => $('#chordBuilder').classList.add('hidden');

  $('#songTitle').onchange = e => { state.title = e.target.value || 'Mi canción'; save(); };

  $('#btnAddSection').onclick = addSection;

  $('#btnAddTrack').onclick = () => {
    const tr = { id: uid(), name: 'Línea ' + (state.tracks.length + 1), instrument: 'piano', volume: 0.9, mute: false };
    state.tracks.push(tr);
    activeTrackId = tr.id;
    renderWorkspace(); save();
  };

  $('#arpMode').onchange = e => { state.arpMode = e.target.value; save(); };
  $('#btnApplyProg').onclick = applyProgressionToTrack;
  $('#btnClearProg').onclick = () => { activeSection().progression = Array(activeSection().bars).fill(null); renderProgLane(); save(); };

  $('#btnTransUp').onclick = () => transpose(1);
  $('#btnTransDown').onclick = () => transpose(-1);

  $('#btnLyrics').onclick = () => $('#lyricsBox').classList.toggle('hidden');
  $('#lyrics').oninput = e => {
    state.lyrics = e.target.value;
    clearTimeout(lyricsTimer);
    lyricsTimer = setTimeout(() => { renderLyricsAnalysis(); save(); }, 300);
  };

  $('#btnRec').onclick = toggleRec;

  $('#btnExportJson').onclick = exportJson;
  $('#btnExportMidi').onclick = exportMidi;
  $('#btnExportWav').onclick = exportWav;
  $('#btnImport').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = e => {
    const f = e.target.files[0];
    if (f) importFile(f);
    e.target.value = '';
  };

  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){
      e.preventDefault();
      togglePlay();
    }
  });
}

function clampAllToGrid(){
  const spbar = stepsPerBar();
  for (const sec of state.sections){
    const total = sec.bars * spbar;
    for (const id of Object.keys(sec.notes)){
      sec.notes[id] = sec.notes[id].filter(n => n.start < total);
      for (const n of sec.notes[id]) n.len = Math.min(n.len, total - n.start);
    }
    for (const k of Object.keys(sec.drums.steps)){
      sec.drums.steps[k] = sec.drums.steps[k].filter(s => s < total);
    }
  }
  insertCursor = Math.min(insertCursor, totalSteps() - 1);
  currentStep = 0;
}

/* ==================== cambios de teoría ==================== */

function onTheoryChange(){
  renderRoots();
  renderCircle();
  renderScaleSelect();
  renderScaleStrip();
  renderChords();
  renderProgLane();
  renderRoll();
  save();
}

/* ==================== arranque ==================== */

function renderWorkspace(){
  renderTracksBar();
  renderTrackHead();
  renderRoll();
}

function renderAll(){
  $('#tempo').value = state.tempo;
  $('#timeSig').value = state.timeSig.beats + '/' + state.timeSig.unit;
  $('#bars').value = activeSection().bars;
  $('#swing').value = state.swing;
  $('#humanize').value = state.humanize;
  $('#masterVol').value = Math.round(state.masterVol * 100);
  $('#btnMetro').classList.toggle('active', state.metronome);
  $('#btnPlayMode').textContent = state.playMode === 'section' ? 'Sección' : 'Canción';
  $('#songTitle').value = state.title;
  $('#lyrics').value = state.lyrics;
  $('#arpMode').value = state.arpMode;
  if (state.lyrics) $('#lyricsBox').classList.remove('hidden');
  renderRoots();
  renderCircle();
  renderScaleSelect();
  renderScaleStrip();
  renderChords();
  renderProgSuggestions();
  renderSections();
  renderArrangement();
  renderProgLane();
  renderRecordings();
  renderLyricsAnalysis();
  renderWorkspace();
}

bindControls();
renderAll();

// patrón de batería inicial si el proyecto está vacío
const firstSec = state.sections[0];
if (!Object.values(firstSec.drums.steps).some(a => a.length) &&
    Object.values(firstSec.notes).every(a => !a.length)){
  generateDrums();
  activeTrackId = state.tracks[0].id;
  renderWorkspace();
}

})();
