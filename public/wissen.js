/* Wissensbereich: Themenkacheln mit Übungsfragen (gleiche Bewertung wie im Quiz)
   und freies Nachfragen beim KI-Prüfer. */

import {
  $,
  api,
  renderNav,
  starteLernuhr,
  Sprache,
  bewertungAlsText,
  erklaerungAlsText,
  datumLang,
  zeigeFehler,
  fuelleListe,
} from "./common.js";

const state = {
  katalog: null,
  thema: null,
  fragen: [],
  index: 0,
  ergebnisse: new Map(),
  profil: null,
  laeuft: false,
  letzteBewertung: null,
  letzteErklaerung: null,
};

async function init() {
  renderNav("wissen", { titel: "Wissensbereich", untertitel: "JAV, Vertrag, Teilzeit, Rahmenplan und mehr" });
  starteLernuhr();

  const [katalog, statistik, ergebnisse] = await Promise.all([
    api("/api/wissen"),
    api("/api/statistik?tage=7").catch(() => null),
    api("/api/ergebnisse").catch(() => ({ ergebnisse: [] })),
  ]);

  state.katalog = katalog;
  state.profil = statistik?.profil || null;
  for (const e of ergebnisse.ergebnisse || []) state.ergebnisse.set(e.frageId, e);

  $("wHinweis").textContent = katalog.hinweis;
  rendereThemen();

  if (Sprache.verfuegbar) {
    await Sprache.laden();
    Sprache.konfigurieren({ stimme: state.profil?.stimme, tempo: state.profil?.sprechtempo });
  } else {
    for (const id of ["uBtnVorlesen", "btnAntwortVorlesen"]) {
      $(id).disabled = true;
      $(id).title = "Dieser Browser kann keine Sprachausgabe.";
    }
  }

  initMikrofone();
  verdrahteUI();

  const start = new URL(location.href).searchParams.get("thema");
  if (start && katalog.themen.some((t) => t.id === start)) waehleThema(start);
}

// ------------------------------------------------------------- Themen

function rendereThemen() {
  const box = $("themen");
  box.replaceChildren(
    ...state.katalog.themen.map((t) => {
      const fragen = state.katalog.fragen.filter((f) => f.thema === t.id);
      const beantwortet = fragen.filter((f) => state.ergebnisse.has(f.id));
      const schnitt = beantwortet.length
        ? beantwortet.reduce((a, f) => a + state.ergebnisse.get(f.id).punkte, 0) / beantwortet.length
        : null;

      const karte = document.createElement("button");
      karte.type = "button";
      karte.className = `thema-karte${state.thema === t.id ? " active" : ""}`;
      karte.addEventListener("click", () => waehleThema(t.id));

      const icon = document.createElement("div");
      icon.className = "t-icon";
      icon.textContent = t.icon;

      const name = document.createElement("strong");
      name.textContent = t.name;

      const beschreibung = document.createElement("span");
      beschreibung.textContent = t.beschreibung;

      const fort = document.createElement("span");
      fort.className = "t-fort";
      fort.textContent = beantwortet.length
        ? `${beantwortet.length}/${fragen.length} beantwortet · Ø ${schnitt.toFixed(1)}`
        : `${fragen.length} Übungsfragen`;

      karte.append(icon, name, beschreibung, fort);
      return karte;
    }),
  );
}

function waehleThema(id) {
  state.thema = id;
  state.fragen = state.katalog.fragen.filter((f) => f.thema === id);
  state.index = Math.max(
    0,
    state.fragen.findIndex((f) => !state.ergebnisse.has(f.id)),
  );
  rendereThemen();
  $("uebungKarte").hidden = false;
  zeigeFrage();
  $("uebungKarte").scrollIntoView({ behavior: "smooth", block: "start" });
}

// -------------------------------------------------------------- Frage

function aktuelleFrage() {
  return state.fragen[state.index];
}

function zeigeFrage() {
  const f = aktuelleFrage();
  if (!f) return;

  stoppeAufnahme();
  Sprache.stopp();
  zeigeFehler($("uFehler"), "");

  const thema = state.katalog.themen.find((t) => t.id === state.thema);
  $("uThema").textContent = `${thema.icon} ${thema.name}`;
  $("uNummer").textContent = `Frage ${state.index + 1} von ${state.fragen.length}`;
  $("uFrage").textContent = f.frage;

  const eintrag = state.ergebnisse.get(f.id);
  $("uAntwort").value = eintrag?.antwort || "";
  zaehleWoerter();

  $("uMusterBox").hidden = true;
  if (eintrag?.bewertung) zeigeErgebnis(eintrag.bewertung, eintrag.model, eintrag.zeit, false);
  else $("uErgebnis").hidden = true;
}

function blaettern(schritt) {
  state.index = (state.index + schritt + state.fragen.length) % state.fragen.length;
  zeigeFrage();
}

