// Dauerhafter Speicher: Profil, Ergebnisse und Lernzeit in data/store.json.
// Bewusst eine einzelne JSON-Datei - die Datenmenge einer einzelnen Lernenden
// bleibt klein, und die Datei laesst sich sichern oder mitnehmen.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wurzel = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Ablageort der Nutzdaten. Standard ist data/ im Projekt - das reicht lokal.
// Auf einem Hoster wie Render ist dieses Verzeichnis fluechtig: bei jedem Deploy,
// Neustart oder Aufwachen aus dem Ruhezustand ist es wieder leer. Dort muss
// DATA_DIR auf ein dauerhaftes Verzeichnis zeigen (z.B. den Mount-Pfad einer
// Persistent Disk, ueblicherweise /var/data).
const DATEN_DIR = process.env.DATA_DIR || path.join(wurzel, "data");
const DATEI = path.join(DATEN_DIR, "store.json");

// Merkt sich, ob das Schreiben zuletzt funktioniert hat - die Oberflaeche
// soll nicht stillschweigend Ergebnisse verlieren.
let schreibFehler = null;
let schreibZaehler = 0;

const LEER = {
  version: 2,
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
};

let daten = laden();

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

function laden() {
  uebernehmeAlteAblage();
  try {
    const roh = JSON.parse(fs.readFileSync(DATEI, "utf8"));
    return {
      ...LEER,
      ...roh,
      profil: { ...LEER.profil, ...(roh.profil || {}) },
      ergebnisse: Array.isArray(roh.ergebnisse) ? roh.ergebnisse : [],
      lernzeit: roh.lernzeit && typeof roh.lernzeit === "object" ? roh.lernzeit : {},
    };
  } catch {
    return structuredClone(LEER);
  }
}

function schreiben() {
  try {
    fs.mkdirSync(path.dirname(DATEI), { recursive: true });
    const temp = `${DATEI}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(daten, null, 2), "utf8");
    fs.renameSync(temp, DATEI); // atomar: nie eine halb geschriebene Datei
    schreibFehler = null;
    schreibZaehler++;
    return true;
  } catch (err) {
    // Die Daten bleiben im Arbeitsspeicher gueltig, sind aber nach einem
    // Neustart verloren. Der Fehler wird gemeldet statt verschluckt.
    schreibFehler = err.message;
    console.error(`[store] Schreiben nach ${DATEI} fehlgeschlagen: ${err.message}`);
    return false;
  }
}

// Zustand der Ablage fuer die Diagnose-Anzeige
export function speicherStatus() {
  let schreibbar = false;
  try {
    fs.mkdirSync(DATEN_DIR, { recursive: true });
    fs.accessSync(DATEN_DIR, fs.constants.W_OK);
    schreibbar = true;
  } catch {
    schreibbar = false;
  }
  return {
    pfad: DATEI,
    verzeichnis: DATEN_DIR,
    ausUmgebung: Boolean(process.env.DATA_DIR),
    schreibbar,
    dateiVorhanden: fs.existsSync(DATEI),
    letzterFehler: schreibFehler,
    schreibvorgaenge: schreibZaehler,
    ergebnisse: daten.ergebnisse.length,
    lerntage: Object.keys(daten.lernzeit).length,
  };
}

export function heute() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tagVon(iso) {
  return String(iso || "").slice(0, 10);
}

// ------------------------------------------------------------------ Profil

export function holeProfil() {
  return { ...daten.profil };
}

export function setzeProfil(teil) {
  const erlaubt = ["name", "pruefungstermin", "standardmodell", "tagesziel", "stimme", "sprechtempo", "autoVorlesen"];
  for (const feld of erlaubt) {
    if (teil[feld] !== undefined) daten.profil[feld] = teil[feld];
  }
  daten.profil.tagesziel = Math.min(600, Math.max(0, Number(daten.profil.tagesziel) || 0));
  daten.profil.sprechtempo = Math.min(2, Math.max(0.5, Number(daten.profil.sprechtempo) || 1));
  daten.profil.autoVorlesen = Boolean(daten.profil.autoVorlesen);
  schreiben();
  return holeProfil();
}

// -------------------------------------------------------------- Ergebnisse

export function speichereErgebnis(eintrag) {
  const satz = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    zeit: new Date().toISOString(),
    ...eintrag,
  };
  daten.ergebnisse.push(satz);
  // Verlauf begrenzen, damit die Datei nicht unbegrenzt waechst
  if (daten.ergebnisse.length > 5000) daten.ergebnisse = daten.ergebnisse.slice(-5000);
  const gespeichert = schreiben();
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

export function loescheErgebnisse() {
  daten.ergebnisse = [];
  schreiben();
}

export function loescheFrageVerlauf(frageId) {
  daten.ergebnisse = daten.ergebnisse.filter((e) => e.frageId !== frageId);
  schreiben();
}

// ---------------------------------------------------------------- Lernzeit

export function addiereLernzeit(sekunden, tag = heute()) {
  const s = Math.min(3600, Math.max(0, Math.round(Number(sekunden) || 0)));
  if (!s) return daten.lernzeit[tag] || 0;
  daten.lernzeit[tag] = (daten.lernzeit[tag] || 0) + s;
  schreiben();
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
  const tage = Object.keys(daten.lernzeit).length;
  return {
    beantwortet: letzte.length,
    fragenGesamt,
    versucheGesamt: daten.ergebnisse.length,
    schnitt: letzte.length ? summe / letzte.length : 0,
    schwach: letzte.filter((e) => (e.punkte ?? 0) < 6).length,
    stark: letzte.filter((e) => (e.punkte ?? 0) >= 8).length,
    lernzeitGesamt,
    lernzeitHeute: daten.lernzeit[heute()] || 0,
    lerntage: tage,
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
export function importiereAltdaten(eintraege) {
  let uebernommen = 0;
  const bekannt = new Set(daten.ergebnisse.map((e) => `${e.frageId}|${e.zeit}`));
  for (const e of eintraege) {
    const schluessel = `${e.frageId}|${e.zeit}`;
    if (bekannt.has(schluessel)) continue;
    daten.ergebnisse.push({ id: `alt-${uebernommen}-${Date.now()}`, ...e });
    uebernommen++;
  }
  daten.ergebnisse.sort((a, b) => String(a.zeit).localeCompare(String(b.zeit)));
  if (uebernommen) schreiben();
  return uebernommen;
}

export const STORE_PFAD = DATEI;
