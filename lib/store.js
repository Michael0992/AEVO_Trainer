// Dauerhafter Speicher fuer Profil, Ergebnisse, Lernzeit und Geheimnisse.
//
// Zwei Ablagen, automatisch gewaehlt:
//   1. Postgres, sobald DATABASE_URL gesetzt ist. Noetig bei Hostern wie Render,
//      deren Dateisystem fluechtig ist - auf dem Free-Plan gibt es dort weder
//      eine Persistent Disk noch ein Verzeichnis, das einen Neustart ueberlebt.
//   2. JSON-Datei unter DATA_DIR bzw. data/. Der Normalfall lokal.
//
// In beiden Faellen liegt der vollstaendige Datensatz im Arbeitsspeicher und
// wird nach jeder Aenderung komplett zurueckgeschrieben. Das ist fuer eine
// einzelne lernende Person voellig ausreichend und haelt den Code einfach.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wurzel = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const DATEN_DIR = process.env.DATA_DIR || path.join(wurzel, "data");
const DATEI = path.join(DATEN_DIR, "store.json");
const DB_URL = process.env.DATABASE_URL || "";

let backend = "datei"; // "datei" | "postgres"
let pool = null;
let schreibFehler = null;
let schreibZaehler = 0;

const LEER = {
  version: 3,
  profil: {
    name: "",
    pruefungstermin: "",
    standardmodell: "claude-sonnet-5",
    tagesziel: 30, // Minuten
    stimme: "",
    sprechtempo: 1,
    autoVorlesen: false,
  },
  ergebnisse: [], // Verlauf aller Bewertungen, aeltester zuerst
  lernzeit: {}, // "JJJJ-MM-TT" -> Sekunden
  geheimnisse: {}, // API-Schluessel und Zugangsdaten, siehe lib/env.js
};

function zusammenfuehren(roh) {
  if (!roh || typeof roh !== "object") return structuredClone(LEER);
  return {
    ...LEER,
    ...roh,
    profil: { ...LEER.profil, ...(roh.profil || {}) },
    ergebnisse: Array.isArray(roh.ergebnisse) ? roh.ergebnisse : [],
    lernzeit: roh.lernzeit && typeof roh.lernzeit === "object" ? roh.lernzeit : {},
    geheimnisse: roh.geheimnisse && typeof roh.geheimnisse === "object" ? roh.geheimnisse : {},
  };
}

// --------------------------------------------------------------- Ablagen

function ladeDatei() {
  try {
    return zusammenfuehren(JSON.parse(fs.readFileSync(DATEI, "utf8")));
  } catch {
    return null;
  }
}

function schreibeDatei() {
  fs.mkdirSync(path.dirname(DATEI), { recursive: true });
  const temp = `${DATEI}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(daten, null, 2), "utf8");
  fs.renameSync(temp, DATEI); // atomar: nie eine halb geschriebene Datei
}

async function verbindePostgres() {
  const { default: pg } = await import("pg");
  // Gehostete Datenbanken (Neon, Supabase, Render) verlangen TLS; lokal nicht.
  const lokal = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL) || /sslmode=disable/.test(DB_URL);
  pool = new pg.Pool({
    connectionString: DB_URL,
    ssl: lokal ? false : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 30000,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aevo_store (
      id text PRIMARY KEY,
      daten jsonb NOT NULL,
      geaendert timestamptz NOT NULL DEFAULT now()
    )`);

  const { rows } = await pool.query("SELECT daten FROM aevo_store WHERE id = 'haupt'");
  return rows[0]?.daten ?? null;
}

async function schreibePostgres() {
  await pool.query(
    `INSERT INTO aevo_store (id, daten, geaendert) VALUES ('haupt', $1, now())
     ON CONFLICT (id) DO UPDATE SET daten = EXCLUDED.daten, geaendert = now()`,
    [JSON.stringify(daten)],
  );
}

// Startwert, damit der Zugriff schon vor init() funktioniert.
let daten = ladeDatei() || structuredClone(LEER);