function zeigeMuster() {
  const f = aktuelleFrage();
  const box = $("uMusterBox");
  if (!box.hidden) {
    box.hidden = true;
    return;
  }
  fuelleListe($("uMusterListe"), f.stichworte);
  $("uMusterFalle").hidden = !f.antwortfalle;
  $("uMusterFalle").textContent = f.antwortfalle ? `Antwortfalle: ${f.antwortfalle}` : "";
  box.hidden = false;
}

// ----------------------------------------------------------- Bewertung

async function bewerten() {
  const f = aktuelleFrage();
  const antwort = $("uAntwort").value.trim();
  zeigeFehler($("uFehler"), "");

  if (!antwort) return zeigeFehler($("uFehler"), "Schreibe oder diktiere zuerst eine Antwort.");
  if (state.laeuft) return;

  stoppeAufnahme();
  state.laeuft = true;
  $("uBtnEval").disabled = true;
  $("uBtnEval").textContent = "Wird bewertet …";

  try {
    const daten = await api("/api/evaluate", {
      methode: "POST",
      daten: { questionId: f.id, antwort, model: state.profil?.standardmodell },
    });
    state.ergebnisse.set(f.id, {
      frageId: f.id,
      punkte: daten.bewertung.punkte,
      antwort,
      bewertung: daten.bewertung,
      model: daten.model,
      zeit: daten.zeit,
    });
    zeigeErgebnis(daten.bewertung, daten.model, daten.zeit, state.profil?.autoVorlesen);
    rendereThemen();
  } catch (err) {
    zeigeFehler($("uFehler"), err.code === "kein_schluessel" ? `${err.message}` : err.message);
  } finally {
    state.laeuft = false;
    $("uBtnEval").disabled = false;
    $("uBtnEval").textContent = "Antwort bewerten";
  }
}

const BAR_LABELS = {
  inhaltliche_abdeckung: ["Inhaltliche Abdeckung", 4],
  fachliche_korrektheit: ["Fachliche Korrektheit", 2],
  struktur_und_begruendung: ["Struktur & Begründung", 2],
  praxisbezug_und_kontrolle: ["Praxisbezug & Kontrolle", 2],
};

