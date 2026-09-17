// Einfacher Login-Schutz fuer die gesamte Anwendung.
// Zugangsdaten (Benutzername/Passwort) liegen in der lokalen .env-Datei
// (siehe lib/env.js, gitignored). Sitzungen werden serverseitig im Speicher
// gehalten; der Browser erhaelt nur ein zufaelliges, httpOnly-Cookie.

import crypto from "node:crypto";
import { holeEnvWert, setzeEnvWert } from "./env.js";

const NUTZER_VAR = "AEVO_USER";
const PASSWORT_VAR = "AEVO_PASSWORD";
const GEHEIMNIS_VAR = "SESSION_SECRET";

export const COOKIE_NAME = "aevo_sid";
const SITZUNGSDAUER_MS = 12 * 60 * 60 * 1000; // 12 Stunden
const MAX_VERSUCHE = 5;
const SPERRE_MS = 5 * 60 * 1000; // 5 Minuten Sperre nach zu vielen Fehlversuchen

// -------------------------------------------------------- Zugangsdaten

// Beim ersten Start ohne hinterlegte Zugangsdaten (weder .env-Datei noch
// Umgebungsvariable, z.B. bei einem Hoster wie Render im Dashboard gesetzt)
// wird automatisch ein zufaelliges Passwort erzeugt und einmalig auf der
// Konsole ausgegeben. Laesst sich die .env-Datei nicht schreiben (z.B. weil
// die Plattform kein beschreibbares Dateisystem hat), gilt das erzeugte
// Passwort trotzdem fuer die laufende Instanz - es geht nur bei einem Neustart
// verloren, wenn es nicht als Umgebungsvariable hinterlegt wird.
export function stelleZugangsdatenSicher() {
  let nutzer = holeEnvWert(NUTZER_VAR);
  let passwort = holeEnvWert(PASSWORT_VAR);

  if (!nutzer) {
    nutzer = "admin";
    try {
      setzeEnvWert(NUTZER_VAR, nutzer);
    } catch {
      /* z.B. schreibgeschuetztes Dateisystem - Wert gilt nur fuer diesen Prozess */
    }
  }

  if (!passwort) {
    passwort = crypto.randomBytes(9).toString("base64url");
    let dauerhaft = true;
    try {
      setzeEnvWert(PASSWORT_VAR, passwort);
    } catch {
      dauerhaft = false;
    }
    if (!dauerhaft) {
      console.warn(
        "WARNUNG: Zugangsdaten konnten nicht gespeichert werden. Setze AEVO_USER und " +
          "AEVO_PASSWORD als Umgebungsvariablen, sonst gilt das Passwort nur bis zum Neustart.",
      );
    }
    process.env[NUTZER_VAR] = nutzer;
    process.env[PASSWORT_VAR] = passwort;
    console.log("\n===========================================================");
    console.log(" Kein Login gefunden - Zugangsdaten wurden erzeugt:");
    console.log(`   Benutzername: ${nutzer}`);
    console.log(`   Passwort:     ${passwort}`);
    console.log(" Bitte notieren. Aenderbar per .env-Datei oder Umgebungsvariable");
    console.log(" (AEVO_USER / AEVO_PASSWORD). Bei Hostern ohne persistenten");
    console.log(" Speicher (z.B. Render) unbedingt als Umgebungsvariable setzen,");
    console.log(" sonst gilt dieses Passwort nur bis zum naechsten Neustart.");
    console.log("===========================================================\n");
  }

  return { nutzer, passwort };
}

function aktuelleZugangsdaten() {
  return { nutzer: holeEnvWert(NUTZER_VAR), passwort: holeEnvWert(PASSWORT_VAR) };
}

