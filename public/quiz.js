/* Prüfungsquiz: Fragen navigieren, Antwort tippen oder diktieren,
   vom Server bewerten lassen, Feedback anzeigen und vorlesen. */

import {
  $,
  api,
  renderNav,
  starteLernuhr,
  Sprache,
  bewertungAlsText,
  dauer,
  datumLang,
  zeigeFehler,
  fuelleListe,
} from "./common.js";

const state = {
  fragen: [],
  gefiltert: [],
  ergebnisse: new Map(), // frageId -> letztes Ergebnis
  aktuellId: null,
  nurOffene: false,
  laeuft: false,
  eingabe: "tastatur",
  profil: null,
};

// ------------------------------------------------------------------ Setup

async function init() {
  renderNav("quiz", { titel: "Prüfungsquiz", untertitel: "Antwort geben, bewerten lassen, Lücken schließen" });
  starteLernuhr();

  const [katalog, wissen, statistik] = await Promise.all([
    api("/api/questions"),
    api("/api/wissen"),
    api("/api/statistik?tage=30").catch(() => null),
  ]);

  state.fragen = [...katalog.fragen, ...wissen.fragen];
  state.profil = statistik?.profil || null;

  for (const e of statistik ? await ergebnisseLaden() : []) state.ergebnisse.set(e.frageId, e);

  fuelleModelle();
  fuelleFilter();
  wendeUrlFilterAn();
  filtereListe();

  const startId = new URL(location.href).searchParams.get("frage");
  zeigeFrage(state.fragen.some((f) => f.id === startId) ? startId : naechsteOffeneId());

  aktualisiereStats(statistik?.uebersicht);
  initMikrofon();
  initSprache();
  verdrahteUI();
}

async function ergebnisseLaden() {
  const { ergebnisse } = await api("/api/ergebnisse").catch(() => ({ ergebnisse: [] }));
  return ergebnisse;
}

function fuelleModelle() {
  const sel = $("modelSelect");
  const modelle = [
    { id: "claude-opus-5", name: "Opus 5 – strengste Bewertung" },
    { id: "claude-sonnet-5", name: "Sonnet 5 – guter Kompromiss" },
    { id: "claude-haiku-4-5", name: "Haiku 4.5 – schnell und günstig" },
    { id: "claude-opus-4-8", name: "Opus 4.8" },
    { id: "claude-fable-5-1", name: "Fable 5.1 – stärkstes Modell" },
  ];
  sel.replaceChildren();
  for (const m of modelle) {
    const opt = new Option(m.id, m.id);
    opt.title = m.name;
    sel.append(opt);
  }
  const standard = state.profil?.standardmodell || "claude-sonnet-5";
  if (!modelle.some((m) => m.id === standard)) sel.append(new Option(standard, standard));
  sel.value = standard;
}

function fuelleFilter() {
  const sel = $("filterBereich");
  for (const b of [...new Set(state.fragen.map((f) => f.bereich))]) sel.append(new Option(b, b));
  fuelleKategorien();
}

function fuelleKategorien() {
  const bereich = $("filterBereich").value;
  const kategorien = [...new Set(state.fragen.filter((f) => !bereich || f.bereich === bereich).map((f) => f.kategorie))];
  const sel = $("filterKategorie");
  const vorher = sel.value;
  sel.replaceChildren(new Option("Alle Kategorien", ""));
  for (const k of kategorien) sel.append(new Option(k, k));
  if (kategorien.includes(vorher)) sel.value = vorher;
}

// Aufrufe aus Schwachstellen- oder Wissensseite: ?bereich=…&kategorie=…&nuroffene=1
function wendeUrlFilterAn() {
  const p = new URL(location.href).searchParams;
  const bereich = p.get("bereich");
  const kategorie = p.get("kategorie");
  if (bereich && [...$("filterBereich").options].some((o) => o.value === bereich)) {
    $("filterBereich").value = bereich;
    fuelleKategorien();
  }
  if (kategorie && [...$("filterKategorie").options].some((o) => o.value === kategorie)) {
    $("filterKategorie").value = kategorie;
  }
  if (p.get("nuroffene") === "1") {
    state.nurOffene = true;
    $("btnOpen").textContent = "Alle zeigen";
  }
  if (p.get("schwach") === "1") state.nurSchwach = true;
}

// ------------------------------------------------------------------ Liste

