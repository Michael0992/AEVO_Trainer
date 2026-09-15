/* Hauptmenü: Kennzahlen, Schlüsselstatus, Übernahme alter Browser-Daten. */

import { $, api, dauer } from "./common.js";

async function init() {
  // Daten der allerersten Version (localStorage) einmalig in den Server uebernehmen
  await uebernehmeAltdaten();

  const [statistik, keys, katalog, wissen] = await Promise.all([
    api("/api/statistik?tage=30").catch(() => null),
    api("/api/keys").catch(() => null),
    api("/api/questions").catch(() => null),
    api("/api/wissen").catch(() => null),
  ]);

  const profil = statistik?.profil;
  const u = statistik?.uebersicht;

  if (profil?.name) $("begruessung").textContent = `${gruss()}, ${profil.name}`;

  if (u) {
    $("hsBeantwortet").textContent = `${u.beantwortet}/${u.fragenGesamt}`;
    $("hsSchnitt").textContent = u.beantwortet ? u.schnitt.toFixed(1) : "–";
    $("hsHeute").textContent = dauer(u.lernzeitHeute);
    $("hsSerie").textContent = u.serie;
    $("mcQuiz").textContent = u.beantwortet
      ? `Weiter üben · ${u.fragenGesamt - u.beantwortet} offen →`
      : "Los geht's →";
    $("mcSchwaechen").textContent = u.schwach ? `${u.schwach} Fragen unter 6 Punkten →` : "Lücken finden →";
    $("mcFortschritt").textContent = u.lerntage ? `${u.lerntage} Lerntage erfasst →` : "Verlauf ansehen →";
  }

  if (profil?.pruefungstermin) {
    const tage = Math.ceil((new Date(profil.pruefungstermin) - new Date()) / 86400000);
    if (Number.isFinite(tage)) {
      $("hsTerminBox").hidden = false;
      $("hsTermin").textContent = tage >= 0 ? `${tage} Tage` : "abgelegt";
    }
  }

  const gesamtFragen = (katalog?.fragen?.length || 0) + (wissen?.fragen?.length || 0);
  if (gesamtFragen) {
    document.querySelector(".menu-card.primary p").textContent =
      `${gesamtFragen} Prüfungsfragen aus allen Handlungsfeldern, Fachgesprächsfällen und dem Wissensbereich. ` +
      "Antwort tippen oder diktieren, Bewertung mit 0–10 Punkten.";
  }
  if (wissen?.themen) $("mcWissen").textContent = `${wissen.themen.length} Themen →`;
  if (katalog) $("quelle").textContent = `Quelle der Prüfungsfragen: ${katalog.quelle} · ${katalog.hinweis}`;

  const anthropic = keys?.schluessel?.find((k) => k.id === "anthropic");
  $("schluesselHinweis").hidden = Boolean(anthropic?.gesetzt);
  if (anthropic?.gesetzt) $("mcProfil").textContent = `Schlüssel aktiv · ${anthropic.maskiert} →`;
}

$("btnAbmelden")?.addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST" });
  } finally {
    location.href = "/login.html";
  }
});

function gruss() {
  const h = new Date().getHours();
  if (h < 11) return "Guten Morgen";
  if (h < 18) return "Hallo";
  return "Guten Abend";
}

// Fortschritt der ersten Version lag im localStorage - einmalig uebernehmen.
async function uebernehmeAltdaten() {
  let alt;
  try {
    alt = JSON.parse(localStorage.getItem("aevo.fortschritt") || "null");
  } catch {
    return;
  }
  if (!alt || !Object.keys(alt).length) return;

  const eintraege = Object.entries(alt).map(([frageId, e]) => ({
    frageId,
    bereich: e.bewertung?.bereich || "Fragenkatalog",
    kategorie: e.bewertung?.kategorie || "Übernommen aus der ersten Version",
    frage: e.frage || frageId,
    antwort: e.antwort || "",
    punkte: e.punkte ?? 0,
    teilpunkte: e.bewertung?.teilpunkte,
    bewertung: e.bewertung,
    model: e.model || "",
    zeit: e.zeit || new Date().toISOString(),
  }));

  try {
    const { uebernommen } = await api("/api/ergebnisse/import", { methode: "POST", daten: { eintraege } });
    localStorage.removeItem("aevo.fortschritt");
    if (uebernommen) console.info(`${uebernommen} Ergebnisse aus der Browser-Speicherung übernommen.`);
  } catch {
    /* beim naechsten Aufruf erneut versuchen */
  }
}

init();
