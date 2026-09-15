/* Gemeinsame Bausteine aller Seiten:
   API-Zugriff, Kopfzeile, Lernzeituhr, Sprachausgabe, kleine Formatierer. */

export const $ = (id) => document.getElementById(id);

export const SEITEN = [
  { id: "quiz", datei: "quiz.html", icon: "🎯", titel: "Prüfungsquiz" },
  { id: "fortschritt", datei: "fortschritt.html", icon: "📈", titel: "Fortschritt" },
  { id: "schwaechen", datei: "schwaechen.html", icon: "🎚", titel: "Schwachstellen" },
  { id: "wissen", datei: "wissen.html", icon: "📚", titel: "Wissensbereich" },
  { id: "profil", datei: "profil.html", icon: "👤", titel: "Profil" },
];

// ------------------------------------------------------------------- API

export async function api(pfad, { methode = "GET", daten } = {}) {
  const res = await fetch(pfad, {
    method: methode,
    headers: daten ? { "Content-Type": "application/json" } : undefined,
    body: daten ? JSON.stringify(daten) : undefined,
  });
  let inhalt = {};
  try {
    inhalt = await res.json();
  } catch {
    /* leere Antwort */
  }
  if (res.status === 401 && inhalt.code === "nicht_angemeldet") {
    location.replace(`/login.html?weiter=${encodeURIComponent(location.pathname)}`);
    return new Promise(() => {}); // Navigation laeuft, keine weitere Verarbeitung noetig
  }
  if (!res.ok) {
    const fehler = new Error(inhalt.fehler || `Fehler ${res.status}`);
    fehler.code = inhalt.code;
    fehler.status = res.status;
    fehler.daten = inhalt;
    throw fehler;
  }
  return inhalt;
}

// -------------------------------------------------------------- Kopfzeile

export function renderNav(aktiv, { titel, untertitel } = {}) {
  const seite = SEITEN.find((s) => s.id === aktiv);
  const kopf = document.createElement("header");
  kopf.className = "topbar";
  kopf.innerHTML = `
    <a class="brand" href="index.html" title="Zum Hauptmenü">
      <span class="brand-mark">AE</span>
      <div>
        <h1>${titel || seite?.titel || "AEVO Trainer"}</h1>
        <p>${untertitel || "AEVO Trainer · IHK Nürnberg 2026"}</p>
      </div>
    </a>
    <nav class="topnav">
      ${SEITEN.map(
        (s) => `<a href="${s.datei}" class="navlink${s.id === aktiv ? " active" : ""}"><span>${s.icon}</span>${s.titel}</a>`,
      ).join("")}
    </nav>
    <div class="topright">
      <span class="lernuhr" id="lernuhr" title="Aktive Lernzeit heute">⏱ <strong id="lernuhrWert">0 min</strong></span>
      <button class="navlink" id="btnAbmelden" type="button" title="Abmelden">⎋ Abmelden</button>
    </div>`;
  document.body.prepend(kopf);
  kopf.querySelector("#btnAbmelden").addEventListener("click", async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      location.href = "/login.html";
    }
  });
}

// ------------------------------------------------------------- Lernzeit

// Zaehlt nur aktive Zeit: Tab sichtbar und in den letzten zwei Minuten eine Eingabe.
class Lernuhr {
  constructor() {
    this.sekunden = 0;
    this.gesendet = 0;
    this.letzteAktion = Date.now();
    this.heuteGesamt = 0;
    this.timer = null;
  }

  start() {
    for (const ereignis of ["mousedown", "keydown", "touchstart", "scroll", "focus"]) {
      window.addEventListener(ereignis, () => (this.letzteAktion = Date.now()), { passive: true });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.senden();
      else this.letzteAktion = Date.now();
    });
    window.addEventListener("pagehide", () => this.senden(true));

    this.timer = setInterval(() => this.tick(), 1000);
    api("/api/lernzeit")
      .then((d) => {
        this.heuteGesamt = d.heute || 0;
        this.anzeigen();
      })
      .catch(() => {});
  }

  tick() {
    const aktiv = !document.hidden && Date.now() - this.letzteAktion < 120000;
    if (aktiv) {
      this.sekunden++;
      this.heuteGesamt++;
      this.anzeigen();
    }
    if (this.sekunden - this.gesendet >= 30) this.senden();
  }

  senden(final = false) {
    const offen = this.sekunden - this.gesendet;
    if (offen <= 0) return;
    this.gesendet = this.sekunden;
    const nutzlast = JSON.stringify({ sekunden: offen });
    if (final && navigator.sendBeacon) {
      navigator.sendBeacon("/api/lernzeit", new Blob([nutzlast], { type: "application/json" }));
      return;
    }
    fetch("/api/lernzeit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: nutzlast,
      keepalive: true,
    }).catch(() => {});
  }

  anzeigen() {
    const el = $("lernuhrWert");
    if (el) el.textContent = dauer(this.heuteGesamt);
  }
}

export function starteLernuhr() {
  const uhr = new Lernuhr();
  uhr.start();
  return uhr;
}

// ------------------------------------------------------- Sprachausgabe

