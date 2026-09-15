/* Fortschrittsseite: Lernzeit und Punkteentwicklung als SVG-Diagramme,
   ohne externe Bibliothek. */

import { $, api, renderNav, starteLernuhr, dauer, datumKurz, datumLang, punkteKlasse } from "./common.js";

let tage = 30;

async function init() {
  renderNav("fortschritt", { titel: "Fortschritt", untertitel: "Entwicklung von Lernzeit und Punkten" });
  starteLernuhr();

  $("zeitraum").addEventListener("click", (ev) => {
    const taste = ev.target.closest("button");
    if (!taste) return;
    tage = Number(taste.dataset.tage);
    for (const b of $("zeitraum").querySelectorAll("button")) b.classList.toggle("active", b === taste);
    laden();
  });

  laden();
}

async function laden() {
  const daten = await api(`/api/statistik?tage=${tage}`);
  const { ergebnisse } = await api("/api/ergebnisse").catch(() => ({ ergebnisse: [] }));

  zeigeKacheln(daten.uebersicht, daten.reihe, daten.profil);
  zeichneHauptdiagramm(daten.reihe, daten.profil?.tagesziel || 0);
  zeichneAntwortdiagramm(daten.reihe);
  zeigeVerbesserungen(daten.verlauf);
  zeigeLetzte(ergebnisse);
}

// ------------------------------------------------------------- Kacheln

