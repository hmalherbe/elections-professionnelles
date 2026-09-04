export interface TemplateFields {
  nom: string;
  prenom: string;
  scrutin: string;
  votant: boolean;
  [key: string]: unknown;
}

/**
 * Moteur de template minimal : substitution {{champ}} et conditions
 * {{#if champ}}...{{else}}...{{/if}} (non imbriquées). Suffisant pour les
 * contenus de mail/SMS de relance décrits dans la spécification.
 */
export function renderTemplate(source: string, fields: TemplateFields): string {
  let out = source.replace(/{{#if\s+(\w+)}}([\s\S]*?)(?:{{else}}([\s\S]*?))?{{\/if}}/g, (_m, key, truthy, falsy) => {
    return fields[key] ? truthy : falsy ?? "";
  });
  out = out.replace(/{{\s*(\w+)\s*}}/g, (_m, key) => {
    const value = fields[key];
    return value === undefined || value === null ? "" : String(value);
  });
  return out;
}
