import { listScrapingConfigs, parseScheduleTimes, runScrapingAndImport } from "./scrapingRun.js";

/**
 * Heure courante à Paris sous la forme "HH:MM", indépendamment du fuseau du
 * conteneur Docker (généralement UTC) — les horaires programmés par l'admin
 * sont ceux qu'iel a en tête (heure française), pas l'heure serveur.
 */
function currentParisTime(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  // Certaines implémentations ICU rendent minuit "24:00" avec hour12:false.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
}

/** Dernier créneau ("date|HH:MM") déclenché par académie, pour ne jamais
 * lancer deux fois le même créneau (le planificateur est vérifié chaque
 * minute, donc plusieurs passages peuvent tomber sur la même minute). */
const lastFiredByAcademie = new Map<string, string>();

function checkAndRunScheduledScraping(): void {
  const { date, time } = currentParisTime();
  for (const row of listScrapingConfigs()) {
    const times = parseScheduleTimes(row.schedule_times);
    if (!times.includes(time)) continue;

    const slotKey = `${date}|${time}`;
    if (lastFiredByAcademie.get(row.academie) === slotKey) continue;
    lastFiredByAcademie.set(row.academie, slotKey);

    const label = row.academie === "" ? "national (CCMMEP)" : `académie « ${row.academie} »`;
    console.log(`Scraping planifié (${time}) déclenché pour ${label}.`);
    runScrapingAndImport(row.academie, null).catch((err) => {
      console.error(`Échec du scraping planifié pour ${label} :`, err);
    });
  }
}

const SCHEDULER_CHECK_INTERVAL_MS = 60 * 1000;

/**
 * Fonctionnalité optionnelle : jusqu'à 3 horaires par jour et par périmètre
 * (national ou académique — mêmes horaires pour le 1er et le 2nd degré,
 * scrapés ensemble comme le déclenchement manuel) peuvent être configurés
 * dans scraping_config.schedule_times pour lancer automatiquement la
 * récupération + l'import, sans action de l'admin.
 */
export function startScrapingScheduler(): void {
  setInterval(checkAndRunScheduledScraping, SCHEDULER_CHECK_INTERVAL_MS);
}
