/**
 * Separa un nombre completo en NOMBRE / APELLIDO para personalizar correos
 * (*|FNAME|* / *|LNAME|*). Sigue la convención mexicana: uno o dos nombres de
 * pila seguidos de dos apellidos ("María José García López"), respetando
 * partículas ("María de la Luz Pérez", "Juan de la Cruz").
 *
 * Es una heurística: ante la duda toma solo la primera palabra como nombre,
 * que es lo más seguro para un saludo ("Hola, María").
 */

// Partículas que se pegan a la palabra siguiente ("de la Cruz", "del Valle").
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'san', 'santa', 'van', 'von', 'da', 'di']);

// Segundo nombre de pila frecuente: "Juan Carlos", "Ana Sofía", "José Luis"…
const COMMON_SECOND_GIVEN = new Set([
  'josé', 'jose', 'maría', 'maria', 'carlos', 'luis', 'antonio', 'miguel', 'ángel', 'angel',
  'alberto', 'alejandro', 'eduardo', 'fernando', 'francisco', 'javier', 'jesús', 'jesus', 'juan',
  'manuel', 'pedro', 'ricardo', 'roberto', 'pablo', 'andrés', 'andres', 'arturo', 'daniel',
  'david', 'enrique', 'gerardo', 'guillermo', 'héctor', 'hector', 'hugo', 'ignacio', 'jorge',
  'leonardo', 'mario', 'ramón', 'ramon', 'rafael', 'raúl', 'raul', 'sergio', 'víctor', 'victor',
  'guadalupe', 'isabel', 'fernanda', 'elena', 'teresa', 'patricia', 'carmen', 'concepción',
  'concepcion', 'alejandra', 'alicia', 'ana', 'beatriz', 'claudia', 'cristina', 'gabriela',
  'laura', 'leticia', 'lucía', 'lucia', 'margarita', 'mónica', 'monica', 'paola', 'sofía', 'sofia',
  'verónica', 'veronica', 'yolanda', 'esmeralda', 'fátima', 'fatima', 'valeria', 'daniela',
  'paulina', 'renata',
]);

// "María de la Luz", "José del Carmen", "María de Jesús": la partícula es parte del nombre de pila.
const COMPOUND_GIVEN_STARTERS = new Set(['maría', 'maria', 'josé', 'jose']);

const capitalize = (word: string): string =>
  word.charAt(0).toLocaleUpperCase('es-MX') + word.slice(1);

// "JUAN PEREZ" / "juan perez" -> "Juan Perez". Un nombre ya mezclado no se toca.
const normalizeCase = (value: string): string => {
  const isUniform = value === value.toLocaleUpperCase('es-MX') || value === value.toLocaleLowerCase('es-MX');
  if (!isUniform) return value;
  return value
    .toLocaleLowerCase('es-MX')
    .split(' ')
    .map((word, i) => (i > 0 && PARTICLES.has(word) ? word : capitalize(word)))
    .join(' ');
};

// Agrupa partículas con la palabra que las sigue: [de, la, Cruz] -> "de la Cruz".
const toChunks = (tokens: string[]): string[] => {
  const chunks: string[] = [];
  let pending: string[] = [];
  tokens.forEach((token, i) => {
    const isLast = i === tokens.length - 1;
    if (PARTICLES.has(token.toLowerCase()) && !isLast) {
      pending.push(token);
      return;
    }
    chunks.push([...pending, token].join(' '));
    pending = [];
  });
  return chunks;
};

export const splitFullName = (fullName?: string): { FNAME: string; LNAME: string } => {
  const clean = (fullName ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return { FNAME: '', LNAME: '' };

  const chunks = toChunks(normalizeCase(clean).split(' '));
  if (chunks.length === 1) return { FNAME: chunks[0], LNAME: '' };

  const first = chunks[0].toLowerCase();
  const second = chunks[1].toLowerCase();
  const compoundGiven =
    COMMON_SECOND_GIVEN.has(second) ||
    (COMPOUND_GIVEN_STARTERS.has(first) && /^(de|del)\s/.test(second));

  if (compoundGiven) {
    return { FNAME: `${chunks[0]} ${chunks[1]}`, LNAME: chunks.slice(2).join(' ') };
  }
  return { FNAME: chunks[0], LNAME: chunks.slice(1).join(' ') };
};
