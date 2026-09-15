/* Profil: persönliche Angaben, Stimme fürs Vorlesen, API-Schlüssel in der .env,
   Lernzeit als Balkendiagramm und Jahresübersicht. */

import { $, api, renderNav, starteLernuhr, Sprache, dauer, datumKurz, zeigeFehler } from "./common.js";

let tage = 30;
let profil = null;

async function init() {
  renderNav("profil", { titel: "Profil", untertitel: "Einstellungen, Schlüssel und Lernzeit" });
  starteLernuhr();

  await ladeProfil();
  await ladeSchluessel();
  await ladeDiagramme();
  await initStimmen();

  $("zeitraum").addEventListener("click", (ev) => {
    const taste = ev.target.closest("button");
    if (!taste) return;
    tage = Number(taste.dataset.tage);
    for (const b of $("zeitraum").querySelectorAll("button")) b.classList.toggle("active", b === taste);
    ladeDiagramme();
  });

  verdrahteUI();
}

// ------------------------------------------------------------- Profil

async function ladeProfil() {
  const daten = await api("/api/profil");
  profil = daten.profil;

  $("pName").value = profil.name || "";
  $("pTermin").value = profil.pruefungstermin || "";
  $("pZiel").value = profil.tagesziel ?? 30;
  $("pTempo").value = profil.sprechtempo ?? 1;
  $("pTempoWert").textContent = Number(profil.sprechtempo ?? 1).toFixed(1);
  $("pAuto").checked = Boolean(profil.autoVorlesen);

  const sel = $("pModell");
  sel.replaceChildren();
  for (const m of daten.modelle) {
    const opt = new Option(m.id, m.id);
    opt.title = m.name;
    sel.append(opt);
  }
  if (!daten.modelle.some((m) => m.id === profil.standardmodell)) {
    sel.append(new Option(profil.standardmodell, profil.standardmodell));
  }
  sel.value = profil.standardmodell;
  $("pModellInfo").textContent = daten.modelle.find((m) => m.id === sel.value)?.name || "";
  sel.addEventListener("change", () => {
    $("pModellInfo").textContent = daten.modelle.find((m) => m.id === sel.value)?.name || "";
  });

  zeigeKacheln(daten.uebersicht);
}

