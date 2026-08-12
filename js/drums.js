/* ============================================================
   COMPÁS — generador de patrones de batería
   Genera patrones musicales coherentes con el compás elegido.
   Un patrón dura 1 compás y se repite; el usuario puede editarlo.
   Formato: { kick:[pasos], snare:[...], ... } (índices de paso en el compás)
   ============================================================ */

const Drums = (() => {

  const STYLES = [
    { id:'rock',    name:'Rock' },
    { id:'pop',     name:'Pop' },
    { id:'ballad',  name:'Balada' },
    { id:'funk',    name:'Funk' },
    { id:'latin',   name:'Latino' },
    { id:'shuffle', name:'Shuffle / Blues' },
    { id:'waltz',   name:'Vals (para 3/4 y 6/8)' },
    { id:'minimal', name:'Minimalista' },
  ];

  // Agrupaciones naturales para compases irregulares (en pulsos)
  function groupings(beats, unit){
    if (unit === 8){
      // compuestos y amalgama sobre corcheas
      if (beats === 6)  return [3,3];
      if (beats === 7)  return [2,2,3];
      if (beats === 9)  return [3,3,3];
      if (beats === 12) return [3,3,3,3];
      if (beats === 5)  return [3,2];
      return Array(beats).fill(1);
    }
    if (beats === 5) return [3,2];
    if (beats === 7) return [4,3];
    return Array(beats).fill(1);
  }

  /**
   * Genera un patrón de un compás.
   * @param style   id de estilo
   * @param beats   numerador del compás
   * @param unit    denominador (4 u 8)
   * @param spb     pasos por pulso (resolución del grid)
   * @returns objeto { sound: [indices de paso] }
   */
  function generate(style, beats, unit, spb){
    const total = beats * spb;
    const P = { kick:[], snare:[], hatC:[], hatO:[], tomL:[], tomH:[], clap:[], crash:[], ride:[] };
    const groups = groupings(beats, unit);
    // posiciones (en pasos) donde empieza cada grupo
    const groupStarts = [];
    let acc = 0;
    for (const g of groups){ groupStarts.push(acc * spb); acc += g; }

    const isCompound = unit === 8 && beats % 3 === 0;

    const everyBeat = (arr, everyN=1, offset=0) => {
      for (let b = offset; b < beats; b += everyN) arr.push(b * spb);
    };

    if (isCompound){
      // 6/8, 9/8, 12/8: bombo al inicio de grupo, caja en el 2º grupo (o alternos)
      groupStarts.forEach((gs, i) => {
        if (i % 2 === 0) P.kick.push(gs); else P.snare.push(gs);
      });
      // hats en cada corchea
      everyBeat(P.hatC, 1);
      if (style === 'waltz' || style === 'ballad'){
        P.hatC = []; everyBeat(P.hatC, 1);
        P.snare = groupStarts.filter((_,i)=>i%2===1);
      }
      if (style === 'funk'){
        // fantasmas de caja en subdivisión
        for (const gs of groupStarts) if (Math.random) P.hatO.push(gs + 2*spb > total-1 ? gs : gs + 2*spb);
      }
      P.crash.push(0);
      return trim(P, total);
    }

    switch(style){
      case 'rock':
        // bombo en 1 y mitad del compás; caja en pulsos "afterbeat"
        P.kick.push(0);
        if (beats >= 4) P.kick.push(Math.floor(beats/2) * spb);
        backbeats(beats, groups).forEach(b => P.snare.push(b * spb));
        everyBeat(P.hatC, 1);
        if (spb >= 2) for (let b=0;b<beats;b++) P.hatC.push(b*spb + Math.floor(spb/2));
        P.crash.push(0);
        break;

      case 'pop':
        P.kick.push(0);
        if (beats >= 4){ P.kick.push(2*spb + Math.floor(spb/2)); }
        backbeats(beats, groups).forEach(b => P.snare.push(b * spb));
        for (let s=0; s<total; s+=Math.max(1, Math.floor(spb/2))) P.hatC.push(s);
        break;

      case 'ballad':
        P.kick.push(0);
        backbeats(beats, groups).forEach(b => P.snare.push(b * spb));
        everyBeat(P.ride, 1);
        break;

      case 'funk':
        P.kick.push(0);
        if (spb >= 4){ P.kick.push(Math.floor(spb*0.75)); if (beats>=3) P.kick.push(2*spb + Math.floor(spb/2)); }
        else if (beats >= 3) P.kick.push(2*spb);
        backbeats(beats, groups).forEach(b => P.snare.push(b * spb));
        for (let s=0; s<total; s+=Math.max(1, Math.floor(spb/2))) P.hatC.push(s);
        if (beats>=4) { P.hatO.push((beats-1)*spb + Math.floor(spb/2)); }
        break;

      case 'latin':
        // tumbao-ish: bombo en 1 y anticipo; clave con palmada
        P.kick.push(0);
        if (beats >= 4) P.kick.push(3*spb + Math.floor(spb/2) >= total ? 3*spb : 3*spb + Math.floor(spb/2));
        // clave 3-2 aproximada si cabe
        const claveSteps = beats >= 4 && spb >= 2
          ? [0, Math.floor(1.5*spb), 3*spb, 5*spb, 6*spb].filter(s => s < total)
          : groupStarts;
        claveSteps.forEach(s => P.clap.push(s));
        everyBeat(P.hatC, 1);
        if (beats >= 2) P.tomL.push((beats-1)*spb);
        break;

      case 'shuffle':
        P.kick.push(0);
        if (beats >= 4) P.kick.push(2*spb);
        backbeats(beats, groups).forEach(b => P.snare.push(b * spb));
        // patrón de swing: pulso + última subdivisión (tresillo aproximado)
        for (let b=0;b<beats;b++){
          P.ride.push(b*spb);
          if (spb >= 3) P.ride.push(b*spb + spb - Math.ceil(spb/3));
          else if (spb === 2) P.ride.push(b*spb + 1);
        }
        break;

      case 'waltz':
        P.kick.push(0);
        for (let b=1;b<beats;b++) P.hatC.push(b*spb);
        break;

      case 'minimal':
        P.kick.push(0);
        const mid = Math.floor(beats/2);
        if (mid > 0) P.snare.push(mid*spb);
        break;
    }

    // Compases de amalgama (5/4, 7/4, 7/8 no compuestos): marca inicios de grupo con hat abierto
    if (groups.length > 1 && groups.some(g=>g!==1) && !isCompound){
      groupStarts.slice(1).forEach(gs => { if (!P.snare.includes(gs)) P.hatO.push(gs); });
    }

    return trim(P, total);
  }

  // pulsos donde cae la caja: los "pares" (2 y 4 en 4/4), adaptado a otros compases
  function backbeats(beats, groups){
    if (beats === 4) return [1,3];
    if (beats === 2) return [1];
    if (beats === 3) return [2];
    if (beats === 5) return [3];      // agrupación 3+2 → caja en el 4º pulso
    if (beats === 6) return [2,4];
    if (beats === 7) return [4];      // 4+3 → caja tras el primer grupo
    const out = [];
    for (let b=1;b<beats;b+=2) out.push(b);
    return out;
  }

  function trim(P, total){
    for (const k of Object.keys(P)){
      P[k] = [...new Set(P[k].filter(s => s >= 0 && s < total))].sort((a,b)=>a-b);
    }
    return P;
  }

  return { STYLES, generate };
})();
