/**
 * Fusionne les contours SVG de plusieurs départements adjacents en un seul
 * contour extérieur (plus de traits internes entre départements d'un même
 * groupe), à partir du principe que deux départements voisins partagent
 * EXACTEMENT les mêmes points de frontière (fond de carte dérivé d'une
 * source topologique unique, voir data/ccm2022DepartementGeo.ts) :
 * l'arête commune à deux polygones du même groupe est parcourue une fois
 * dans chaque sens (ex. A->B dans l'un, B->A dans l'autre) — elle
 * s'annule, seules les arêtes non appariées forment le contour extérieur
 * (et d'éventuels trous, gérés via `fill-rule="evenodd"` côté rendu).
 *
 * Au-delà de deux polygones (point où 3 départements ou plus se
 * rejoignent), plusieurs arêtes survivantes peuvent partir d'un même
 * sommet : on poursuit le tracé par celle qui tourne le plus possible
 * dans le sens horaire par rapport à la direction d'arrivée (règle
 * standard de "virage le plus à droite" pour extraire les contours d'une
 * subdivision planaire) — garantit un tracé correct même aux points
 * multiples, sans mélanger deux boucles distinctes.
 */

type Point = [number, number];

function parseRings(d: string): Point[][] {
  // Un `d` peut contenir plusieurs sous-tracés ("M ... Z M ... Z"), ex. un
  // département avec une enclave séparée.
  const parts = d
    .split(/(?=M\s)/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((part) => {
    const clean = part.replace(/^M\s*/, "").replace(/Z\s*$/, "").replace(/L/g, " ");
    const nums = clean
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const points: Point[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
    // Le dernier point duplique souvent le premier (fermeture explicite
    // avant le Z) : on le retire pour ne pas créer une arête de longueur
    // nulle en bouclant.
    if (points.length > 1) {
      const [x0, y0] = points[0];
      const [xn, yn] = points[points.length - 1];
      if (x0 === xn && y0 === yn) points.pop();
    }
    return points;
  });
}

function keyOf(p: Point): string {
  return `${p[0]},${p[1]}`;
}

/** Fusionne les contours `paths` (un `d` SVG par département) en un ou
 * plusieurs contours extérieurs, rendus en un seul `d` combiné (plusieurs
 * sous-tracés séparés par M...Z, à utiliser avec fill-rule="evenodd"). */
export function mergePolygonPaths(paths: string[]): string {
  const rings: Point[][] = paths.flatMap((d) => parseRings(d));

  // Compte les arêtes DIRIGÉES par leur paire de clés (ordre d'origine
  // conservé pour le tracé) ; une arête s'annule avec son inverse exacte.
  const directed = new Map<string, Point>(); // "keyA|keyB" -> B (point cible)
  const cancelled = new Set<string>();
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const ka = keyOf(a);
      const kb = keyOf(b);
      if (ka === kb) continue;
      const forward = `${ka}|${kb}`;
      const backward = `${kb}|${ka}`;
      if (directed.has(backward) && !cancelled.has(backward)) {
        cancelled.add(backward);
        cancelled.add(forward);
      } else {
        directed.set(forward, b);
      }
    }
  }

  // Arêtes survivantes, groupées par sommet de départ, avec leur point
  // d'origine (pour l'angle de la direction entrante lors du tracé).
  const outgoingByVertex = new Map<string, { to: Point; used: boolean }[]>();
  const pointByKey = new Map<string, Point>();
  for (const [edgeKey, to] of directed) {
    if (cancelled.has(edgeKey)) continue;
    const [fromKey] = edgeKey.split("|");
    const list = outgoingByVertex.get(fromKey) ?? [];
    list.push({ to, used: false });
    outgoingByVertex.set(fromKey, list);
    pointByKey.set(fromKey, pointFromKey(fromKey));
    pointByKey.set(keyOf(to), to);
  }

  function pointFromKey(k: string): Point {
    const [x, y] = k.split(",").map(Number);
    return [x, y];
  }

  /** Angle (radians) du vecteur from -> to. */
  function angle(from: Point, to: Point): number {
    return Math.atan2(to[1] - from[1], to[0] - from[0]);
  }

  /** Parmi les arêtes sortantes non utilisées de `atKey`, celle qui tourne
   * le plus possible dans le sens horaire par rapport à la direction
   * d'arrivée `incomingAngle` (direction depuis laquelle on vient). */
  function pickNext(atKey: string, incomingAngle: number): { to: Point; used: boolean } | null {
    const candidates = (outgoingByVertex.get(atKey) ?? []).filter((e) => !e.used);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    const at = pointByKey.get(atKey)!;
    // Angle relatif par rapport à la direction inverse de l'arrivée (on
    // "revient" virtuellement avant de tourner) : normalisé dans [0, 2π),
    // le plus petit angle = le virage le plus à droite (horaire).
    const back = incomingAngle + Math.PI;
    let best = candidates[0];
    let bestRel = Infinity;
    for (const c of candidates) {
      const a = angle(at, c.to);
      let rel = back - a;
      rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (rel < bestRel) {
        bestRel = rel;
        best = c;
      }
    }
    return best;
  }

  const loops: Point[][] = [];
  for (const [startKey, edges] of outgoingByVertex) {
    for (const startEdge of edges) {
      if (startEdge.used) continue;
      const loop: Point[] = [pointByKey.get(startKey)!];
      let currentKey = startKey;
      let edge = startEdge;
      let incomingAngle = angle(pointByKey.get(startKey)!, edge.to);
      let guard = 0;
      while (guard++ < 100000) {
        edge.used = true;
        const nextKey = keyOf(edge.to);
        if (nextKey === startKey) break;
        loop.push(edge.to);
        const next = pickNext(nextKey, incomingAngle);
        if (!next) break; // réseau mal formé (ne devrait pas arriver sur des données topologiquement propres)
        incomingAngle = angle(pointByKey.get(nextKey)!, next.to);
        currentKey = nextKey;
        edge = next;
      }
      void currentKey;
      if (loop.length >= 3) loops.push(loop);
    }
  }

  return loops
    .map((loop) => `M ${loop.map(([x, y]) => `${x},${y}`).join(" L ")} Z`)
    .join(" ");
}