/* Gekapselt: aktuell die Sprachausgabe des Browsers (laeuft auch auf Android Chrome
   und iOS Safari, dort nur nach einem Tippen auf den Button). Ein externer
   TTS-Dienst liesse sich hier anstelle von speechSynthesis einhaengen. */
export const Sprache = {
  verfuegbar: typeof window !== "undefined" && "speechSynthesis" in window,
  stimmen: [],
  einstellungen: { stimme: "", tempo: 1 },
  aktuelleTaste: null,

  laden() {
    if (!this.verfuegbar) return Promise.resolve([]);
    return new Promise((fertig) => {
      const holen = () => {
        this.stimmen = speechSynthesis.getVoices().filter((s) => s.lang.toLowerCase().startsWith("de"));
        if (!this.stimmen.length) this.stimmen = speechSynthesis.getVoices();
        return this.stimmen;
      };
      const vorhanden = holen();
      if (vorhanden.length) return fertig(vorhanden);
      speechSynthesis.addEventListener("voiceschanged", () => fertig(holen()), { once: true });
      setTimeout(() => fertig(holen()), 1200);
    });
  },

  konfigurieren({ stimme, tempo }) {
    this.einstellungen = { stimme: stimme || "", tempo: Number(tempo) || 1 };
  },

  sprich(text, taste) {
    if (!this.verfuegbar || !text) return false;
    this.stopp();

    const teile = String(text)
      .split(/(?<=[.!?:])\s+/)
      .reduce((acc, satz) => {
        // lange Abschnitte buendeln, damit die Pausen natuerlich klingen
        if (acc.length && (acc[acc.length - 1] + satz).length < 220) acc[acc.length - 1] += " " + satz;
        else acc.push(satz);
        return acc;
      }, []);

    const stimme = this.stimmen.find((s) => s.name === this.einstellungen.stimme);
    for (const teil of teile) {
      const aeusserung = new SpeechSynthesisUtterance(teil);
      aeusserung.lang = stimme?.lang || "de-DE";
      if (stimme) aeusserung.voice = stimme;
      aeusserung.rate = this.einstellungen.tempo;
      speechSynthesis.speak(aeusserung);
    }

    if (taste) {
      this.aktuelleTaste = taste;
      taste.classList.add("spricht");
      const pruefen = setInterval(() => {
        if (!speechSynthesis.speaking && !speechSynthesis.pending) {
          clearInterval(pruefen);
          taste.classList.remove("spricht");
        }
      }, 400);
    }
    return true;
  },

  stopp() {
    if (!this.verfuegbar) return;
    speechSynthesis.cancel();
    this.aktuelleTaste?.classList.remove("spricht");
    this.aktuelleTaste = null;
  },

  get spricht() {
    return this.verfuegbar && (speechSynthesis.speaking || speechSynthesis.pending);
  },
};

// Wandelt eine Bewertung in vorlesbaren Fliesstext um.
export function bewertungAlsText(b) {
  const teile = [`Du hast ${b.punkte} von 10 Punkten erreicht.`, b.kurzurteil];
  if (b.getroffene_aspekte?.length) teile.push(`Getroffen hast du: ${b.getroffene_aspekte.join(", ")}.`);
  if (b.fehlende_aspekte?.length) teile.push(`Gefehlt hat: ${b.fehlende_aspekte.join(", ")}.`);
  if (b.fehler_oder_risiken?.length) teile.push(`Achtung: ${b.fehler_oder_risiken.join(", ")}.`);
  if (b.musterantwort_kompakt) teile.push(`So klingt eine prüfungssichere Antwort: ${b.musterantwort_kompakt}`);
  if (b.naechster_lernschritt) teile.push(`Dein nächster Lernschritt: ${b.naechster_lernschritt}`);
  return teile.filter(Boolean).join(" ");
}

export function erklaerungAlsText(e) {
  const teile = [e.kurzantwort];
  if (e.kernpunkte?.length) teile.push(`Wichtig sind: ${e.kernpunkte.join(", ")}.`);
  if (e.rechtsgrundlagen?.length) teile.push(`Rechtsgrundlagen: ${e.rechtsgrundlagen.join(", ")}.`);
  if (e.praxisbeispiel) teile.push(`Beispiel: ${e.praxisbeispiel}`);
  if (e.pruefungstipp) teile.push(`Prüfungstipp: ${e.pruefungstipp}`);
  if (e.unsicherheit) teile.push(`Hinweis: ${e.unsicherheit}`);
  return teile.filter(Boolean).join(" ");
}

// --------------------------------------------------------- Formatierer

export function dauer(sekunden) {
  const s = Math.max(0, Math.round(sekunden || 0));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

export function datumKurz(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

export function datumLang(iso) {
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

export function punkteKlasse(p) {
  return p >= 8 ? "s-good" : p >= 6 ? "s-mid" : "s-bad";
}

export function zeigeFehler(el, text) {
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || "";
}

// Liste mit Texten fuellen (leert vorhandene Eintraege)
export function fuelleListe(ul, werte, leerText) {
  ul.replaceChildren();
  const items = werte?.length ? werte : leerText ? [leerText] : [];
  for (const w of items) {
    const li = document.createElement("li");
    li.textContent = w;
    ul.append(li);
  }
}