function zeigeErgebnis(b, model, zeit, vorlesen) {
  $("uPunkte").textContent = b.punkte;

  const bars = $("uBars");
  bars.replaceChildren();
  for (const [key, [label, max]] of Object.entries(BAR_LABELS)) {
    const wert = b.teilpunkte?.[key] ?? 0;
    const row = document.createElement("div");
    row.className = "bar-row";
    const name = document.createElement("span");
    name.textContent = label;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${(wert / max) * 100}%`;
    track.append(fill);
    const val = document.createElement("em");
    val.textContent = `${wert}/${max}`;
    row.append(name, track, val);
    bars.append(row);
  }

  $("uUrteil").textContent = b.kurzurteil;
  fuelleListe($("uGood"), b.getroffene_aspekte, "–");
  fuelleListe($("uMiss"), b.fehlende_aspekte, "Nichts Wesentliches");
  fuelleListe($("uRisk"), b.fehler_oder_risiken, "Keine");
  $("uMusterKompakt").textContent = b.musterantwort_kompakt;
  $("uMeta").textContent = `Bewertet mit ${model || "Claude"}${zeit ? " · " + datumLang(zeit) : ""}`;
  $("uErgebnis").hidden = false;

  state.letzteBewertung = b;
  if (vorlesen && Sprache.verfuegbar) Sprache.sprich(bewertungAlsText(b), $("uBtnVorlesen"));
}

// ------------------------------------------------------- Freie Frage

async function freieFrageStellen() {
  const frage = $("freieFrage").value.trim();
  zeigeFehler($("fragenFehler"), "");
  if (!frage) return zeigeFehler($("fragenFehler"), "Bitte zuerst eine Frage eingeben.");

  $("btnFragen").disabled = true;
  $("btnFragen").textContent = "Denkt nach …";

  try {
    const thema = state.katalog.themen.find((t) => t.id === state.thema);
    const { erklaerung, model } = await api("/api/wissen/frage", {
      methode: "POST",
      daten: { frage, thema: thema?.name || "", model: state.profil?.standardmodell },
    });

    $("eKurz").textContent = erklaerung.kurzantwort;
    fuelleListe($("eKern"), erklaerung.kernpunkte);

    $("eRechtBox").hidden = !erklaerung.rechtsgrundlagen.length;
    $("eRecht").replaceChildren(
      ...erklaerung.rechtsgrundlagen.map((r) => {
        const s = document.createElement("span");
        s.textContent = r;
        return s;
      }),
    );

    $("eBeispielBox").hidden = !erklaerung.praxisbeispiel;
    $("eBeispiel").textContent = erklaerung.praxisbeispiel;
    $("eTippBox").hidden = !erklaerung.pruefungstipp;
    $("eTipp").textContent = erklaerung.pruefungstipp;
    $("eUnsicher").hidden = !erklaerung.unsicherheit;
    $("eUnsicher").textContent = erklaerung.unsicherheit ? `⚠ ${erklaerung.unsicherheit}` : "";
    $("eMeta").textContent = `Beantwortet mit ${model}`;

    $("antwortBox").hidden = false;
    state.letzteErklaerung = erklaerung;

    if (state.profil?.autoVorlesen && Sprache.verfuegbar) {
      Sprache.sprich(erklaerungAlsText(erklaerung), $("btnAntwortVorlesen"));
      $("btnAntwortStopp").hidden = false;
    }
  } catch (err) {
    zeigeFehler($("fragenFehler"), err.message);
  } finally {
    $("btnFragen").disabled = false;
    $("btnFragen").textContent = "Fragen";
  }
}

// -------------------------------------------------------- Mikrofone

// Zwei Eingabefelder koennen diktiert werden: Uebungsantwort und freie Frage.
let erkennung = null;
let ziel = null;
let basisText = "";

function initMikrofone() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $("uBtnMic").disabled = true;
    $("btnFragenMic").disabled = true;
    $("uMicHint").textContent = "Diktat braucht Chrome oder Edge";
    return;
  }

  erkennung = new SR();
  erkennung.lang = "de-DE";
  erkennung.continuous = true;
  erkennung.interimResults = true;

  erkennung.addEventListener("result", (ev) => {
    if (!ziel) return;
    let endgueltig = "";
    let vorlaeufig = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) endgueltig += t + " ";
      else vorlaeufig += t;
    }
    if (endgueltig) basisText = (basisText + " " + endgueltig).replace(/\s+/g, " ").trim();
    ziel.feld.value = (basisText + (vorlaeufig ? " " + vorlaeufig : "")).trim();
    if (ziel.id === "uebung") zaehleWoerter();
  });

  erkennung.addEventListener("error", () => stoppeAufnahme());
  erkennung.addEventListener("end", () => {
    if (ziel) {
      try {
        erkennung.start();
      } catch {
        stoppeAufnahme();
      }
    }
  });
}

function starteAufnahme(id, feld, taste) {
  if (!erkennung) return;
  if (ziel) return stoppeAufnahme();
  Sprache.stopp();
  ziel = { id, feld, taste };
  basisText = feld.value.trim();
  try {
    erkennung.start();
  } catch {
    ziel = null;
    return;
  }
  taste.classList.add("recording");
  if (id === "uebung") {
    $("uMicLabel").textContent = "Stoppen";
    $("uMicHint").textContent = "Ich höre zu …";
  }
}

function stoppeAufnahme() {
  if (!erkennung || !ziel) return;
  const alt = ziel;
  ziel = null;
  try {
    erkennung.stop();
  } catch {
    /* war nicht aktiv */
  }
  alt.taste.classList.remove("recording");
  $("uMicLabel").textContent = "Diktieren";
  $("uMicHint").textContent = "";
}

// -------------------------------------------------------------- UI

function zaehleWoerter() {
  const w = $("uAntwort").value.trim().split(/\s+/).filter(Boolean).length;
  $("uWoerter").textContent = `${w} ${w === 1 ? "Wort" : "Wörter"}`;
}

function verdrahteUI() {
  $("btnVoriges").addEventListener("click", () => blaettern(-1));
  $("btnNaechstes").addEventListener("click", () => blaettern(1));
  $("uBtnMuster").addEventListener("click", zeigeMuster);
  $("uBtnEval").addEventListener("click", bewerten);
  $("uAntwort").addEventListener("input", zaehleWoerter);
  $("uAntwort").addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") bewerten();
  });

  $("uBtnMic").addEventListener("click", () => starteAufnahme("uebung", $("uAntwort"), $("uBtnMic")));
  $("btnFragenMic").addEventListener("click", () => starteAufnahme("frage", $("freieFrage"), $("btnFragenMic")));

  $("uBtnVorlesen").addEventListener("click", () => {
    if (state.letzteBewertung) Sprache.sprich(bewertungAlsText(state.letzteBewertung), $("uBtnVorlesen"));
  });

  $("btnFragen").addEventListener("click", freieFrageStellen);
  $("freieFrage").addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") freieFrageStellen();
  });

  $("btnAntwortVorlesen").addEventListener("click", () => {
    if (!state.letzteErklaerung) return;
    Sprache.sprich(erklaerungAlsText(state.letzteErklaerung), $("btnAntwortVorlesen"));
    $("btnAntwortStopp").hidden = false;
  });
  $("btnAntwortStopp").addEventListener("click", () => {
    Sprache.stopp();
    $("btnAntwortStopp").hidden = true;
  });
}

init();