// Vergleich ohne Laufzeitunterschiede (schuetzt gegen Timing-Angriffe).
function sicherGleich(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Dummy-Vergleich gleicher Laenge, damit die Antwortzeit nicht verraet,
    // dass die Laenge bereits nicht passt.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------- Brute-Force-Schutz

const versuche = new Map(); // ip -> { anzahl, gesperrtBis }

function clientSchluessel(req) {
  return req.socket?.remoteAddress || "unbekannt";
}

function istGesperrt(schluessel) {
  const eintrag = versuche.get(schluessel);
  if (!eintrag) return false;
  if (eintrag.gesperrtBis && eintrag.gesperrtBis > Date.now()) return true;
  if (eintrag.gesperrtBis && eintrag.gesperrtBis <= Date.now()) versuche.delete(schluessel);
  return false;
}

function melkeFehlversuch(schluessel) {
  const eintrag = versuche.get(schluessel) || { anzahl: 0, gesperrtBis: 0 };
  eintrag.anzahl += 1;
  if (eintrag.anzahl >= MAX_VERSUCHE) {
    eintrag.gesperrtBis = Date.now() + SPERRE_MS;
    eintrag.anzahl = 0;
  }
  versuche.set(schluessel, eintrag);
}

function loescheVersuche(schluessel) {
  versuche.delete(schluessel);
}

// -------------------------------------------------------------- Sitzungen

/* Sitzungen sind zustandslos: Der Token traegt Nutzer und Ablaufzeitpunkt und
   ist mit HMAC signiert. Vorteil gegenueber einer Map im Arbeitsspeicher: ein
   Neustart des Servers meldet niemanden ab. Genau das passiert bei Hostern wie
   Render staendig, weil die Instanz nach Leerlauf heruntergefahren wird. */

// Nur fuer den Notfall, wenn gar keine Zugangsdaten ermittelbar sind.
const prozessGeheimnis = crypto.randomBytes(32).toString("hex");

function sitzungsGeheimnis() {
  const explizit = holeEnvWert(GEHEIMNIS_VAR);
  if (explizit) return explizit;

  // Aus den Zugangsdaten abgeleitet: ueber Neustarts stabil, solange das
  // Passwort gleich bleibt - und eine Passwortaenderung entwertet automatisch
  // alle noch offenen Sitzungen.
  const { nutzer, passwort } = aktuelleZugangsdaten();
  if (passwort) {
    return crypto.createHash("sha256").update(`aevo-sitzung|${nutzer}|${passwort}`).digest("hex");
  }
  return prozessGeheimnis;
}

function signiere(nutzlast) {
  return crypto.createHmac("sha256", sitzungsGeheimnis()).update(nutzlast).digest("base64url");
}

// Abmeldungen dieser Instanz. Nach einem Neustart laeuft ein abgemeldeter Token
// regulaer ueber seinen Ablaufzeitpunkt aus.
const widerrufen = new Set();

export function erstelleSitzung(nutzer) {
  const nutzlast = Buffer.from(JSON.stringify({ n: nutzer, a: Date.now() + SITZUNGSDAUER_MS })).toString("base64url");
  return `${nutzlast}.${signiere(nutzlast)}`;
}

export function beendeSitzung(token) {
  if (!token) return;
  widerrufen.add(token);
  if (widerrufen.size > 500) widerrufen.clear(); // begrenzen, Ablauf regelt den Rest
}

export function pruefeSitzung(token) {
  if (!token || typeof token !== "string" || widerrufen.has(token)) return null;

  const trenner = token.lastIndexOf(".");
  if (trenner < 1) return null;

  const nutzlast = token.slice(0, trenner);
  const signatur = Buffer.from(token.slice(trenner + 1));
  const erwartet = Buffer.from(signiere(nutzlast));
  if (signatur.length !== erwartet.length || !crypto.timingSafeEqual(signatur, erwartet)) return null;

  try {
    const daten = JSON.parse(Buffer.from(nutzlast, "base64url").toString("utf8"));
    if (!daten.a || daten.a <= Date.now()) return null;
    return { nutzer: daten.n, ablauf: daten.a };
  } catch {
    return null;
  }
}

// -------------------------------------------------------------- Login

// Gibt bei Erfolg ein neues Sitzungs-Token zurueck, sonst null.
// Wirft bei zu vielen Fehlversuchen einen Fehler mit .code = "gesperrt".
export function versuchLogin(req, nutzerEingabe, passwortEingabe) {
  const schluessel = clientSchluessel(req);
  if (istGesperrt(schluessel)) {
    const fehler = new Error("Zu viele Fehlversuche. Bitte kurz warten.");
    fehler.code = "gesperrt";
    throw fehler;
  }

  const { nutzer, passwort } = aktuelleZugangsdaten();
  const nutzerOk = nutzer && sicherGleich(nutzerEingabe || "", nutzer);
  const passwortOk = passwort && sicherGleich(passwortEingabe || "", passwort);

  if (!nutzerOk || !passwortOk) {
    melkeFehlversuch(schluessel);
    return null;
  }

  loescheVersuche(schluessel);
  return erstelleSitzung(nutzer);
}

// ------------------------------------------------------------ Cookies

export function leseCookie(req, name) {
  const roh = req.headers.cookie;
  if (!roh) return null;
  for (const teil of roh.split(";")) {
    const i = teil.indexOf("=");
    if (i === -1) continue;
    const k = teil.slice(0, i).trim();
    if (k === name) return decodeURIComponent(teil.slice(i + 1).trim());
  }
  return null;
}

export function setzeSitzungsCookie(res, token, { sicher = false } = {}) {
  const teile = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SITZUNGSDAUER_MS / 1000)}`,
  ];
  if (sicher) teile.push("Secure");
  res.setHeader("Set-Cookie", teile.join("; "));
}

export function loescheSitzungsCookie(res, { sicher = false } = {}) {
  const teile = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (sicher) teile.push("Secure");
  res.setHeader("Set-Cookie", teile.join("; "));
}
