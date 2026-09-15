// AEVO Trainer - lokaler Node-Server
// Liefert das Frontend aus /public und stellt die API bereit:
// Fragenkatalog, Bewertung, Wissensfragen, Profil, API-Schluessel, Ergebnisse, Lernzeit.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bewerteAntwort, erklaereFrage, listeModelle, fehlertext, EMPFOHLENE_MODELLE, STANDARD_MODELL } from "./lib/claude.js";
import { holeSchluessel, setzeSchluessel, schluesselUebersicht, ANBIETER, ENV_PFAD } from "./lib/env.js";
import * as store from "./lib/store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const katalog = JSON.parse(fs.readFileSync(path.join(here, "data", "questions.json"), "utf8"));
const wissen = JSON.parse(fs.readFileSync(path.join(here, "data", "wissen.json"), "utf8"));

// Pruefungsfragen und Wissensfragen in einem Index - beide werden gleich bewertet.
const alleFragen = [...katalog.fragen, ...wissen.fragen];
const fragenById = new Map(alleFragen.map((f) => [f.id, f]));

// ------------------------------------------------------------------ Helfer

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function leseBody(req, limit = 300000) {
  return new Promise((resolve, reject) => {
    let roh = "";
    req.on("data", (chunk) => {
      roh += chunk;
      if (roh.length > limit) {
        reject(new Error("Anfrage zu gross."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(roh ? JSON.parse(roh) : {});
      } catch {
        reject(new Error("Ungueltiges JSON im Request-Body."));
      }
    });
    req.on("error", reject);
  });
}

function schluesselOderFehler(res) {
  const key = holeSchluessel("anthropic");
  if (!key) {
    sendJson(res, 400, {
      fehler: "Kein API-Schluessel hinterlegt. Bitte im Profil unter „API-Schlüssel“ eintragen.",
      code: "kein_schluessel",
    });
    return null;
  }
  return key;
}

function modellWahl(gewuenscht) {
  return gewuenscht || store.holeProfil().standardmodell || STANDARD_MODELL;
}

// ------------------------------------------------------------------ Routen

const routen = {
  "GET /api/questions": (req, res) => sendJson(res, 200, katalog),

  "GET /api/wissen": (req, res) => sendJson(res, 200, wissen),

  "GET /api/models": async (req, res) => {
    const key = schluesselOderFehler(res);
    if (!key) return;
    try {
      sendJson(res, 200, { modelle: await listeModelle(key), standard: modellWahl() });
    } catch (err) {
      sendJson(res, err?.status && err.status < 500 ? err.status : 502, {
        fehler: fehlertext(err),
        modelle: EMPFOHLENE_MODELLE.map((m) => ({ ...m, empfohlen: true })),
      });
    }
  },

  "POST /api/evaluate": async (req, res, body) => {
    const key = schluesselOderFehler(res);
    if (!key) return;

    const frage = fragenById.get(body.questionId);
    const antwort = (body.antwort || "").trim();
    if (!frage) return sendJson(res, 404, { fehler: "Frage nicht gefunden." });
    if (!antwort) return sendJson(res, 400, { fehler: "Die Antwort ist leer." });

    try {
      const { bewertung, model } = await bewerteAntwort({
        apiKey: key,
        model: modellWahl(body.model),
        frage,
        antwort,
      });
      const satz = store.speichereErgebnis({
        frageId: frage.id,
        bereich: frage.bereich,
        kategorie: frage.kategorie,
        frage: frage.frage,
        antwort,
        punkte: bewertung.punkte,
        teilpunkte: bewertung.teilpunkte,
        bewertung,
        model,
        eingabe: body.eingabe === "mikrofon" ? "mikrofon" : "tastatur",
      });
      sendJson(res, 200, { bewertung, model, ergebnisId: satz.id, zeit: satz.zeit });
    } catch (err) {
      sendJson(res, err?.status && err.status < 500 ? err.status : 502, { fehler: fehlertext(err) });
    }
  },

  "POST /api/wissen/frage": async (req, res, body) => {
    const key = schluesselOderFehler(res);
    if (!key) return;

    const frage = (body.frage || "").trim();
    if (!frage) return sendJson(res, 400, { fehler: "Bitte eine Frage eingeben." });
    if (frage.length > 2000) return sendJson(res, 400, { fehler: "Die Frage ist zu lang." });

    try {
      const ergebnis = await erklaereFrage({
        apiKey: key,
        model: modellWahl(body.model),
        frage,
        thema: body.thema || "",
      });
      sendJson(res, 200, ergebnis);
    } catch (err) {
      sendJson(res, err?.status && err.status < 500 ? err.status : 502, { fehler: fehlertext(err) });
    }
  },

  // ------------------------------------------------------------- Profil

  "GET /api/profil": (req, res) =>
    sendJson(res, 200, {
      profil: store.holeProfil(),
      uebersicht: store.gesamtUebersicht(alleFragen.length),
      modelle: EMPFOHLENE_MODELLE.map((m) => ({ ...m, empfohlen: true })),
    }),

  "PUT /api/profil": (req, res, body) => sendJson(res, 200, { profil: store.setzeProfil(body) }),

  // ------------------------------------------------- API-Schluessel (.env)

  "GET /api/keys": (req, res) => sendJson(res, 200, { schluessel: schluesselUebersicht(), datei: ENV_PFAD }),

  "PUT /api/keys": (req, res, body) => {
    const anbieter = body.anbieter || "anthropic";
    if (!ANBIETER[anbieter]) return sendJson(res, 400, { fehler: "Unbekannter Anbieter." });
    const wert = String(body.schluessel || "").trim();
    if (wert && wert.length < 20) return sendJson(res, 400, { fehler: "Der Schluessel sieht zu kurz aus." });
    try {
      setzeSchluessel(anbieter, wert);
      sendJson(res, 200, { schluessel: schluesselUebersicht(), datei: ENV_PFAD });
    } catch (err) {
      sendJson(res, 500, { fehler: err.message });
    }
  },

  // Klartext nur auf ausdrueckliche Anforderung - die Seite fragt vorher nach.
  "POST /api/keys/anzeigen": (req, res, body) => {
    const anbieter = body.anbieter || "anthropic";
    if (!ANBIETER[anbieter]) return sendJson(res, 400, { fehler: "Unbekannter Anbieter." });
    sendJson(res, 200, { anbieter, schluessel: holeSchluessel(anbieter) });
  },

  // ---------------------------------------------- Ergebnisse und Statistik

  "GET /api/ergebnisse": (req, res, body, url) => {
    const tage = Number(url.searchParams.get("tage")) || 0;
    sendJson(res, 200, { ergebnisse: store.holeErgebnisse({ tage }) });
  },

  "GET /api/statistik": (req, res, body, url) => {
    const tage = Math.min(365, Math.max(7, Number(url.searchParams.get("tage")) || 30));
    sendJson(res, 200, {
      tage,
      uebersicht: store.gesamtUebersicht(alleFragen.length),
      reihe: store.tagesreihe(tage),
      kategorien: store.kategorieAuswertung(),
      verlauf: store.verlaufJeFrage(),
      profil: store.holeProfil(),
    });
  },

  "GET /api/schwaechen": (req, res) => {
    const kategorien = store.kategorieAuswertung();
    const letzte = store.letzteVersuche();
    const offen = alleFragen.filter((f) => !letzte.has(f.id));
    const schwacheFragen = [...letzte.values()]
      .filter((e) => (e.punkte ?? 0) < 6)
      .sort((a, b) => a.punkte - b.punkte)
      .map((e) => ({ ...e, bewertung: undefined, antwort: undefined }));
    sendJson(res, 200, {
      kategorien,
      schwacheFragen,
      offeneFragen: offen.map((f) => ({ frageId: f.id, frage: f.frage, bereich: f.bereich, kategorie: f.kategorie })),
      uebersicht: store.gesamtUebersicht(alleFragen.length),
    });
  },

  "DELETE /api/ergebnisse": (req, res) => {
    store.loescheErgebnisse();
    sendJson(res, 200, { ok: true });
  },

  "POST /api/ergebnisse/import": (req, res, body) => {
    const eintraege = Array.isArray(body.eintraege) ? body.eintraege : [];
    sendJson(res, 200, { uebernommen: store.importiereAltdaten(eintraege) });
  },

  // ---------------------------------------------------------- Lernzeit

  "POST /api/lernzeit": (req, res, body) => {
    const gesamt = store.addiereLernzeit(body.sekunden);
    sendJson(res, 200, { heute: gesamt });
  },

  "GET /api/lernzeit": (req, res) =>
    sendJson(res, 200, { lernzeit: store.holeLernzeit(), heute: store.holeLernzeit()[store.heute()] || 0 }),
};

// ------------------------------------------------------------------ Server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const schluessel = `${req.method} ${url.pathname}`;

  try {
    const route = routen[schluessel];
    if (route) {
      const body = req.method === "POST" || req.method === "PUT" ? await leseBody(req) : {};
      return await route(req, res, body, url);
    }

    if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { fehler: "Unbekannter Endpunkt." });

    // statische Dateien
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const wurzel = path.join(here, "public");
    const datei = path.join(wurzel, rel);
    if (!datei.startsWith(wurzel)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Verboten");
    }
    fs.readFile(datei, (err, buf) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Nicht gefunden");
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(datei)] || "application/octet-stream" });
      res.end(buf);
    });
  } catch (err) {
    sendJson(res, 500, { fehler: fehlertext(err) });
  }
});

server.listen(PORT, () => {
  console.log(`AEVO Trainer laeuft auf http://localhost:${PORT}`);
  console.log(`${katalog.fragen.length} Pruefungsfragen + ${wissen.fragen.length} Wissensfragen geladen`);
  console.log(holeSchluessel("anthropic") ? "API-Schluessel gefunden." : "Kein API-Schluessel - im Profil hinterlegen.");
});