function filtereListe() {
  const bereich = $("filterBereich").value;
  const kategorie = $("filterKategorie").value;
  const suche = $("filterSuche").value.trim().toLowerCase();

  state.gefiltert = state.fragen.filter((f) => {
    if (bereich && f.bereich !== bereich) return false;
    if (kategorie && f.kategorie !== kategorie) return false;
    if (state.nurOffene && state.ergebnisse.has(f.id)) return false;
    if (state.nurSchwach && (state.ergebnisse.get(f.id)?.punkte ?? 99) >= 6) return false;
    if (suche) {
      const heu = `${f.frage} ${f.kategorie} ${f.stichworte.join(" ")}`.toLowerCase();
      if (!heu.includes(suche)) return false;
    }
    return true;
  });

  rendereListe();
}

function rendereListe() {
  const liste = $("questionList");
  liste.replaceChildren();

  for (const f of state.gefiltert) {
    const li = document.createElement("li");
    li.dataset.id = f.id;
    if (f.id === state.aktuellId) li.classList.add("active");

    const nr = document.createElement("span");
    nr.className = "ql-nr";
    nr.textContent = kurzId(f);

    const text = document.createElement("span");
    text.className = "ql-text";
    text.textContent = f.frage;
    text.title = f.frage;

    li.append(nr, text);

    const eintrag = state.ergebnisse.get(f.id);
    if (eintrag) {
      const score = document.createElement("span");
      score.className = `ql-score ${eintrag.punkte >= 8 ? "s-good" : eintrag.punkte >= 6 ? "s-mid" : "s-bad"}`;
      score.textContent = eintrag.punkte;
      li.append(score);
    }

    li.addEventListener("click", () => zeigeFrage(f.id));
    liste.append(li);
  }

  if (!state.gefiltert.length) {
    const li = document.createElement("li");
    li.textContent = "Keine Frage passt zum Filter.";
    liste.append(li);
  }

  const aktiv = liste.querySelector("li.active");
  if (aktiv) {
    const oben = aktiv.offsetTop;
    if (oben < liste.scrollTop || oben + aktiv.offsetHeight > liste.scrollTop + liste.clientHeight) {
      liste.scrollTop = oben - liste.clientHeight / 2 + aktiv.offsetHeight / 2;
    }
  }
}

function kurzId(f) {
  const praefix = {
    Fragenkatalog: "K",
    Fachgesprächsfälle: "F",
    "Fachgespräch zur praktischen Durchführung": "P",
    Wissensbereich: "W",
  };
  return `${praefix[f.bereich] || "?"}${f.nr}`;
}

function naechsteOffeneId() {
  return (state.gefiltert.find((f) => !state.ergebnisse.has(f.id)) || state.gefiltert[0])?.id;
}

// ------------------------------------------------------------------ Frage

function zeigeFrage(id) {
  const frage = state.fragen.find((f) => f.id === id);
  if (!frage) return;

  stoppeAufnahme();
  Sprache.stopp();
  state.aktuellId = id;
  state.eingabe = "tastatur";
  zeigeFehler($("fehler"), "");

  $("qBereich").textContent = frage.bereich;
  $("qKategorie").textContent = frage.kategorie;
  $("qText").textContent = frage.frage;

  const pos = state.gefiltert.findIndex((f) => f.id === id);
  $("qCounter").textContent = pos >= 0 ? `${pos + 1} / ${state.gefiltert.length}` : kurzId(frage);

  $("qKontextBox").hidden = !frage.kontext;
  $("qKontext").textContent = frage.kontext || "";

  const eintrag = state.ergebnisse.get(id);
  $("antwort").value = eintrag?.antwort || "";
  zaehleWoerter();

  $("musterCard").hidden = true;
  if (eintrag?.bewertung) zeigeErgebnis(eintrag.bewertung, eintrag.model, eintrag.zeit, false);
  else $("resultCard").hidden = true;

  rendereListe();
}

function naechsteFrage() {
  const pos = state.gefiltert.findIndex((f) => f.id === state.aktuellId);
  const next = state.gefiltert[(pos + 1) % Math.max(state.gefiltert.length, 1)];
  if (next) zeigeFrage(next.id);
}

function zufallsFrage() {
  const pool = state.gefiltert.length ? state.gefiltert : state.fragen;
  const kandidaten = pool.filter((f) => f.id !== state.aktuellId);
  const f = kandidaten[Math.floor(Math.random() * kandidaten.length)] || pool[0];
  if (f) zeigeFrage(f.id);
}

