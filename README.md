# 🎼 Compás — estudio de composición

Aplicación web para componer canciones. 100 % local: sin login, sin base de datos,
sin dependencias externas. Todo se guarda automáticamente en el navegador
(`localStorage`) y puedes exportar/importar tus canciones.

## Cómo abrirla

Cualquier servidor estático sirve. Por ejemplo:

```bash
python3 -m http.server 8642
```

y abre `http://localhost:8642`. (También funciona abriendo `index.html`
directamente en la mayoría de navegadores.)

## Qué puede hacer

- **Tonalidad + escala/modo**: mayor, menores (natural/armónica/melódica),
  los 7 modos, pentatónicas, blues, frigio dominante… y **escala personalizada**
  donde eliges ♭/♮/♯ para cada grado.
- **Acordes de la tonalidad**: tríadas o séptimas, con números romanos.
  Clic = escuchar; ＋ = insertar en la pista activa en el paso marcado en la regla.
- **La escala pintada × 2 octavas** para construir acordes mezclando bajo y guitarra.
- **Líneas (pistas) ilimitadas** con 28 instrumentos sintetizados: pianos,
  guitarras (acústica, española, eléctrica, distorsión), bajos, cuerdas, vientos,
  voces, marimba, campanas, leads, pads…
- **Piano-roll** restringido a las notas de la escala (imposible desafinar).
- **Batería inteligente**: genera patrones coherentes con el compás
  (4/4, 3/4, 5/4, 7/4, 6/8, 7/8, 9/8, 12/8) en 8 estilos, y luego los editas a mano.
- **Progresión por compás** con sugerencias (pop, balada, andaluza, jazz ii–V–I…)
  y **arpegiador**: escribe el acompañamiento en bloque o como arpegio
  (ascendente, descendente, arriba-abajo, patrón 1·5·3·5).
- **Secciones de canción** (estrofa, estribillo, puente…): cada una con sus
  compases, notas, batería y progresión. La **estructura** define el orden de
  reproducción y el bucle puede ser de la sección activa o de la canción entera.
- **Círculo de quintas interactivo**: mayores fuera, relativas menores dentro;
  resalta tu tonalidad y sus vecinas (modulaciones suaves) y cambia de tono al clic.
- **Transporte completo**: tempo, tap tempo, swing, **humanización** (variaciones
  sutiles de tiempo y dinámica), metrónomo, volumen maestro y por pista.
  Espacio = reproducir/pausar.
- **Transposición** de toda la canción ±1 semitono.
- **Letra con métrica**: cuenta las sílabas de cada verso (con sinalefa y ajuste
  por aguda/llana/esdrújula) y detecta rimas consonantes y asonantes (letras A, B…).
- **Ideas de voz**: graba tarareos con el micrófono; se guardan con el proyecto.
- **Exportar / importar**: proyecto completo (`.compas.json`), MIDI estándar
  (`.mid`, canción completa aplanada, batería en canal 10) y **audio `.wav`**
  renderizado offline. También importa MIDI externos (formato 0 y 1).
- **Responsive**: funciona en móvil y escritorio.

## Estructura

| Fichero | Contenido |
|---|---|
| `index.html` | estructura de la interfaz |
| `css/styles.css` | estética "estudio analógico" |
| `js/version.js` | número de versión mostrado en la web — súbelo en cada despliegue |
| `js/theory.js` | notas, escalas, modos, acordes, progresiones |
| `js/audio.js` | sintetizadores Web Audio (sustractivo, FM, Karplus–Strong, formantes) y batería |
| `js/drums.js` | generador de patrones de batería por compás y estilo |
| `js/midi.js` | lectura/escritura de ficheros MIDI estándar |
| `js/lyrics.js` | métrica en español: sílabas, sinalefa, acentuación y rimas |
| `js/app.js` | estado (secciones), secuenciador, piano-roll, círculo de quintas, grabadora, import/export, autosave |