function zeigeKacheln(u) {
  const kacheln = [
    { wert: dauer(u.lernzeitGesamt), label: "Lernzeit gesamt", klein: `an ${u.lerntage} Tagen` },
    { wert: dauer(u.lernzeitHeute), label: "heute", klein: `Ziel ${profil.tagesziel} min` },
    { wert: `${u.beantwortet}/${u.fragenGesamt}`, label: "Fragen beantwortet", klein: `${u.versucheGesamt} Versuche` },
    { wert: u.beantwortet ? u.schnitt.toFixed(1) : "–", label: "Ø Punkte", klein: `${u.stark} ab 8 Punkten` },
    { wert: String(u.serie), label: "Tage in Folge", klein: u.serie > 2 ? "dranbleiben" : "Serie aufbauen" },
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

async function speichereProfil() {
  const daten = {
    name: $("pName").value.trim(),
    pruefungstermin: $("pTermin").value,
    tagesziel: Number($("pZiel").value),
    standardmodell: $("pModell").value,
    stimme: $("pStimme").value,
    sprechtempo: Number($("pTempo").value),
    autoVorlesen: $("pAuto").checked,
  };
  const antwort = await api("/api/profil", { methode: "PUT", daten });
  profil = antwort.profil;
  Sprache.konfigurieren({ stimme: profil.stimme, tempo: profil.sprechtempo });

  const ok = $("profilOk");
  ok.hidden = false;
  ok.textContent = "Gespeichert.";
  setTimeout(() => (ok.hidden = true), 2500);
  ladeDiagramme();
}

// ---------------------------------------------------------- Schlüssel

async function ladeSchluessel() {
  const daten = await api("/api/keys");
  $("envPfad").textContent = daten.datei;

  $("keyListe").replaceChildren(
    ...daten.schluessel.map((k) => {
      const box = document.createElement("div");
      box.className = "key-eintrag";

      const kopf = document.createElement("div");
      kopf.className = "key-kopf";
      const name = document.createElement("strong");
      name.textContent = k.label;
      const status = document.createElement("span");
      status.className = `key-status${k.gesetzt ? " ok" : ""}`;
      status.textContent = k.gesetzt ? `aktiv · ${k.quelle}` : "nicht hinterlegt";
      kopf.append(name, status);

      const wert = document.createElement("div");
      wert.className = "key-wert";
      wert.id = `keyWert-${k.id}`;
      wert.textContent = k.gesetzt ? k.maskiert : "— kein Schlüssel hinterlegt —";

      const tasten = document.createElement("div");
      tasten.className = "key-tasten";

      if (k.gesetzt) {
        const zeigen = document.createElement("button");
        zeigen.className = "btn ghost";
        zeigen.type = "button";
        zeigen.textContent = "👁 Klartext anzeigen";
        zeigen.addEventListener("click", () => schluesselAnzeigen(k, wert, zeigen));

        const loeschen = document.createElement("button");
        loeschen.className = "btn danger-ghost";
        loeschen.type = "button";
        loeschen.textContent = "Entfernen";
        loeschen.addEventListener("click", () => schluesselLoeschen(k));

        tasten.append(zeigen, loeschen);
      }

      box.append(kopf, wert, tasten);
      return box;
    }),
  );
}

async function schluesselAnzeigen(k, wertEl, taste) {
  if (wertEl.classList.contains("klartext")) {
    wertEl.classList.remove("klartext");
    wertEl.textContent = k.maskiert;
    taste.textContent = "👁 Klartext anzeigen";
    return;
  }
  if (!confirm("Der vollständige Schlüssel wird im Klartext angezeigt. Schaut jemand mit auf den Bildschirm?")) return;

  const { schluessel } = await api("/api/keys/anzeigen", { methode: "POST", daten: { anbieter: k.id } });
  wertEl.classList.add("klartext");
  wertEl.textContent = schluessel;
  taste.textContent = "Verbergen";
}

async function schluesselLoeschen(k) {
  if (!confirm(`${k.label}-Schlüssel wirklich aus der .env entfernen?`)) return;
  await api("/api/keys", { methode: "PUT", daten: { anbieter: k.id, schluessel: "" } });
  await ladeSchluessel();
}

async function schluesselSpeichern() {
  const wert = $("neuerKey").value.trim();
  zeigeFehler($("keyFehler"), "");
  $("keyOk").hidden = true;

  if (!wert) return zeigeFehler($("keyFehler"), "Bitte einen Schlüssel eingeben.");

  try {
    await api("/api/keys", { methode: "PUT", daten: { anbieter: "anthropic", schluessel: wert } });
    $("neuerKey").value = "";
    await ladeSchluessel();
    $("keyOk").hidden = false;
    $("keyOk").textContent = "Schlüssel gespeichert. Jetzt am besten kurz die Verbindung testen.";
  } catch (err) {
    zeigeFehler($("keyFehler"), err.message);
  }
}

async function verbindungTesten() {
  zeigeFehler($("keyFehler"), "");
  $("keyOk").hidden = true;
  $("btnKeyTesten").disabled = true;
  $("btnKeyTesten").textContent = "Teste …";

  try {
    const { modelle } = await api("/api/models");
    $("keyOk").hidden = false;
    $("keyOk").textContent = `Verbindung steht. ${modelle.length} Modelle verfügbar, darunter ${modelle
      .filter((m) => m.empfohlen)
      .slice(0, 3)
      .map((m) => m.id)
      .join(", ")}.`;
  } catch (err) {
    zeigeFehler($("keyFehler"), err.message);
  } finally {
    $("btnKeyTesten").disabled = false;
    $("btnKeyTesten").textContent = "Verbindung testen";
  }
}

// ------------------------------------------------------------ Stimmen

async function initStimmen() {
  const sel = $("pStimme");
  if (!Sprache.verfuegbar) {
    sel.replaceChildren(new Option("Dieser Browser kann keine Sprachausgabe", ""));
    sel.disabled = true;
    $("btnProbe").disabled = true;
    $("pStimmeInfo").textContent = "Vorlesen funktioniert in Chrome, Edge, Safari und auf dem Handy.";
    return;
  }

  const stimmen = await Sprache.laden();
  sel.replaceChildren(new Option("Standardstimme des Systems", ""));
  for (const s of stimmen) sel.append(new Option(`${s.name} (${s.lang})`, s.name));
  sel.value = stimmen.some((s) => s.name === profil.stimme) ? profil.stimme : "";

  const deutsche = stimmen.filter((s) => s.lang.toLowerCase().startsWith("de")).length;
  $("pStimmeInfo").textContent = `${stimmen.length} Stimmen gefunden${deutsche ? `, davon ${deutsche} deutsche` : ""}. Auf dem Handy startet die Ausgabe erst nach einem Tippen.`;

  Sprache.konfigurieren({ stimme: profil.stimme, tempo: profil.sprechtempo });
}

function stimmprobe() {
  Sprache.konfigurieren({ stimme: $("pStimme").value, tempo: Number($("pTempo").value) });
  Sprache.sprich(
    "Du hast 8 von 10 Punkten erreicht. Deine Begründung war klar strukturiert, es fehlte aber die Erfolgskontrolle.",
    $("btnProbe"),
  );
}

// --------------------------------------------------------- Diagramme

const SVG = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}, text) => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
};