function zeigeMusterantwort() {
  const frage = state.fragen.find((f) => f.id === state.aktuellId);
  if (!frage) return;

  const karte = $("musterCard");
  if (!karte.hidden) {
    karte.hidden = true;
    return;
  }

  fuelleListe($("musterListe"), frage.stichworte);
  setzeExtra("musterImpuls", frage.unterrichtsimpuls, "Unterrichtsimpuls: ");
  setzeExtra("musterBeispiel", frage.beispiel, "Beispiel: ");
  setzeExtra("musterFalle", frage.antwortfalle, "Antwortfalle: ");
  setzeExtra("musterNachfrage", frage.nachfrage, "Mögliche Nachfrage: ");
  karte.hidden = false;
  karte.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setzeExtra(id, wert, praefix) {
  const el = $(id);
  el.hidden = !wert;
  el.textContent = wert ? praefix + wert : "";
}

// --------------------------------------------------------------- Bewertung

async function bewerteAntwort() {
  const frage = state.fragen.find((f) => f.id === state.aktuellId);
  const antwort = $("antwort").value.trim();

  zeigeFehler($("fehler"), "");
  if (!frage) return;
  if (!antwort) return zeigeFehler($("fehler"), "Schreibe oder diktiere zuerst eine Antwort.");
  if (state.laeuft) return;

  stoppeAufnahme();
  state.laeuft = true;
  $("btnEval").disabled = true;
  $("btnEval").textContent = "Wird bewertet …";

  try {
    const daten = await api("/api/evaluate", {
      methode: "POST",
      daten: {
        questionId: frage.id,
        antwort,
        model: $("modelSelect").value,
        eingabe: state.eingabe,
      },
    });

    state.ergebnisse.set(frage.id, {
      frageId: frage.id,
      punkte: daten.bewertung.punkte,
      antwort,
      bewertung: daten.bewertung,
      model: daten.model,
      zeit: daten.zeit,
    });

    zeigeErgebnis(daten.bewertung, daten.model, daten.zeit, state.profil?.autoVorlesen);
    rendereListe();
    api("/api/statistik?tage=7")
      .then((s) => aktualisiereStats(s.uebersicht))
      .catch(() => {});
  } catch (err) {
    zeigeFehler(
      $("fehler"),
      err.code === "kein_schluessel"
        ? `${err.message} → Profil öffnen und Claude-Schlüssel hinterlegen.`
        : err.message,
    );
  } finally {
    state.laeuft = false;
    $("btnEval").disabled = false;
    $("btnEval").textContent = "Antwort bewerten";
  }
}

const BAR_LABELS = {
  inhaltliche_abdeckung: ["Inhaltliche Abdeckung", 4],
  fachliche_korrektheit: ["Fachliche Korrektheit", 2],
  struktur_und_begruendung: ["Struktur & Begründung", 2],
  praxisbezug_und_kontrolle: ["Praxisbezug & Kontrolle", 2],
};

function zeigeErgebnis(b, model, zeit, vorlesen) {
  $("resPoints").textContent = b.punkte;

  const bars = $("resBars");
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

  $("resVerdict").textContent = b.kurzurteil;
  fuelleListe($("resGood"), b.getroffene_aspekte, "–");
  fuelleListe($("resMiss"), b.fehlende_aspekte, "Nichts Wesentliches");
  fuelleListe($("resRisk"), b.fehler_oder_risiken, "Keine");
  $("resModel").textContent = b.musterantwort_kompakt;
  $("resNext").textContent = b.naechster_lernschritt;
  $("resMeta").textContent = `Bewertet mit ${model || "Claude"}${zeit ? " · " + datumLang(zeit) : ""}`;

  $("resultCard").hidden = false;
  state.letzteBewertung = b;

  if (vorlesen && Sprache.verfuegbar) starteVorlesen();
}

function aktualisiereStats(u) {
  if (!u) return;
  $("statAnswered").textContent = `${u.beantwortet} / ${u.fragenGesamt}`;
  $("statWeak").textContent = u.schwach;
  $("statHeute").textContent = dauer(u.lernzeitHeute);
  $("avgScore").textContent = u.beantwortet ? u.schnitt.toFixed(1) : "–";
  $("scoreRing").style.setProperty("--pct", String(Math.round((u.schnitt || 0) * 10)));
}

// -------------------------------------------------------------- Vorlesen

async function initSprache() {
  if (!Sprache.verfuegbar) {
    $("btnVorlesen").disabled = true;
    $("btnVorlesen").title = "Dieser Browser kann keine Sprachausgabe.";
    return;
  }
  await Sprache.laden();
  Sprache.konfigurieren({ stimme: state.profil?.stimme, tempo: state.profil?.sprechtempo });
}

function starteVorlesen() {
  if (!state.letzteBewertung) return;
  Sprache.sprich(bewertungAlsText(state.letzteBewertung), $("btnVorlesen"));
  $("btnStopp").hidden = false;
}

// -------------------------------------------------------------- Mikrofon

let erkennung = null;
let nimmtAuf = false;
let basisText = "";

function initMikrofon() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $("btnMic").disabled = true;
    $("micHint").textContent = "Diktat braucht Chrome oder Edge";
    return;
  }

  erkennung = new SR();
  erkennung.lang = "de-DE";
  erkennung.continuous = true;
  erkennung.interimResults = true;

  erkennung.addEventListener("result", (ev) => {
    let endgueltig = "";
    let vorlaeufig = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) endgueltig += t + " ";
      else vorlaeufig += t;
    }
    if (endgueltig) basisText = (basisText + " " + endgueltig).replace(/\s+/g, " ").trim();
    $("antwort").value = (basisText + (vorlaeufig ? " " + vorlaeufig : "")).trim();
    state.eingabe = "mikrofon";
    zaehleWoerter();
  });

  erkennung.addEventListener("error", (ev) => {
    const texte = {
      "not-allowed": "Mikrofon-Zugriff wurde blockiert. Bitte im Browser erlauben.",
      "service-not-allowed": "Mikrofon-Zugriff wurde blockiert. Bitte im Browser erlauben.",
      "no-speech": "Nichts gehört – bitte erneut versuchen.",
      "audio-capture": "Kein Mikrofon gefunden.",
      network: "Die Spracherkennung ist offline nicht verfügbar.",
    };
    zeigeFehler($("fehler"), texte[ev.error] || `Spracherkennung: ${ev.error}`);
    stoppeAufnahme();
  });

  erkennung.addEventListener("end", () => {
    if (nimmtAuf) {
      try {
        erkennung.start();
      } catch {
        stoppeAufnahme();
      }
    }
  });
}

