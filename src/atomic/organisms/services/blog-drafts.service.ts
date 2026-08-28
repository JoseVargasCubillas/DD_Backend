/**
 * blog-drafts.service.ts
 *
 * Genera "N drafts" de blog posts sobre consultoría, contabilidad, SAT y temas
 * relacionados. Los drafts se guardan en la tabla `blog_posts` con
 * `status: 'draft'` para que Diego o el editor los revise en el panel admin
 * antes de publicar.
 *
 * Flujo:
 *   1. El controlador llama a `generateDrafts(count, opts)`.
 *   2. Si hay `OPENAI_API_KEY` en el entorno, usamos la Chat Completions API
 *      con un prompt fijado en el estilo Diego Díaz.
 *   3. Si no hay clave (o la llamada falla), caemos a `buildTemplateDraft` que
 *      arma un draft determinista a partir de un pool interno de temas — así
 *      el endpoint sirve para producción y para dev sin depender del LLM.
 *   4. Cada draft se persiste con `blogService.createPost` (status draft).
 */
import slugify from 'slugify';
import * as blogService from './blog.service.js';
import type { IBlogDocument } from '../../molecules/models/blog.model.js';

const TOPIC_POOL: Array<{ title: string; category: string; keywords: string[] }> = [
  {
    title: 'Cómo prepararte para una visita domiciliaria del SAT sin colapsar',
    category: 'SAT & reformas',
    keywords: ['SAT', 'visita domiciliaria', 'defensa fiscal', 'auditoría'],
  },
  {
    title: 'Errores comunes que invalidan deducciones y cómo evitarlos',
    category: 'Estrategia fiscal',
    keywords: ['deducciones', 'ISR', 'CFDI', 'materialidad'],
  },
  {
    title: 'Persona física vs persona moral: cuándo migrar tu operación',
    category: 'Estrategia fiscal',
    keywords: ['persona moral', 'personas físicas', 'RESICO', 'estructura'],
  },
  {
    title: 'Reforma antilavado 2025: qué cambia para las empresas mexicanas',
    category: 'SAT & reformas',
    keywords: ['antilavado', 'LFPIORPI', 'UIF', 'cumplimiento'],
  },
  {
    title: 'Contabilidad electrónica: los errores que activan revisiones',
    category: 'SAT & reformas',
    keywords: ['contabilidad electrónica', 'SAT', 'balanza', 'catálogo'],
  },
  {
    title: 'Retenciones de IVA e ISR: quién retiene, cuánto y cuándo',
    category: 'Estrategia fiscal',
    keywords: ['IVA', 'ISR', 'retenciones', 'CFDI'],
  },
  {
    title: 'PTU 2025: cálculo, tope y consecuencias de omitirla',
    category: 'Liderazgo empresarial',
    keywords: ['PTU', 'LFT', 'nómina', 'utilidades'],
  },
  {
    title: 'Estímulos fiscales vigentes que casi nadie está aprovechando',
    category: 'Estrategia fiscal',
    keywords: ['estímulos', 'incentivos', 'ISR', 'zonas fronterizas'],
  },
  {
    title: 'Vigilancia profunda del SAT: cómo detectarla y responder a tiempo',
    category: 'SAT & reformas',
    keywords: ['SAT', 'vigilancia profunda', 'invitación', 'requerimiento'],
  },
  {
    title: 'Diferencias entre préstamos, aportaciones y aumentos de capital',
    category: 'Estrategia fiscal',
    keywords: ['capital', 'préstamos', 'aportaciones', 'CFDI'],
  },
  {
    title: 'Fechas clave del cumplimiento fiscal: calendario 2025',
    category: 'SAT & reformas',
    keywords: ['calendario fiscal', 'declaración anual', 'cumplimiento'],
  },
  {
    title: 'Cumplimiento REPSE y sus efectos fiscales reales',
    category: 'SAT & reformas',
    keywords: ['REPSE', 'subcontratación', 'outsourcing', 'IMSS'],
  },
  {
    title: 'Ingresos declarados vs CFDI: la discrepancia que activa auditorías',
    category: 'Estrategia fiscal',
    keywords: ['CFDI', 'ingresos', 'discrepancia', 'SAT'],
  },
  {
    title: 'Deducción de automóviles: los cambios que impactan a socios y directivos',
    category: 'Estrategia fiscal',
    keywords: ['automóviles', 'deducciones', 'ISR', 'renta'],
  },
];

const AUTHOR_FALLBACK = 'Equipo de Consultoría Diego Díaz';