/* Muss vor dem Serverstart einmal aufgerufen werden. Waehlt die Ablage,
   laedt den Bestand und uebernimmt vorhandene Daten aus der jeweils anderen
   Ablage, falls die gewaehlte noch leer ist. */
export async function init() {
  if (DB_URL) {
    try {
      const ausDb = await verbindePostgres();
      backend = "postgres";

      if (ausDb) {
        daten = zusammenfuehren(ausDb);
      } else {
        // Erster Start mit Datenbank: bestehende Dateidaten uebernehmen.
        const ausDatei = ladeDatei();
        daten = ausDatei || structuredClone(LEER);
        await schreiben();
        if (ausDatei) console.log("[store] Bestehende Daten aus der JSON-Datei in die Datenbank uebernommen.");
      }
      console.log(`[store] Ablage: PostgreSQL (${daten.ergebnisse.length} Ergebnisse)`);
      return;
    } catch (err) {
      console.error(`[store] Datenbank nicht erreichbar (${err.message}) - weiche auf die Datei aus.`);
      pool = null;
      backend = "datei";
    }
  }

  uebernehmeAlteAblage();
  daten = ladeDatei() || daten;
  console.log(`[store] Ablage: Datei ${DATEI} (${daten.ergebnisse.length} Ergebnisse)`);
}

// Beim Umstieg auf ein dauerhaftes Verzeichnis (DATA_DIR) einmalig die bisher
// im Projektordner liegenden Daten uebernehmen, statt leer zu starten.
function uebernehmeAlteAblage() {
  const alt = path.join(wurzel, "data", "store.json");
  if (DATEI === alt || fs.existsSync(DATEI) || !fs.existsSync(alt)) return;
  try {
    fs.mkdirSync(DATEN_DIR, { recursive: true });
    fs.copyFileSync(alt, DATEI);
    console.log(`[store] Bestehende Daten aus ${alt} nach ${DATEI} uebernommen.`);
  } catch (err) {
    console.error(`[store] Uebernahme der alten Daten fehlgeschlagen: ${err.message}`);
  }
}

// Schreibt den gesamten Datensatz zurueck. Gibt zurueck, ob das geklappt hat -
// die Oberflaeche soll nicht stillschweigend Ergebnisse verlieren.
async function schreiben() {
  try {
    if (backend === "postgres") await schreibePostgres();
    else schreibeDatei();
    schreibFehler = null;
    schreibZaehler++;
    return true;
  } catch (err) {
    schreibFehler = err.message;
    console.error(`[store] Speichern fehlgeschlagen (${backend}): ${err.message}`);
    return false;
  }
}

export function speicherStatus() {
  let schreibbar = backend === "postgres";
  if (backend === "datei") {
    try {
      fs.mkdirSync(DATEN_DIR, { recursive: true });
      fs.accessSync(DATEN_DIR, fs.constants.W_OK);
      schreibbar = true;
    } catch {
      schreibbar = false;
    }
  }
  return {
    backend,
    dauerhaft: backend === "postgres" || Boolean(process.env.DATA_DIR),
    pfad: backend === "postgres" ? "PostgreSQL (DATABASE_URL)" : DATEI,
    verzeichnis: DATEN_DIR,
    ausUmgebung: Boolean(process.env.DATA_DIR),
    schreibbar,
    dateiVorhanden: backend === "datei" ? fs.existsSync(DATEI) : null,
    letzterFehler: schreibFehler,
    schreibvorgaenge: schreibZaehler,
    ergebnisse: daten.ergebnisse.length,
    lerntage: Object.keys(daten.lernzeit).length,
    geheimnisse: Object.keys(daten.geheimnisse),
  };
}

export function heute() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tagVon(iso) {
  return String(iso || "").slice(0, 10);
}

// ---------------------------------------------------------- Geheimnisse

/* API-Schluessel und Zugangsdaten liegen mit in der Ablage, damit sie bei
   Betrieb mit Datenbank einen Neustart ueberleben - auf Render waere die
   .env-Datei sonst nach jedem Deploy weg. Siehe lib/env.js. */

