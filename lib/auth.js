// Einfacher Login-Schutz fuer die gesamte Anwendung.
// Zugangsdaten (Benutzername/Passwort) liegen in der lokalen .env-Datei
// (siehe lib/env.js, gitignored). Sitzungen werden serverseitig im Speicher
// gehalten; der Browser erhaelt nur ein zufaelliges, httpOnly-Cookie.

import crypto from "node:crypto";
import { leseEnv, setzeEnvWert } from "./env.js";

const NUTZER_VAR = "AEVO_USER";
const PASSWORT_VAR = "AEVO_PASSWORD";

export const COOKIE_NAME = "aevo_sid";
const SITZUNGSDAUER_MS = 12 * 60 * 60 * 1000; // 12 Stunden
const MAX_VERSUCHE = 5;
const SPERRE_MS = 5 * 60 * 1000; // 5 Minuten Sperre nach zu vielen Fehlversuchen

// -------------------------------------------------------- Zugangsdaten

// Beim ersten Start ohne hinterlegte Zugangsdaten wird automatisch ein
// zufaelliges Passwort erzeugt und einmalig auf der Konsole ausgegeben.
export function stelleZugangsdatenSicher() {
  const env = leseEnv();
  let nutzer = env[NUTZER_VAR];
  let passwort = env[PASSWORT_VAR];

  if (!nutzer) {
    nutzer = "admin";
    setzeEnvWert(NUTZER_VAR, nutzer);
  }

  if (!passwort) {
    passwort = crypto.randomBytes(9).toString("base64url");
    setzeEnvWert(PASSWORT_VAR, passwort);
    console.log("\n===========================================================");
    console.log(" Kein Login in .env gefunden - Zugangsdaten wurden erzeugt:");
    console.log(`   Benutzername: ${nutzer}`);
    console.log(`   Passwort:     ${passwort}`);
    console.log(" Bitte notieren. Aenderbar in der Datei .env (AEVO_USER / AEVO_PASSWORD).");
    console.log("===========================================================\n");
  }

  return { nutzer, passwort };
}

function aktuelleZugangsdaten() {
  const env = leseEnv();
  return { nutzer: env[NUTZER_VAR] || "", passwort: env[PASSWORT_VAR] || "" };
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

const sitzungen = new Map(); // token -> { nutzer, ablauf }

function neuesToken() {
  return crypto.randomBytes(32).toString("hex");
}

function raeumeAb() {
  const jetzt = Date.now();
  for (const [token, s] of sitzungen) {
    if (s.ablauf <= jetzt) sitzungen.delete(token);
  }
}

export function erstelleSitzung(nutzer) {
  raeumeAb();
  const token = neuesToken();
  sitzungen.set(token, { nutzer, ablauf: Date.now() + SITZUNGSDAUER_MS });
  return token;
}

export function beendeSitzung(token) {
  if (token) sitzungen.delete(token);
}

export function pruefeSitzung(token) {
  if (!token) return null;
  const s = sitzungen.get(token);
  if (!s) return null;
  if (s.ablauf <= Date.now()) {
    sitzungen.delete(token);
    return null;
  }
  return s;
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
