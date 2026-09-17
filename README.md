# AEVO Trainer – Nürnberg 2026

Lokale Node.js-Anwendung zum Üben der AEVO-Prüfung (Ausbildereignung, IHK Nürnberg).
Der Fragenkatalog stammt vollständig aus dem PDF
`Beispiel_AEVO_Nürnberg2026_LernstandskontrolleDozent.pdf` (Dozentenmaterial, Stand August 2026).

Antworten lassen sich **tippen oder diktieren**. Eine **Claude API** bewertet die Antwort
gegen die Musterantwort des Katalogs und vergibt **0–10 Punkte** mit konkreter Rückmeldung.

## Start

```bash
npm install
npm start
```

Dann http://localhost:3000 öffnen. Anderer Port: `PORT=8080 npm start`.

## Login

Die Anwendung ist durch einen Login geschützt. Beim allerersten Start ohne `.env`
werden automatisch ein Benutzername (`admin`) und ein zufälliges Passwort erzeugt und
einmalig auf der Konsole ausgegeben – dort notieren. Zugangsdaten liegen danach in der
lokalen Datei `.env` (nicht eingecheckt):

```
AEVO_USER=admin
AEVO_PASSWORD=...
```

Zum Ändern einfach die Werte in `.env` anpassen und den Server neu starten (bestehende
Sitzungen anderer Geräte werden dabei ungültig). Fehlversuche werden nach 5 Versuchen
pro Client für 5 Minuten gesperrt; die Sitzung läuft nach 12 Stunden ab.

## Bedienung

1. **API-Schlüssel** oben eintragen (`sk-ant-...`). Er wird nur im `localStorage` des Browsers
   gespeichert und pro Anfrage an den lokalen Server geschickt, der ihn an die Claude API
   weiterreicht – er landet in keiner Datei und in keinem Log.
2. **Sprachmodell** wählen. Die Liste ist sofort gefüllt (Opus 5, Sonnet 5, Haiku 4.5,
   Opus 4.8, Fable 5.1) – Mouseover zeigt Stärke und Preis pro 1 Mio. Token.
   Über ⟳ werden zusätzlich alle für den Schlüssel tatsächlich freigeschalteten Modelle
   aus `GET /v1/models` geladen; ★ markiert Modelle mit strukturierten Ausgaben (empfohlen).
   Standard ist `claude-opus-5`, die Wahl wird gemerkt.

   Für die Bewertung reicht **Sonnet 5** in aller Regel aus; **Haiku 4.5** ist am günstigsten
   und schnellsten, urteilt aber milder und weniger differenziert als Opus.
3. Frage aus der Liste wählen, filtern oder per **Zufällige Frage** ziehen.
4. Antwort schreiben – oder **🎙 Diktieren** drücken und frei sprechen (wie im Fachgespräch).
5. **Antwort bewerten** (oder `Strg`+`Enter`).

## Fragenkatalog (107 Fragen)

| Bereich | Umfang |
|---|---|
| Fragenkatalog Handlungsfelder 1–4 + aktuelle Prüfungsthemen | 55 Fragen |
| Fachgesprächsfälle der praktischen Prüfung | 6 Fälle |
| Fachgespräch zur praktischen Durchführung (Musterunterweisung Patchkabel/Kabeltester) | 46 Fragen |

Zu jeder Frage liegen die Stichworte der Musterantwort vor, dazu je nach Bereich
Unterrichtsimpuls, Beispiel, typische Nachfrage und die bekannte Antwortfalle.
Bei den 46 Fachgesprächsfragen bekommt das Modell zusätzlich den Kontext der
Musterunterweisung, damit die Antwort situationsbezogen bewertet wird.

## Bewertungsraster (10 Punkte)

Abgeleitet aus dem Bewertungsraster des Dozentenmaterials:

| Kriterium | Punkte |
|---|---|
| Inhaltliche Abdeckung der Kernaspekte | 0–4 |
| Fachliche und rechtliche Korrektheit (inkl. Antwortfallen) | 0–2 |
| Struktur und Begründung (Entscheidung – Begründung – Alternative – Praxisbeleg – Kontrolle) | 0–2 |
| Praxisbezug, Erfolgskontrolle, reflektierte Alternativen und Grenzen | 0–2 |

Das Modell liefert zusätzlich: getroffene und fehlende Aspekte, fachliche Fehler bzw.
Antwortfallen, eine prüfungssichere 90-Sekunden-Musterantwort und einen Lernschritt.

## Mikrofon

Das Diktat nutzt die Web Speech API (`de-DE`) – verfügbar in **Chrome und Edge**.
In Firefox und Safari ist der Button deaktiviert; dort einfach tippen.
Die Bewertung ignoriert Tipp-, Erkennungs- und Zeichensetzungsfehler bewusst und
bewertet nur den Inhalt.