export function holeGeheimnis(name) {
  return daten.geheimnisse?.[name] || "";
}

export async function setzeGeheimnis(name, wert) {
  const sauber = String(wert ?? "").trim();
  if (sauber) daten.geheimnisse[name] = sauber;
  else delete daten.geheimnisse[name];
  return schreiben();
}

export function istDatenbank() {
  return backend === "postgres";
}

// ------------------------------------------------------------------ Profil

export function holeProfil() {
  return { ...daten.profil };
}

export async function setzeProfil(teil) {
  const erlaubt = ["name", "pruefungstermin", "standardmodell", "tagesziel", "stimme", "sprechtempo", "autoVorlesen"];
  for (const feld of erlaubt) {
    if (teil[feld] !== undefined) daten.profil[feld] = teil[feld];
  }
  daten.profil.tagesziel = Math.min(600, Math.max(0, Number(daten.profil.tagesziel) || 0));
  daten.profil.sprechtempo = Math.min(2, Math.max(0.5, Number(daten.profil.sprechtempo) || 1));
  daten.profil.autoVorlesen = Boolean(daten.profil.autoVorlesen);
  await schreiben();
  return holeProfil();
}

// -------------------------------------------------------------- Ergebnisse

export async function speichereErgebnis(eintrag) {
  const satz = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    zeit: new Date().toISOString(),
    ...eintrag,
  };
  daten.ergebnisse.push(satz);
  // Verlauf begrenzen, damit die Ablage nicht unbegrenzt waechst
  if (daten.ergebnisse.length > 5000) daten.ergebnisse = daten.ergebnisse.slice(-5000);
  const gespeichert = await schreiben();
  return { ...satz, gespeichert };
}

export function holeErgebnisse({ tage } = {}) {
  if (!tage) return daten.ergebnisse;
  const grenze = new Date(Date.now() - tage * 86400000).toISOString();
  return daten.ergebnisse.filter((e) => e.zeit >= grenze);
}

// Letzter Versuch je Frage
export function letzteVersuche() {
  const map = new Map();
  for (const e of daten.ergebnisse) map.set(e.frageId, e);
  return map;
}

export async function loescheErgebnisse() {
  daten.ergebnisse = [];
  return schreiben();
}

export async function loescheFrageVerlauf(frageId) {
  daten.ergebnisse = daten.ergebnisse.filter((e) => e.frageId !== frageId);
  return schreiben();
}

// ---------------------------------------------------------------- Lernzeit

export async function addiereLernzeit(sekunden, tag = heute()) {
  const s = Math.min(3600, Math.max(0, Math.round(Number(sekunden) || 0)));
  if (!s) return daten.lernzeit[tag] || 0;
  daten.lernzeit[tag] = (daten.lernzeit[tag] || 0) + s;
  await schreiben();
  return daten.lernzeit[tag];
}

export function holeLernzeit() {
  return { ...daten.lernzeit };
}

// --------------------------------------------------------------- Statistik

// Tagesreihe ueber die letzten n Tage: Lernzeit, Anzahl Antworten, Durchschnitt
export function tagesreihe(tage = 30) {
  const reihe = [];
  const jetzt = new Date();
  const proTag = new Map();

  for (const e of daten.ergebnisse) {
    const tag = tagVon(e.zeit);
    if (!proTag.has(tag)) proTag.set(tag, []);
    proTag.get(tag).push(e.punkte ?? 0);
  }

  for (let i = tage - 1; i >= 0; i--) {
    const d = new Date(jetzt.getTime() - i * 86400000);
    const tag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const punkte = proTag.get(tag) || [];
    reihe.push({
      tag,
      lernzeit: daten.lernzeit[tag] || 0,
      antworten: punkte.length,
      schnitt: punkte.length ? punkte.reduce((a, c) => a + c, 0) / punkte.length : null,
    });
  }
  return reihe;
}

