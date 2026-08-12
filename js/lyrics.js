/* ============================================================
   COMPÁS — análisis métrico de letras en español
   Cuenta sílabas por verso (con sinalefa y ajuste por acentuación
   de la última palabra) y detecta rimas consonantes y asonantes.
   Es una aproximación razonable, no un silabeador perfecto.
   ============================================================ */

const Lyrics = (() => {

  const STRONG = 'aeoáéóíú';      // vocales que forman núcleo propio (incluye débiles acentuadas)
  const WEAK = 'iuü';
  const VOWELS = 'aeiouáéíóúü';
  const ACCENTED = 'áéíóú';

  const isVowel = c => VOWELS.includes(c);

  function cleanWord(w){
    return w.toLowerCase().replace(/[^a-záéíóúüñ]/g, '');
  }

  // núcleos silábicos de una palabra → array de posiciones (para acentuación)
  function nuclei(word){
    const out = [];
    let i = 0;
    while (i < word.length){
      if (!isVowel(word[i])){ i++; continue; }
      // grupo vocálico
      let j = i;
      while (j < word.length && isVowel(word[j])) j++;
      const group = word.slice(i, j);
      // núcleos dentro del grupo: fuertes + débiles acentuadas; mínimo 1
      let count = 0;
      let accents = [];
      for (let k = 0; k < group.length; k++){
        if (STRONG.includes(group[k])){
          count++;
          if (ACCENTED.includes(group[k])) accents.push(count - 1);
        }
      }
      if (count === 0){ count = 1; if ([...group].some(c => ACCENTED.includes(c))) accents.push(0); }
      for (let k = 0; k < count; k++){
        out.push({ pos: i, accented: accents.includes(k) });
      }
      i = j;
    }
    if (!out.length && word.length) out.push({ pos: 0, accented: false });
    return out;
  }

  function syllableCount(word){
    return Math.max(1, nuclei(word).length);
  }

  // categoría de acentuación: 0 = aguda, 1 = llana, 2+ = esdrújula
  function stressFromEnd(word){
    const ns = nuclei(word);
    if (!ns.length) return 0;
    const accIdx = ns.findIndex(n => n.accented);
    if (accIdx >= 0) return ns.length - 1 - accIdx;
    if (ns.length === 1) return 0;
    const last = word[word.length - 1];
    return (isVowel(last) || last === 'n' || last === 's') ? 1 : 0;
  }

  const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ü/g, 'u');

  // fragmento de rima: desde la vocal tónica hasta el final de la palabra
  function rhymeFragment(word){
    const ns = nuclei(word);
    if (!ns.length) return null;
    const cat = stressFromEnd(word);
    const idx = Math.max(0, ns.length - 1 - Math.min(cat, ns.length - 1));
    return strip(word.slice(ns[idx].pos));
  }

  function analyzeLine(line){
    const words = line.split(/\s+/).map(cleanWord).filter(Boolean);
    if (!words.length) return null;
    let count = 0;
    for (const w of words) count += syllableCount(w);
    // sinalefa: palabra acaba en vocal (o 'y') y la siguiente empieza por vocal o h+vocal
    for (let i = 0; i < words.length - 1; i++){
      const a = words[i], b = words[i+1];
      const endsV = isVowel(a[a.length-1]) || a[a.length-1] === 'y';
      const startsV = isVowel(b[0]) || (b[0] === 'h' && b.length > 1 && isVowel(b[1]));
      if (endsV && startsV) count--;
    }
    // ajuste métrico por la última palabra
    const lastWord = words[words.length - 1];
    const cat = stressFromEnd(lastWord);
    if (cat === 0) count += 1;
    else if (cat >= 2) count -= 1;
    const frag = rhymeFragment(lastWord);
    return {
      syllables: Math.max(1, count),
      rhymeCons: frag,
      rhymeAson: frag ? frag.replace(/[^aeiou]/g, '') : null,
    };
  }

  /**
   * Analiza un texto completo → por línea:
   * { text, syllables, group (letra de rima o null), assonant (bool) }
   */
  function analyze(text){
    const lines = text.split('\n');
    const infos = lines.map(l => ({ text: l, info: l.trim() ? analyzeLine(l) : null }));

    // agrupación de rimas: primero consonantes, luego asonantes
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let next = 0;
    const consGroups = new Map(); // frag -> letter
    const asonGroups = new Map();

    const byCons = new Map();
    const byAson = new Map();
    infos.forEach((l, i) => {
      if (!l.info) return;
      if (l.info.rhymeCons){
        if (!byCons.has(l.info.rhymeCons)) byCons.set(l.info.rhymeCons, []);
        byCons.get(l.info.rhymeCons).push(i);
      }
    });

    for (const [frag, idxs] of byCons){
      if (idxs.length >= 2 && next < letters.length){
        consGroups.set(frag, letters[next++]);
      }
    }
    // asonantes: líneas sin grupo consonante
    infos.forEach((l, i) => {
      if (!l.info || !l.info.rhymeAson) return;
      if (consGroups.has(l.info.rhymeCons)) return;
      if (!byAson.has(l.info.rhymeAson)) byAson.set(l.info.rhymeAson, []);
      byAson.get(l.info.rhymeAson).push(i);
    });
    for (const [frag, idxs] of byAson){
      if (idxs.length >= 2 && next < letters.length){
        asonGroups.set(frag, letters[next++]);
      }
    }

    return infos.map(l => {
      if (!l.info) return { text: l.text, syllables: null, group: null, assonant: false };
      let group = null, assonant = false;
      if (consGroups.has(l.info.rhymeCons)) group = consGroups.get(l.info.rhymeCons);
      else if (asonGroups.has(l.info.rhymeAson)){ group = asonGroups.get(l.info.rhymeAson); assonant = true; }
      return { text: l.text, syllables: l.info.syllables, group, assonant };
    });
  }

  return { analyze, analyzeLine, syllableCount };
})();
