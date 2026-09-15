// Alle Aufrufe der Claude API: Antworten bewerten, Wissensfragen erklaeren,
// verfuegbare Modelle auflisten.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Modelle, die strukturierte Ausgaben (output_config.format) beherrschen.
export const EMPFOHLENE_MODELLE = [
  { id: "claude-opus-5", name: "Claude Opus 5 - strengste und genaueste Bewertung ($5/$25)" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5 - guter Kompromiss aus Qualitaet und Preis ($2/$10)" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 - am schnellsten und guenstigsten ($1/$5)" },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8 - Vorgaengergeneration ($5/$25)" },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1 - staerkstes Modell, hoechster Preis ($10/$50)" },
];
export const STANDARD_MODELL = "claude-sonnet-5";

const Bewertung = z.object({
  punkte: z.number().int().describe("Gesamtpunktzahl von 0 bis 10"),
  teilpunkte: z
    .object({
      inhaltliche_abdeckung: z.number().int().describe("0-4: wie viele der erwarteten Kernaspekte kommen vor"),
      fachliche_korrektheit: z.number().int().describe("0-2: fachlich und rechtlich richtig, keine Falschaussagen"),
      struktur_und_begruendung: z.number().int().describe("0-2: klare Struktur, Priorisierung, nachvollziehbare Begruendung"),
      praxisbezug_und_kontrolle: z.number().int().describe("0-2: betrieblicher Bezug, Erfolgskontrolle, Alternativen/Grenzen"),
    })
    .describe("Teilpunkte, die zusammen die Gesamtpunktzahl ergeben"),
  kurzurteil: z.string().describe("Ein bis zwei Saetze Gesamteinschaetzung"),
  getroffene_aspekte: z.array(z.string()).describe("Inhalte der Musterantwort, die in der Antwort vorkommen"),
  fehlende_aspekte: z.array(z.string()).describe("Wichtige Inhalte, die gefehlt haben"),
  fehler_oder_risiken: z.array(z.string()).describe("Fachliche oder rechtliche Fehler, Antwortfallen, riskante Aussagen"),
  musterantwort_kompakt: z
    .string()
    .describe("Pruefungstaugliche Antwort in 90 Sekunden: Entscheidung, Begruendung, Alternative, Praxisbeleg, Kontrolle"),
  naechster_lernschritt: z.string().describe("Ein konkreter Uebungstipp"),
});

const Erklaerung = z.object({
  kurzantwort: z.string().describe("Die Antwort in ein bis zwei Saetzen, direkt auf den Punkt"),
  kernpunkte: z.array(z.string()).describe("4-7 Stichpunkte, die man in der Pruefung nennen sollte"),
  rechtsgrundlagen: z
    .array(z.string())
    .describe("Einschlaegige Regelwerke, moeglichst mit Paragraph, z.B. 'BBiG Paragraf 11 - Vertragsniederschrift'. Leer lassen, wenn unsicher."),
  praxisbeispiel: z.string().describe("Ein konkretes betriebliches Beispiel"),
  pruefungstipp: z.string().describe("Worauf der Pruefungsausschuss bei diesem Thema achtet, oder eine typische Falle"),
  unsicherheit: z
    .string()
    .describe("Falls Rechtsstand oder Details unsicher sind oder oertlich abweichen koennen: Hinweis. Sonst leerer String."),
});

const SYSTEM_BEWERTUNG = `Du bist erfahrene Pruefer:in im AEVO-Pruefungsausschuss der IHK Nuernberg und bewertest muendliche Antworten von Teilnehmenden der Ausbildereignungspruefung nach AEVO.

Du erhaeltst: die Pruefungsfrage, die Stichwortliste der Musterantwort, ggf. Kontext zur Unterweisungssituation, ggf. eine typische Nachfrage und eine bekannte Antwortfalle - und die Antwort der teilnehmenden Person.

Bewerte mit maximal 10 Punkten, aufgeteilt als:
- inhaltliche_abdeckung (0-4): Wie viele der erwarteten Kernaspekte kommen sinngemaess vor? Gleichwertige eigene Formulierungen zaehlen voll; der Wortlaut der Stichworte ist nicht noetig. Fachlich richtige Aspekte ausserhalb der Stichwortliste zaehlen ebenfalls positiv.
- fachliche_korrektheit (0-2): fachlich und rechtlich richtig; Falschaussagen, erfundene Paragraphen oder das Tappen in die genannte Antwortfalle kosten Punkte.
- struktur_und_begruendung (0-2): erkennbare Struktur (Entscheidung - Begruendung - Alternative - Praxisbeleg - Kontrolle), Priorisierung statt blosser Aufzaehlung, adressatengerechte Begruendung.
- praxisbezug_und_kontrolle (0-2): konkreter betrieblicher Bezug bzw. Beispiel, Erfolgskontrolle oder Evaluation, reflektierte Alternativen und Grenzen.

Die Summe der Teilpunkte muss exakt der Gesamtpunktzahl entsprechen.

Orientierung: 0-2 Punkte = kaum verwertbar, 3-4 = mangelhaft, 5-6 = ausreichend bis befriedigend, 7-8 = gut, 9-10 = sehr gut und pruefungssicher. Eine kurze, aber inhaltlich treffende Antwort kann gut sein; eine lange Antwort ohne Substanz ist es nicht. Eine leere oder voellig themenfremde Antwort bekommt 0 Punkte.

Die Antwort kann per Spracherkennung diktiert worden sein: Tippfehler, fehlende Satzzeichen, Fuellwoerter und Umgangssprache duerfen die Bewertung nicht senken. Bewerte ausschliesslich den Inhalt.

Die Rueckmeldungen werden auch vorgelesen: schreibe sie als ganze, gut sprechbare Saetze auf Deutsch, per Du, sachlich, konkret und wertschaetzend. Keine Floskeln, keine Wiederholung der Frage, keine Aufzaehlungszeichen im Fliesstext.`;

