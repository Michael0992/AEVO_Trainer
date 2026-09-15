/* Schwachstellen: Kategorien nach Punkteschnitt, schwache Einzelfragen,
   noch nicht bearbeitete Fragen - jeweils mit Direktstart ins Quiz. */

import { $, api, renderNav, starteLernuhr, datumLang, punkteKlasse } from "./common.js";

let alleOffenenZeigen = false;
let daten = null;

async function init() {
  renderNav("schwaechen", { titel: "Schwachstellen", untertitel: "Themen mit dem größten Übungsbedarf" });
  starteLernuhr();

  daten = await api("/api/schwaechen");

  zeigeKacheln(daten.uebersicht, daten.kategorien);
  zeigeKategorien(daten.kategorien);
  zeigeSchwacheFragen(daten.schwacheFragen);
  zeigeOffene(daten.offeneFragen);

  $("btnUeben").addEventListener("click", () => {
    location.href = daten.schwacheFragen.length ? "quiz.html?schwach=1" : "quiz.html?nuroffene=1";
  });
  $("btnMehrOffen").addEventListener("click", () => {
    alleOffenenZeigen = true;
    zeigeOffene(daten.offeneFragen);
  });
}

function zeigeKacheln(u, kategorien) {
  const schwaechste = kategorien[0];
  const staerkste = kategorien[kategorien.length - 1];

  const kacheln = [
    { wert: u.schwach, label: "Fragen unter 6", klein: "letzter Versuch zählt" },
    { wert: u.stark, label: "Fragen ab 8", klein: "prüfungssicher" },
    { wert: `${u.fragenGesamt - u.beantwortet}`, label: "noch offen", klein: `von ${u.fragenGesamt} Fragen` },
    {
      wert: schwaechste ? schwaechste.schnitt.toFixed(1) : "–",
      label: "schwächstes Thema",
      klein: schwaechste ? kuerze(schwaechste.kategorie) : "noch keine Daten",
    },
    {
      wert: staerkste ? staerkste.schnitt.toFixed(1) : "–",
      label: "stärkstes Thema",
      klein: staerkste ? kuerze(staerkste.kategorie) : "noch keine Daten",
    },
  ];

  $("kacheln").replaceChildren(
    ...kacheln.map((k) => {
      const div = document.createElement("div");
      div.className = "kachel";
      const strong = document.createElement("strong");
      strong.textContent = k.wert;
      const span = document.createElement("span");
      span.textContent = k.label;
      const small = document.createElement("small");
      small.textContent = k.klein;
      div.append(strong, span, small);
      return div;
    }),
  );
}

function kuerze(text, laenge = 34) {
  return text.length > laenge ? `${text.slice(0, laenge - 1)}…` : text;
}

function zeigeKategorien(kategorien) {
  const box = $("kategorien");
  if (!kategorien.length) {
    box.replaceChildren(leer('Noch keine Bewertung vorhanden. <a href="quiz.html">Erste Frage beantworten</a>.'));
    return;
  }

  box.replaceChildren(
    ...kategorien.map((k) =>
      zeile({
        titel: k.kategorie,
        unter: `${k.bereich} · ${k.anzahl} beantwortet${k.schwach ? ` · ${k.schwach} schwach` : ""}`,
        anteil: k.schnitt / 10,
        klasse: k.schnitt >= 8 ? "gut" : k.schnitt >= 6 ? "mittel" : "schwach",
        wert: k.schnitt.toFixed(1),
        klein: "Ø von 10",
        ziel: `quiz.html?bereich=${encodeURIComponent(k.bereich)}&kategorie=${encodeURIComponent(k.kategorie)}`,
      }),
    ),
  );
}

function zeigeSchwacheFragen(fragen) {
  $("schwachAnzahl").textContent = fragen.length ? `${fragen.length} Fragen` : "";
  const box = $("schwacheFragen");
  if (!fragen.length) {
    box.replaceChildren(leer("Keine Frage unter 6 Punkten. Entweder läuft es gut – oder es fehlen noch Bewertungen."));
    return;
  }

  box.replaceChildren(
    ...fragen.slice(0, 20).map((f) =>
      zeile({
        titel: f.frage,
        unter: `${f.kategorie} · zuletzt ${datumLang(f.zeit)}`,
        anteil: f.punkte / 10,
        klasse: "schwach",
        wert: String(f.punkte),
        klein: "von 10",
        wertKlasse: punkteKlasse(f.punkte),
        ziel: `quiz.html?frage=${encodeURIComponent(f.frageId)}`,
      }),
    ),
  );
}

function zeigeOffene(fragen) {
  $("offenAnzahl").textContent = fragen.length ? `${fragen.length} Fragen` : "alle bearbeitet";
  const box = $("offeneFragen");
  if (!fragen.length) {
    box.replaceChildren(leer("Alle Fragen wurden mindestens einmal beantwortet. Respekt."));
    $("btnMehrOffen").hidden = true;
    return;
  }

  const sichtbar = alleOffenenZeigen ? fragen : fragen.slice(0, 10);
  $("btnMehrOffen").hidden = alleOffenenZeigen || fragen.length <= 10;

  box.replaceChildren(
    ...sichtbar.map((f) =>
      zeile({
        titel: f.frage,
        unter: `${f.bereich} · ${f.kategorie}`,
        anteil: 0,
        klasse: "mittel",
        wert: "–",
        klein: "offen",
        ziel: `quiz.html?frage=${encodeURIComponent(f.frageId)}`,
      }),
    ),
  );
}

function zeile({ titel, unter, anteil, klasse, wert, klein, wertKlasse, ziel }) {
  const div = document.createElement("div");
  div.className = "rang-zeile klickbar";
  div.addEventListener("click", () => (location.href = ziel));

  const kopf = document.createElement("div");
  kopf.className = "rang-titel";
  const stark = document.createElement("strong");
  stark.textContent = titel;
  const span = document.createElement("span");
  span.textContent = unter;
  kopf.append(stark, span);

  const balken = document.createElement("div");
  balken.className = "rang-balken";
  const i = document.createElement("i");
  i.className = klasse;
  i.style.width = `${Math.max(anteil * 100, 2)}%`;
  balken.append(i);

  const w = document.createElement("div");
  w.className = `rang-wert ${wertKlasse || ""}`;
  w.textContent = wert;
  const small = document.createElement("small");
  small.textContent = klein;
  w.append(small);

  div.append(kopf, balken, w);
  return div;
}

function leer(html) {
  const div = document.createElement("div");
  div.className = "leer-hinweis";
  div.innerHTML = html;
  return div;
}

init();