const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function buildTemplateDraft(index: number): Partial<IBlogDocument> {
  const topic = TOPIC_POOL[index % TOPIC_POOL.length];
  const title = topic.title;
  const excerpt =
    `Un análisis práctico para empresarios y directores administrativos ` +
    `sobre ${topic.keywords.slice(0, 2).join(' y ')}. Contexto, riesgos ` +
    `frecuentes y decisiones concretas para tomar el próximo lunes.`;

  const content = `
<p class="lead">${excerpt}</p>

<h2>El contexto</h2>
<p>En los últimos meses el SAT ha intensificado su enfoque en ${topic.keywords[0]}. En este boletín repasamos qué está pasando, a quién le aplica y qué señales conviene monitorear en la operación diaria.</p>

<h2>Puntos clave</h2>
<ul>
  <li>Qué cambia respecto al criterio anterior.</li>
  <li>Qué documentación soporta correctamente la operación.</li>
  <li>Errores comunes que hemos identificado en revisiones recientes.</li>
</ul>

<h2>Recomendaciones prácticas</h2>
<p>Antes de tomar cualquier decisión, revisa con tu equipo fiscal:</p>
<ol>
  <li>Estructura actual de la operación y su respaldo documental.</li>
  <li>CFDIs emitidos y recibidos vinculados al tema.</li>
  <li>Contratos con fecha cierta que soporten materialidad.</li>
</ol>

<p><em>Este draft fue generado automáticamente como punto de partida. Revísalo, ajústalo con tu criterio y publícalo desde el panel administrativo.</em></p>
`.trim();

  return {
    title,
    content,
    excerpt,
    category: topic.category,
    tags: topic.keywords,
    author: AUTHOR_FALLBACK,
    status: 'draft',
    isFeatured: false,
    seo: {
      metaTitle: title,
      metaDescription: excerpt,
      keywords: topic.keywords,
    },
  };
}

async function tryOpenAIDraft(): Promise<Partial<IBlogDocument> | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const topic = rand(TOPIC_POOL);
  const prompt = [
    `Escribe un boletín fiscal en español para empresarios mexicanos en el estilo del despacho de Diego Díaz.`,
    `Tema: "${topic.title}".`,
    `Categoría: ${topic.category}. Keywords: ${topic.keywords.join(', ')}.`,
    `Estructura: párrafo introductorio (lead), secciones con <h2>, listas <ul>/<ol>, tono profesional pero directo.`,
    `Longitud: 600-900 palabras. Devuelve SOLO el HTML del cuerpo (sin <html>, sin <body>, sin bloque de código).`,
  ].join('\n');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Eres un consultor fiscal mexicano senior escribiendo para el blog de Diego Díaz. Tono directo, ejemplos concretos, sin jerga innecesaria.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const content: string = data?.choices?.[0]?.message?.content?.trim() || '';
    if (!content) return null;

    const excerpt = content
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 240)
      .trim();

    return {
      title: topic.title,
      content,
      excerpt,
      category: topic.category,
      tags: topic.keywords,
      author: AUTHOR_FALLBACK,
      status: 'draft',
      isFeatured: false,
      seo: {
        metaTitle: topic.title,
        metaDescription: excerpt,
        keywords: topic.keywords,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Genera `count` drafts y los guarda con status=draft. Devuelve los posts
 * creados. Si `useAI` es true intenta usar OpenAI; si falla o no hay clave,
 * cae al generador template.
 */
export const generateDrafts = async (
  count: number,
  opts: { useAI?: boolean } = {},
): Promise<IBlogDocument[]> => {
  const total = Math.max(1, Math.min(count, 10));
  const created: IBlogDocument[] = [];

  for (let i = 0; i < total; i++) {
    let draft: Partial<IBlogDocument> | null = null;
    if (opts.useAI !== false) {
      draft = await tryOpenAIDraft();
    }
    if (!draft) {
      draft = buildTemplateDraft(i);
    }
    // asegurar slug único apendiando timestamp corto para drafts
    const baseSlug = slugify(draft.title as string, { lower: true, strict: true });
    (draft as any).slug = `${baseSlug}-draft-${Date.now().toString(36)}${i}`;
    const post = await blogService.createPost({
      ...draft,
      content: draft.content as string,
    });
    created.push(post);
  }

  return created;
};

/** Lista únicamente drafts (para el panel admin). */
export const listDrafts = async (params: { page?: number; limit?: number } = {}) =>
  blogService.listPosts({
    page: params.page ?? 1,
    limit: params.limit ?? 20,
    status: 'draft',
  });