const SYSTEM_WISSEN = `Du bist erfahrene Ausbilder:in und AEVO-Dozent:in und erklaerst Teilnehmenden der Ausbildereignungspruefung ein Fachthema.

Antworte praezise, praxisnah und auf dem Niveau der AEVO-Pruefung. Deutsches Berufsbildungsrecht: BBiG, HwO, AEVO, JArbSchG, BetrVG, Ausbildungsordnungen.

Wichtig zur Genauigkeit: Nenne Paragraphen nur, wenn du dir sicher bist - eine erfundene Fundstelle ist schlimmer als keine. Bei Betraegen, Fristen und Rechtsstand weise auf moegliche Aenderungen und oertliche Regelungen der zustaendigen Stelle hin. Wenn die Frage nichts mit Berufsausbildung zu tun hat, sage das freundlich und beantworte sie nicht.

Die Antwort wird auch vorgelesen: ganze, gut sprechbare Saetze, auf Deutsch, per Du.`;

function clamp(n, min, max) {
  const v = Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0;
  return Math.min(max, Math.max(min, v));
}

export function normalisiereBewertung(b) {
  const t = b.teilpunkte || {};
  const teilpunkte = {
    inhaltliche_abdeckung: clamp(t.inhaltliche_abdeckung, 0, 4),
    fachliche_korrektheit: clamp(t.fachliche_korrektheit, 0, 2),
    struktur_und_begruendung: clamp(t.struktur_und_begruendung, 0, 2),
    praxisbezug_und_kontrolle: clamp(t.praxisbezug_und_kontrolle, 0, 2),
  };
  const summe = Object.values(teilpunkte).reduce((a, c) => a + c, 0);
  const gesamt = clamp(b.punkte, 0, 10);
  return {
    punkte: Math.abs(gesamt - summe) > 1 ? summe : gesamt,
    teilpunkte,
    kurzurteil: b.kurzurteil || "",
    getroffene_aspekte: Array.isArray(b.getroffene_aspekte) ? b.getroffene_aspekte : [],
    fehlende_aspekte: Array.isArray(b.fehlende_aspekte) ? b.fehlende_aspekte : [],
    fehler_oder_risiken: Array.isArray(b.fehler_oder_risiken) ? b.fehler_oder_risiken : [],
    musterantwort_kompakt: b.musterantwort_kompakt || "",
    naechster_lernschritt: b.naechster_lernschritt || "",
  };
}

function jsonAusText(text) {
  const start = text.indexOf("{");
  const ende = text.lastIndexOf("}");
  if (start === -1 || ende <= start) throw new Error("Keine JSON-Antwort im Modelloutput gefunden.");
  return JSON.parse(text.slice(start, ende + 1));
}

// Ein Aufruf mit strukturierter Ausgabe; faellt auf reines JSON im Text zurueck,
// falls das gewaehlte Modell output_config.format nicht kennt.
async function frageModell({ apiKey, model, system, prompt, schema, name, felderHinweis }) {
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(schema, name) },
    });
    if (response.stop_reason === "refusal") {
      throw new Error("Das Modell hat die Anfrage abgelehnt. Bitte Formulierung pruefen.");
    }
    if (!response.parsed_output) throw new Error("Die Antwort konnte nicht gelesen werden.");
    return { daten: response.parsed_output, model: response.model };
  } catch (err) {
    if (err?.status && err.status !== 400) throw err;

    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: `${prompt}\n\n${felderHinweis}` }],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return { daten: jsonAusText(text), model: response.model };
  }
}

