// Verwaltung der API-Schluessel in einer .env-Datei im Projektordner.
// Die Datei bleibt lokal (siehe .gitignore); Schluessel werden nie an Dritte gesendet.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wurzel = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Zwei moegliche Ablagen:
// - PROJEKT_ENV: die .env im Projektordner. Lokal der Normalfall.
// - DATEN_ENV:   .env im dauerhaften Datenverzeichnis (DATA_DIR). Auf einem
//   Hoster wie Render ueberlebt nur diese einen Neustart, weil das
//   Projektverzeichnis bei jedem Deploy neu angelegt wird.
// Gelesen wird beides (DATA_DIR gewinnt), geschrieben in die dauerhafte Datei.
const PROJEKT_ENV = path.join(wurzel, ".env");
const DATEN_ENV = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, ".env") : null;
const ENV_DATEI = DATEN_ENV || PROJEKT_ENV;

// Unterstuetzte Anbieter -> Variablenname in der .env
export const ANBIETER = {
  anthropic: { variable: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)", praefix: "sk-ant-" },
};

function parse(text) {
  const werte = {};
  for (const zeile of text.split(/\r?\n/)) {
    const t = zeile.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const name = t.slice(0, i).trim();
    let wert = t.slice(i + 1).trim();
    if ((wert.startsWith('"') && wert.endsWith('"')) || (wert.startsWith("'") && wert.endsWith("'"))) {
      wert = wert.slice(1, -1);
    }
    werte[name] = wert;
  }
  return werte;
}

function leseDatei(pfad) {
  try {
    return parse(fs.readFileSync(pfad, "utf8"));
  } catch {
    return {};
  }
}

export function leseEnv() {
  if (!DATEN_ENV) return leseDatei(PROJEKT_ENV);
  return { ...leseDatei(PROJEKT_ENV), ...leseDatei(DATEN_ENV) };
}

// Reihenfolge: .env-Datei zuerst, sonst Prozess-Umgebung (z.B. gesetzt beim Start
// oder als Umgebungsvariable bei einem Hoster wie Render, wo es keine .env-Datei gibt).
export function holeEnvWert(name) {
  return leseEnv()[name] || process.env[name] || "";
}

export function holeSchluessel(anbieter = "anthropic") {
  const eintrag = ANBIETER[anbieter];
  if (!eintrag) return "";
  return holeEnvWert(eintrag.variable);
}

// Setzt oder loescht eine einzelne Variable in der .env-Datei, ohne die uebrigen Zeilen zu veraendern.
export function setzeEnvWert(name, wert) {
  const sauber = String(wert ?? "").trim();
  fs.mkdirSync(path.dirname(ENV_DATEI), { recursive: true });
  let zeilen = [];
  try {
    zeilen = fs.readFileSync(ENV_DATEI, "utf8").split(/\r?\n/);
  } catch {
    zeilen = ["# AEVO Trainer - lokale Zugangsdaten. Nicht weitergeben, nicht einchecken."];
  }
  while (zeilen.length && zeilen[zeilen.length - 1].trim() === "") zeilen.pop();

  const index = zeilen.findIndex((z) => z.trim().startsWith(`${name}=`));
  if (!sauber) {
    if (index >= 0) zeilen.splice(index, 1);
  } else if (index >= 0) {
    zeilen[index] = `${name}=${sauber}`;
  } else {
    zeilen.push(`${name}=${sauber}`);
  }

  const inhalt = zeilen.filter((z, i) => z.trim() !== "" || i < zeilen.length - 1).join("\n").replace(/\n+$/, "") + "\n";
  fs.writeFileSync(ENV_DATEI, inhalt, { encoding: "utf8", mode: 0o600 });
}

export function setzeSchluessel(anbieter, wert) {
  const eintrag = ANBIETER[anbieter];
  if (!eintrag) throw new Error("Unbekannter Anbieter.");
  const sauber = String(wert || "").trim();
  setzeEnvWert(eintrag.variable, sauber);
  return maskiere(sauber);
}

export function maskiere(schluessel) {
  if (!schluessel) return "";
  if (schluessel.length <= 12) return "•".repeat(schluessel.length);
  return `${schluessel.slice(0, 8)}${"•".repeat(10)}${schluessel.slice(-4)}`;
}

export function schluesselUebersicht() {
  const env = leseEnv();
  return Object.entries(ANBIETER).map(([id, eintrag]) => {
    const ausDatei = env[eintrag.variable] || "";
    const ausUmgebung = process.env[eintrag.variable] || "";
    const wert = ausDatei || ausUmgebung;
    return {
      id,
      label: eintrag.label,
      praefix: eintrag.praefix,
      gesetzt: Boolean(wert),
      maskiert: maskiere(wert),
      quelle: ausDatei ? ".env-Datei" : ausUmgebung ? "Umgebungsvariable" : "",
      schreibbar: !ausUmgebung || Boolean(ausDatei),
    };
  });
}

export const ENV_PFAD = ENV_DATEI;