async function ladeDiagramme() {
  const daten = await api(`/api/statistik?tage=${tage}`);
  zeichneLernzeit(daten.reihe, daten.profil?.tagesziel || 0);
  const jahr = await api("/api/statistik?tage=365");
  zeichneHeatmap(jahr.reihe);
  zeigeKacheln(daten.uebersicht);
  $("datenInfo").textContent = `${daten.uebersicht.versucheGesamt} gespeicherte Bewertungen, ${daten.uebersicht.lerntage} Lerntage, insgesamt ${dauer(
    daten.uebersicht.lernzeitGesamt,
  )} Lernzeit.`;
}

function zeichneLernzeit(reihe, ziel) {
  const B = 900;
  const H = 210;
  const rand = { oben: 16, unten: 28, links: 46, rechts: 16 };
  const breite = B - rand.links - rand.rechts;
  const hoehe = H - rand.oben - rand.unten;

  const svg = el("svg", { viewBox: `0 0 ${B} ${H}`, role: "img" });
  const defs = el("defs");
  const grad = el("linearGradient", { id: "gradProfil", x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.append(el("stop", { offset: "0%", "stop-color": "#ffb224" }), el("stop", { offset: "100%", "stop-color": "#ff7a18" }));
  defs.append(grad);
  svg.append(defs);

  const maxMin = Math.max(20, ziel, ...reihe.map((t) => t.lernzeit / 60));
  const y0 = rand.oben + hoehe;

  for (let i = 0; i <= 4; i++) {
    const wert = (maxMin / 4) * i;
    const y = y0 - (wert / maxMin) * hoehe;
    svg.append(el("line", { class: "raster", x1: rand.links, y1: y, x2: rand.links + breite, y2: y }));
    svg.append(el("text", { class: "beschriftung", x: rand.links - 8, y: y + 3, "text-anchor": "end" }, `${Math.round(wert)}m`));
  }

  if (ziel > 0 && ziel <= maxMin) {
    const y = y0 - (ziel / maxMin) * hoehe;
    svg.append(el("line", { class: "ziel", x1: rand.links, y1: y, x2: rand.links + breite, y2: y }));
  }

  const schritt = breite / reihe.length;
  const bw = Math.max(3, Math.min(24, schritt * 0.64));

  reihe.forEach((t, i) => {
    const min = t.lernzeit / 60;
    const h = (min / maxMin) * hoehe;
    const rect = el("rect", {
      x: rand.links + schritt * i + (schritt - bw) / 2,
      y: y0 - Math.max(h, min ? 2 : 1),
      width: bw,
      height: Math.max(h, min ? 2 : 1),
      rx: Math.min(3, bw / 2),
      fill: min ? "url(#gradProfil)" : "#1b2029",
    });
    rect.append(el("title", {}, `${t.tag}: ${dauer(t.lernzeit)}`));
    svg.append(rect);
  });

  const jedes = Math.ceil(reihe.length / 12);
  reihe.forEach((t, i) => {
    if (i % jedes) return;
    svg.append(
      el("text", { class: "beschriftung", x: rand.links + schritt * i + schritt / 2, y: H - 8, "text-anchor": "middle" }, datumKurz(t.tag)),
    );
  });

  svg.append(el("line", { class: "achse", x1: rand.links, y1: y0, x2: rand.links + breite, y2: y0 }));
  $("chartLernzeit").replaceChildren(svg);
}

function zeichneHeatmap(reihe) {
  const box = $("heatmap");
  box.replaceChildren(
    ...reihe.map((t) => {
      const min = t.lernzeit / 60;
      const stufe = min === 0 ? 0 : min < 10 ? 1 : min < 25 ? 2 : min < 45 ? 3 : 4;
      const i = document.createElement("i");
      i.dataset.stufe = String(stufe);
      i.title = `${t.tag}: ${dauer(t.lernzeit)}${t.antworten ? `, ${t.antworten} Bewertungen` : ""}`;
      return i;
    }),
  );
}

// -------------------------------------------------------------- Daten

async function exportiere() {
  const { ergebnisse } = await api("/api/ergebnisse");
  const blob = new Blob([JSON.stringify({ profil, ergebnisse }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `aevo-trainer-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function loescheAlles() {
  if (!confirm("Alle gespeicherten Bewertungen löschen? Die Lernzeit bleibt erhalten. Das lässt sich nicht rückgängig machen.")) return;
  await api("/api/ergebnisse", { methode: "DELETE" });
  await ladeDiagramme();
  alert("Alle Bewertungen wurden gelöscht.");
}

function verdrahteUI() {
  $("btnSpeichern").addEventListener("click", speichereProfil);
  $("btnProbe").addEventListener("click", stimmprobe);
  $("pTempo").addEventListener("input", () => ($("pTempoWert").textContent = Number($("pTempo").value).toFixed(1)));
  $("btnKeySpeichern").addEventListener("click", schluesselSpeichern);
  $("neuerKey").addEventListener("keydown", (ev) => ev.key === "Enter" && schluesselSpeichern());
  $("btnKeyTesten").addEventListener("click", verbindungTesten);
  $("btnExport").addEventListener("click", exportiere);
  $("btnLoeschen").addEventListener("click", loescheAlles);
}

init();