function bewertungsPrompt(frage, antwort) {
  const teile = [];
  if (frage.kontext) teile.push(`SITUATIONSKONTEXT:\n${frage.kontext}`);
  teile.push(`KATEGORIE: ${frage.bereich} / ${frage.kategorie}`);
  teile.push(`PRUEFUNGSFRAGE:\n${frage.frage}`);
  teile.push(`MUSTERANTWORT (Stichworte):\n- ${frage.stichworte.join("\n- ")}`);
  if (frage.beispiel) teile.push(`BEISPIEL AUS DEM MATERIAL:\n${frage.beispiel}`);
  if (frage.nachfrage) teile.push(`TYPISCHE NACHFRAGE DES AUSSCHUSSES:\n${frage.nachfrage}`);
  if (frage.antwortfalle) teile.push(`BEKANNTE ANTWORTFALLE:\n${frage.antwortfalle}`);
  teile.push(`ANTWORT DER TEILNEHMENDEN PERSON:\n"""\n${antwort}\n"""`);
  teile.push("Bewerte diese Antwort nach dem beschriebenen Raster.");
  return teile.join("\n\n");
}

export async function bewerteAntwort({ apiKey, model, frage, antwort }) {
  const { daten, model: benutzt } = await frageModell({
    apiKey,
    model,
    system: SYSTEM_BEWERTUNG,
    prompt: bewertungsPrompt(frage, antwort),
    schema: Bewertung,
    name: "bewertung",
    felderHinweis:
      'Antworte ausschliesslich mit einem JSON-Objekt ohne Markdown-Codeblock: {"punkte": 0-10, "teilpunkte": ' +
      '{"inhaltliche_abdeckung": 0-4, "fachliche_korrektheit": 0-2, "struktur_und_begruendung": 0-2, ' +
      '"praxisbezug_und_kontrolle": 0-2}, "kurzurteil": Text, "getroffene_aspekte": [Text], "fehlende_aspekte": [Text], ' +
      '"fehler_oder_risiken": [Text], "musterantwort_kompakt": Text, "naechster_lernschritt": Text}',
  });
  return { bewertung: normalisiereBewertung(daten), model: benutzt };
}

export async function erklaereFrage({ apiKey, model, frage, thema }) {
  const prompt = [
    thema ? `THEMENBEREICH: ${thema}` : "",
    `FRAGE DER TEILNEHMENDEN PERSON:\n${frage}`,
    "Erklaere das so, dass es in der muendlichen AEVO-Pruefung tragfaehig ist.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const { daten, model: benutzt } = await frageModell({
    apiKey,
    model,
    system: SYSTEM_WISSEN,
    prompt,
    schema: Erklaerung,
    name: "erklaerung",
    felderHinweis:
      'Antworte ausschliesslich mit einem JSON-Objekt ohne Markdown-Codeblock: {"kurzantwort": Text, ' +
      '"kernpunkte": [Text], "rechtsgrundlagen": [Text], "praxisbeispiel": Text, "pruefungstipp": Text, "unsicherheit": Text}',
  });

  return {
    erklaerung: {
      kurzantwort: daten.kurzantwort || "",
      kernpunkte: Array.isArray(daten.kernpunkte) ? daten.kernpunkte : [],
      rechtsgrundlagen: Array.isArray(daten.rechtsgrundlagen) ? daten.rechtsgrundlagen : [],
      praxisbeispiel: daten.praxisbeispiel || "",
      pruefungstipp: daten.pruefungstipp || "",
      unsicherheit: daten.unsicherheit || "",
    },
    model: benutzt,
  };
}

export async function listeModelle(apiKey) {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const empfohlen = new Map(EMPFOHLENE_MODELLE.map((m) => [m.id, m.name]));
  const modelle = [];
  for await (const m of client.models.list({ limit: 100 })) {
    modelle.push({
      id: m.id,
      name: empfohlen.get(m.id) || m.display_name || m.id,
      empfohlen: empfohlen.has(m.id),
    });
  }
  modelle.sort((a, b) => Number(b.empfohlen) - Number(a.empfohlen) || a.id.localeCompare(b.id));
  return modelle;
}

export function fehlertext(err) {
  if (err?.status === 401) return "Der API-Schluessel wurde abgelehnt (401). Bitte im Profil pruefen.";
  if (err?.status === 403) return "Zugriff verweigert (403). Hat der Schluessel Zugriff auf dieses Modell?";
  if (err?.status === 404) return "Modell nicht gefunden (404). Bitte ein anderes Modell waehlen.";
  if (err?.status === 429) return "Rate Limit erreicht (429). Bitte kurz warten und erneut versuchen.";
  if (err?.status >= 500) return "Die Claude API meldet einen Serverfehler. Bitte erneut versuchen.";
  return err?.message || "Unbekannter Fehler.";
}