// Auswertung nach Kategorie: nur der jeweils letzte Versuch je Frage zaehlt
export function kategorieAuswertung() {
  const letzte = [...letzteVersuche().values()];
  const gruppen = new Map();

  for (const e of letzte) {
    const schluessel = `${e.bereich}||${e.kategorie}`;
    if (!gruppen.has(schluessel)) {
      gruppen.set(schluessel, { bereich: e.bereich, kategorie: e.kategorie, punkte: [], fragen: [] });
    }
    const g = gruppen.get(schluessel);
    g.punkte.push(e.punkte ?? 0);
    g.fragen.push({ frageId: e.frageId, frage: e.frage, punkte: e.punkte, zeit: e.zeit });
  }

  return [...gruppen.values()]
    .map((g) => ({
      bereich: g.bereich,
      kategorie: g.kategorie,
      anzahl: g.punkte.length,
      schnitt: g.punkte.reduce((a, c) => a + c, 0) / g.punkte.length,
      schwach: g.punkte.filter((p) => p < 6).length,
      fragen: g.fragen.sort((a, b) => a.punkte - b.punkte),
    }))
    .sort((a, b) => a.schnitt - b.schnitt);
}

// Entwicklung je Frage: erster gegen letzten Versuch
export function verlaufJeFrage() {
  const proFrage = new Map();
  for (const e of daten.ergebnisse) {
    if (!proFrage.has(e.frageId)) proFrage.set(e.frageId, []);
    proFrage.get(e.frageId).push(e);
  }
  return [...proFrage.entries()].map(([frageId, liste]) => ({
    frageId,
    frage: liste[0].frage,
    bereich: liste[0].bereich,
    kategorie: liste[0].kategorie,
    versuche: liste.length,
    erste: liste[0].punkte,
    letzte: liste[liste.length - 1].punkte,
    verlauf: liste.map((e) => ({ zeit: e.zeit, punkte: e.punkte })),
  }));
}

export function gesamtUebersicht(fragenGesamt) {
  const letzte = [...letzteVersuche().values()];
  const summe = letzte.reduce((a, e) => a + (e.punkte ?? 0), 0);
  const lernzeitGesamt = Object.values(daten.lernzeit).reduce((a, c) => a + c, 0);
  return {
    beantwortet: letzte.length,
    fragenGesamt,
    versucheGesamt: daten.ergebnisse.length,
    schnitt: letzte.length ? summe / letzte.length : 0,
    schwach: letzte.filter((e) => (e.punkte ?? 0) < 6).length,
    stark: letzte.filter((e) => (e.punkte ?? 0) >= 8).length,
    lernzeitGesamt,
    lernzeitHeute: daten.lernzeit[heute()] || 0,
    lerntage: Object.keys(daten.lernzeit).length,
    serie: aktuelleSerie(),
  };
}

// Wie viele Tage in Folge (bis heute oder gestern) wurde gelernt?
function aktuelleSerie() {
  let serie = 0;
  const jetzt = new Date();
  for (let i = 0; i < 400; i++) {
    const d = new Date(jetzt.getTime() - i * 86400000);
    const tag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (daten.lernzeit[tag]) serie++;
    else if (i > 0) break; // heute noch nichts gelernt bricht die Serie nicht sofort
  }
  return serie;
}

// Import aus dem alten localStorage-Format der ersten Version
export async function importiereAltdaten(eintraege) {
  let uebernommen = 0;
  const bekannt = new Set(daten.ergebnisse.map((e) => `${e.frageId}|${e.zeit}`));
  for (const e of eintraege) {
    const schluessel = `${e.frageId}|${e.zeit}`;
    if (bekannt.has(schluessel)) continue;
    daten.ergebnisse.push({ id: `alt-${uebernommen}-${Date.now()}`, ...e });
    uebernommen++;
  }
  daten.ergebnisse.sort((a, b) => String(a.zeit).localeCompare(String(b.zeit)));
  if (uebernommen) await schreiben();
  return uebernommen;
}

export const STORE_PFAD = DATEI;