function starteAufnahme() {
  if (!erkennung || nimmtAuf) return;
  Sprache.stopp();
  basisText = $("antwort").value.trim();
  nimmtAuf = true;
  try {
    erkennung.start();
  } catch {
    nimmtAuf = false;
    return;
  }
  $("btnMic").classList.add("recording");
  $("micLabel").textContent = "Aufnahme stoppen";
  $("antwort").classList.add("listening");
  $("micHint").textContent = "Ich höre zu …";
  zeigeFehler($("fehler"), "");
}

function stoppeAufnahme() {
  if (!erkennung) return;
  const warAktiv = nimmtAuf;
  nimmtAuf = false;
  try {
    erkennung.stop();
  } catch {
    /* war nicht aktiv */
  }
  $("btnMic").classList.remove("recording");
  $("micLabel").textContent = "Diktieren";
  $("antwort").classList.remove("listening");
  if (warAktiv) $("micHint").textContent = "";
}

// ------------------------------------------------------------------- UI

function zaehleWoerter() {
  const w = $("antwort").value.trim().split(/\s+/).filter(Boolean).length;
  $("wordCount").textContent = `${w} ${w === 1 ? "Wort" : "Wörter"}`;
}

function verdrahteUI() {
  $("filterBereich").addEventListener("change", () => {
    fuelleKategorien();
    filtereListe();
  });
  $("filterKategorie").addEventListener("change", filtereListe);
  $("filterSuche").addEventListener("input", filtereListe);

  $("btnOpen").addEventListener("click", () => {
    state.nurOffene = !state.nurOffene;
    state.nurSchwach = false;
    $("btnOpen").textContent = state.nurOffene ? "Alle zeigen" : "Nur offene";
    filtereListe();
  });

  $("btnRandom").addEventListener("click", zufallsFrage);
  $("btnNext").addEventListener("click", naechsteFrage);
  $("btnMuster").addEventListener("click", zeigeMusterantwort);
  $("btnEval").addEventListener("click", bewerteAntwort);
  $("btnMic").addEventListener("click", () => (nimmtAuf ? stoppeAufnahme() : starteAufnahme()));

  $("btnVorlesen").addEventListener("click", starteVorlesen);
  $("btnStopp").addEventListener("click", () => {
    Sprache.stopp();
    $("btnStopp").hidden = true;
  });

  $("modelSelect").addEventListener("change", () => {
    api("/api/profil", { methode: "PUT", daten: { standardmodell: $("modelSelect").value } }).catch(() => {});
  });

  $("antwort").addEventListener("input", () => {
    zaehleWoerter();
    if (!nimmtAuf) basisText = $("antwort").value.trim();
  });

  $("antwort").addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") bewerteAntwort();
  });
}

init();