## Struktur

```
server.js              HTTP-Server, Claude-Aufruf, Bewertungslogik
data/questions.json    Fragenkatalog aus dem PDF
public/index.html      Oberfläche
public/styles.css      Dunkles Theme, gelb-oranger Akzent
public/app.js          Fragenlogik, Mikrofon, Fortschritt (localStorage)
```

### Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/questions` | Fragenkatalog inkl. Prüfungsrahmen und Bewertungsraster |
| GET | `/api/models` | Modelle der Claude API (Header `x-api-key`) |
| POST | `/api/evaluate` | `{ apiKey, model, questionId, antwort }` → Bewertung |

Der Server hält die Musterantworten – die Bewertung lässt sich vom Browser aus also
nicht manipulieren. Der Fortschritt (Antworten, Punkte) liegt ausschließlich im Browser.

## Deployment auf Render

Render legt das Projektverzeichnis bei **jedem Deploy** neu an, und Free-Instanzen
fahren nach etwa 15 Minuten ohne Zugriff herunter. Alles, was nur im Dateisystem
liegt, ist danach weg: Ergebnisse, Lernzeit, Profil und der über die App
eingetragene API-Schlüssel. **Persistent Disks gibt es bei Render erst ab dem
Starter-Plan** – im Free-Plan gibt es kein Verzeichnis, das einen Neustart übersteht.

Die App speichert deshalb in eine Postgres-Datenbank, sobald `DATABASE_URL` gesetzt
ist. Das funktioniert auf jedem Plan, auch im Free-Tier.

### Einrichtung (Free-Plan, kostenlos)

1. **Datenbank anlegen**: bei [Neon](https://neon.tech) ein Projekt erstellen
   (dauerhaft kostenloses Kontingent) und den Verbindungsstring kopieren –
   Form: `postgresql://user:passwort@host.neon.tech/dbname?sslmode=require`.
   Alternativ Supabase oder eine Render-Postgres-Instanz.
2. **Umgebungsvariablen in Render setzen** (Service → Environment):

   | Variable | Wert | Zweck |
   |---|---|---|
   | `DATABASE_URL` | Verbindungsstring | Ergebnisse, Lernzeit, Profil, Schlüssel, Zugangsdaten |
   | `AEVO_USER` | z. B. `admin` | Benutzername für den Login |
   | `AEVO_PASSWORD` | eigenes Passwort | Passwort für den Login |
   | `SESSION_SECRET` | langer Zufallswert | signiert die Sitzungscookies |
   | `ANTHROPIC_API_KEY` | `sk-ant-...` | optional – sonst im Profil der App eintragen |

3. Deployen. Die Tabelle `aevo_store` wird beim ersten Start automatisch angelegt.

`render.yaml` enthält diese Konfiguration bereits als Blueprint.

### Alternative mit Persistent Disk

Wer ohnehin einen bezahlten Instanztyp nutzt, kann statt der Datenbank eine Disk
einbinden (Mount-Pfad `/var/data`) und `DATA_DIR=/var/data` setzen. Ist
`DATABASE_URL` gesetzt, hat die Datenbank Vorrang.

### Prüfen, ob die Speicherung greift

Nach dem Anmelden `https://<deine-app>.onrender.com/api/diagnose` aufrufen:

```json
{ "speicher": { "backend": "postgres", "dauerhaft": true,
                "schreibbar": true, "letzterFehler": null } }
```

`"backend": "datei"` bedeutet, dass keine Datenbank erreichbar war und in das
flüchtige Projektverzeichnis geschrieben wird – dann stimmt `DATABASE_URL` nicht.
Der Serverstart protokolliert denselben Zustand, und ist die Datenbank beim Start
nicht erreichbar, läuft die App weiter (mit Datei-Ablage) statt abzustürzen.

Kann ein Ergebnis nicht dauerhaft abgelegt werden, meldet die API
`gespeichert: false` und das Quiz zeigt eine Warnung an, statt den Verlust zu
verschweigen.

### Umzug bestehender Daten

Beim ersten Start mit leerer Datenbank übernimmt die App automatisch eine
vorhandene `store.json`. Lokal gesammelte Ergebnisse lassen sich außerdem im
Profil als JSON sichern.

## Hinweis

Die Fragen sind eigenständig formulierte Trainingsfragen, keine veröffentlichten
Originalprüfungsaufgaben. Die konkrete Prüfung und das Fachgespräch werden vom
Prüfungsausschuss situationsbezogen gestaltet; aktuelle Einladung, Vordrucke und
Hinweise der IHK Nürnberg haben Vorrang.
#