function zeigeKacheln(u, reihe, profil) {
  const zeitraumZeit = reihe.reduce((a, t) => a + t.lernzeit, 0);
  const zeitraumAntworten = reihe.reduce((a, t) => a + t.antworten, 0);
  const aktiveTage = reihe.filter((t) => t.lernzeit > 0).length;

  const mitPunkten = reihe.filter((t) => t.schnitt !== null);
  const haelfte = Math.floor(mitPunkten.length / 2);
  const frueh = mitPunkten.slice(0, haelfte);
  const spaet = mitPunkten.slice(haelfte);
  const schnittVon = (l) => (l.length ? l.reduce((a, t) => a + t.schnitt, 0) / l.length : null);
  const trend =
    frueh.length && spaet.length ? schnittVon(spaet) - schnittVon(frueh) : null;

  const kacheln = [
    { wert: dauer(zeitraumZeit), label: `Lernzeit (${tage} Tage)`, klein: `an ${aktiveTage} aktiven Tagen` },
    { wert: zeitraumAntworten, label: "Bewertungen", klein: `${u.versucheGesamt} insgesamt` },
    {
      wert: u.beantwortet ? u.schnitt.toFixed(1) : "–",
      label: "Ø Punkte gesamt",
      klein: trend === null ? "noch kein Trend" : `Trend ${trend >= 0 ? "+" : ""}${trend.toFixed(1)} im Zeitraum`,
    },
    { wert: `${u.serie}`, label: "Tage in Folge", klein: `Tagesziel ${profil?.tagesziel || 0} min` },
    { wert: `${u.beantwortet}/${u.fragenGesamt}`, label: "Fragen abgedeckt", klein: `${u.stark} davon ab 8 Punkten` },
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

// ---------------------------------------------------------- Diagramme

const SVG = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// Balken = Lernzeit in Minuten, Linie = Punkteschnitt (rechte Achse 0-10)
function zeichneHauptdiagramm(reihe, tagesziel) {
  const B = 900;
  const H = 260;
  const rand = { oben: 18, unten: 30, links: 44, rechts: 34 };
  const breite = B - rand.links - rand.rechts;
  const hoehe = H - rand.oben - rand.unten;

  const svg = el("svg", { viewBox: `0 0 ${B} ${H}`, role: "img" });
  const defs = el("defs");
  const grad = el("linearGradient", { id: "gradGelb", x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.append(el("stop", { offset: "0%", "stop-color": "#ffb224" }), el("stop", { offset: "100%", "stop-color": "#ff7a18" }));
  defs.append(grad);
  svg.append(defs);

  const maxMin = Math.max(30, ...reihe.map((t) => t.lernzeit / 60), tagesziel);
  const skalaY = (min) => rand.oben + hoehe - (min / maxMin) * hoehe;

  // Raster und linke Achse (Minuten)
  for (let i = 0; i <= 4; i++) {
    const wert = (maxMin / 4) * i;
    const y = skalaY(wert);
    svg.append(el("line", { class: "raster", x1: rand.links, y1: y, x2: rand.links + breite, y2: y }));
    svg.append(el("text", { class: "beschriftung", x: rand.links - 8, y: y + 3, "text-anchor": "end" }, `${Math.round(wert)}m`));
  }

  // rechte Achse (Punkte)
  for (let p = 0; p <= 10; p += 5) {
    const y = rand.oben + hoehe - (p / 10) * hoehe;
    svg.append(el("text", { class: "beschriftung", x: rand.links + breite + 8, y: y + 3, fill: "#5ed39a" }, `${p}`));
  }

  if (tagesziel > 0 && tagesziel <= maxMin) {
    const y = skalaY(tagesziel);
    svg.append(el("line", { class: "ziel", x1: rand.links, y1: y, x2: rand.links + breite, y2: y }));
  }

  const schritt = breite / reihe.length;
  const balkenBreite = Math.max(2, Math.min(26, schritt * 0.62));

  reihe.forEach((t, i) => {
    const x = rand.links + schritt * i + (schritt - balkenBreite) / 2;
    const min = t.lernzeit / 60;
    const y = skalaY(min);
    const h = Math.max(min > 0 ? 2 : 0, rand.oben + hoehe - y);
    svg.append(
      el("rect", {
        x,
        y: h ? y : rand.oben + hoehe - 2,
        width: balkenBreite,
        height: h || 2,
        rx: Math.min(3, balkenBreite / 2),
        fill: h ? "url(#gradGelb)" : "#1b2029",
      }),
    );
    const titel = el("title", {}, `${t.tag}: ${dauer(t.lernzeit)}, ${t.antworten} Bewertungen${t.schnitt !== null ? `, Ø ${t.schnitt.toFixed(1)}` : ""}`);
    svg.lastChild.append(titel);
  });

  // Punktelinie
  const punkte = reihe
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.schnitt !== null)
    .map(({ t, i }) => ({
      x: rand.links + schritt * i + schritt / 2,
      y: rand.oben + hoehe - (t.schnitt / 10) * hoehe,
      t,
    }));

  if (punkte.length > 1) {
    svg.append(el("path", { class: "linie", d: punkte.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") }));
  }
  for (const p of punkte) {
    const kreis = el("circle", { class: "punkt", cx: p.x, cy: p.y, r: punkte.length > 40 ? 2 : 3.4 });
    kreis.append(el("title", {}, `${p.t.tag}: Ø ${p.t.schnitt.toFixed(1)} Punkte`));
    svg.append(kreis);
  }

  // X-Beschriftung (nur so viele Labels, wie lesbar sind)
  const jedes = Math.ceil(reihe.length / 12);
  reihe.forEach((t, i) => {
    if (i % jedes) return;
    svg.append(
      el(
        "text",
        { class: "beschriftung", x: rand.links + schritt * i + schritt / 2, y: H - 10, "text-anchor": "middle" },
        datumKurz(t.tag),
      ),
    );
  });

  svg.append(el("line", { class: "achse", x1: rand.links, y1: rand.oben + hoehe, x2: rand.links + breite, y2: rand.oben + hoehe }));
  $("chartHaupt").replaceChildren(svg);
}

function zeichneAntwortdiagramm(reihe) {
  const B = 900;
  const H = 150;
  const rand = { oben: 14, unten: 26, links: 44, rechts: 34 };
  const breite = B - rand.links - rand.rechts;
  const hoehe = H - rand.oben - rand.unten;

  const svg = el("svg", { viewBox: `0 0 ${B} ${H}`, role: "img" });
  const defs = el("defs");
  const grad = el("linearGradient", { id: "gradGelb2", x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.append(el("stop", { offset: "0%", "stop-color": "#ffb224" }), el("stop", { offset: "100%", "stop-color": "#ff7a18" }));
  defs.append(grad);
  svg.append(defs);

  const max = Math.max(4, ...reihe.map((t) => t.antworten));
  const schritt = breite / reihe.length;
  const balkenBreite = Math.max(2, Math.min(26, schritt * 0.62));

  for (let i = 0; i <= 2; i++) {
    const wert = (max / 2) * i;
    const y = rand.oben + hoehe - (wert / max) * hoehe;
    svg.append(el("line", { class: "raster", x1: rand.links, y1: y, x2: rand.links + breite, y2: y }));
    svg.append(el("text", { class: "beschriftung", x: rand.links - 8, y: y + 3, "text-anchor": "end" }, String(Math.round(wert))));
  }

  reihe.forEach((t, i) => {
    const x = rand.links + schritt * i + (schritt - balkenBreite) / 2;
    const h = (t.antworten / max) * hoehe;
    const rect = el("rect", {
      x,
      y: rand.oben + hoehe - Math.max(h, t.antworten ? 2 : 0),
      width: balkenBreite,
      height: Math.max(h, t.antworten ? 2 : 1),
      rx: Math.min(3, balkenBreite / 2),
      fill: t.antworten ? "url(#gradGelb2)" : "#1b2029",
    });
    rect.append(el("title", {}, `${t.tag}: ${t.antworten} Bewertungen`));
    svg.append(rect);
  });

  const jedes = Math.ceil(reihe.length / 12);
  reihe.forEach((t, i) => {
    if (i % jedes) return;
    svg.append(
      el("text", { class: "beschriftung", x: rand.links + schritt * i + schritt / 2, y: H - 8, "text-anchor": "middle" }, datumKurz(t.tag)),
    );
  });

  svg.append(el("line", { class: "achse", x1: rand.links, y1: rand.oben + hoehe, x2: rand.links + breite, y2: rand.oben + hoehe }));
  $("chartAntworten").replaceChildren(svg);
}

// --------------------------------------------------------- Ranglisten

function zeigeVerbesserungen(verlauf) {
  const mehrfach = verlauf
    .filter((v) => v.versuche > 1)
    .map((v) => ({ ...v, delta: v.letzte - v.erste }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 8);

  const box = $("verbesserungen");
  if (!mehrfach.length) {
    box.replaceChildren(
      hinweis("Noch keine Frage zweimal beantwortet. Wiederhole schwache Fragen – hier siehst du dann die Entwicklung."),
    );
    return;
  }

  box.replaceChildren(
    ...mehrfach.map((v) => {
      const zeile = document.createElement("div");
      zeile.className = "rang-zeile klickbar";
      zeile.addEventListener("click", () => (location.href = `quiz.html?frage=${encodeURIComponent(v.frageId)}`));

      const titel = document.createElement("div");
      titel.className = "rang-titel";
      const stark = document.createElement("strong");
      stark.textContent = v.frage;
      const span = document.createElement("span");
      span.textContent = `${v.kategorie} · ${v.versuche} Versuche`;
      titel.append(stark, span);

      const balken = document.createElement("div");
      balken.className = "rang-balken";
      const i = document.createElement("i");
      i.className = v.letzte >= 8 ? "gut" : v.letzte >= 6 ? "mittel" : "schwach";
      i.style.width = `${(v.letzte / 10) * 100}%`;
      balken.append(i);

      const wert = document.createElement("div");
      wert.className = "rang-wert";
      wert.textContent = `${v.erste} → ${v.letzte}`;
      const small = document.createElement("small");
      small.textContent = v.delta >= 0 ? `+${v.delta}` : String(v.delta);
      wert.append(small);

      zeile.append(titel, balken, wert);
      return zeile;
    }),
  );
}

function zeigeLetzte(ergebnisse) {
  const letzte = [...ergebnisse].reverse().slice(0, 10);
  const box = $("letzte");
  if (!letzte.length) {
    box.replaceChildren(hinweis('Noch keine Bewertung vorhanden. <a href="quiz.html">Jetzt die erste Frage beantworten</a>.', true));
    return;
  }

  box.replaceChildren(
    ...letzte.map((e) => {
      const zeile = document.createElement("div");
      zeile.className = "rang-zeile klickbar";
      zeile.addEventListener("click", () => (location.href = `quiz.html?frage=${encodeURIComponent(e.frageId)}`));

      const titel = document.createElement("div");
      titel.className = "rang-titel";
      const stark = document.createElement("strong");
      stark.textContent = e.frage;
      const span = document.createElement("span");
      span.textContent = `${e.kategorie} · ${datumLang(e.zeit)}`;
      titel.append(stark, span);

      const balken = document.createElement("div");
      balken.className = "rang-balken";
      const i = document.createElement("i");
      i.className = e.punkte >= 8 ? "gut" : e.punkte >= 6 ? "mittel" : "schwach";
      i.style.width = `${(e.punkte / 10) * 100}%`;
      balken.append(i);

      const wert = document.createElement("div");
      wert.className = `rang-wert ${punkteKlasse(e.punkte)}`;
      wert.textContent = e.punkte;
      const small = document.createElement("small");
      small.textContent = "von 10";
      wert.append(small);

      zeile.append(titel, balken, wert);
      return zeile;
    }),
  );
}

function hinweis(text, html = false) {
  const div = document.createElement("div");
  div.className = "leer-hinweis";
  if (html) div.innerHTML = text;
  else div.textContent = text;
  return div;
}

init();
