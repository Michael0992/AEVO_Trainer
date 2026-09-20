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

## Betrieb auf einem eigenen Linux-Server

Alle Daten liegen im Dateisystem: Ergebnisse, Lernzeit und Profil in
`data/store.json`, Zugangsdaten und API-Schlüssel in `.env`. Auf einem eigenen
Server ist das dauerhaft – es braucht keine Datenbank.

### Als systemd-Dienst einrichten

```bash
cd ~/AEVO_Trainer
npm ci --omit=dev
sudo bash deploy/install.sh
```

Das Skript trägt Benutzer, Projektpfad und den Pfad zu `node` selbst ein,
legt `/etc/systemd/system/aevo-trainer.service` an und startet den Dienst auf
Port 3001. Die Vorlage liegt unter `deploy/aevo-trainer.service` und lässt sich
auch von Hand kopieren.

| Zweck | Befehl |
|---|---|
| Status | `systemctl status aevo-trainer` |
| Logs live | `journalctl -u aevo-trainer -f` |
| Nach Update neu starten | `git pull && npm ci --omit=dev && sudo systemctl restart aevo-trainer` |
| Stoppen | `sudo systemctl stop aevo-trainer` |

### Konfiguration

Der Dienst liest `~/AEVO_Trainer/.env`:

| Variable | Zweck |
|---|---|
| `AEVO_USER` / `AEVO_PASSWORD` | Zugangsdaten für den Login |
| `SESSION_SECRET` | signiert die Sitzungscookies; bleibt der Wert gleich, meldet kein Neustart jemanden ab |
| `ANTHROPIC_API_KEY` | optional – alternativ im Profil der App eintragen |

Fehlt die Datei, erzeugt die App beim ersten Start ein Passwort und schreibt es
ins Log (`journalctl -u aevo-trainer | head -40`).

Port und Datenverzeichnis kommen aus der Unit (`PORT`, `DATA_DIR`). `DATA_DIR`
ist nur nötig, wenn die Daten außerhalb des Projektordners liegen sollen –
etwa auf einem eigenen Mount.

### Prüfen, ob die Speicherung greift

Nach dem Anmelden `/api/diagnose` aufrufen:

```json
{ "speicher": { "pfad": "/home/emshift/AEVO_Trainer/data/store.json",
                "schreibbar": true, "letzterFehler": null } }
```

Kann ein Ergebnis nicht abgelegt werden, meldet die API `gespeichert: false`
und das Quiz zeigt eine Warnung, statt den Verlust zu verschweigen.

### Hinweis zu Mikrofon und Vorlesen

Spracherkennung und Sprachausgabe erlaubt der Browser nur über HTTPS oder
`localhost`. Beim Zugriff über die IP des Servers bleibt das Mikrofon gesperrt –
dafür braucht es einen Reverse Proxy mit Zertifikat.

### Deployment bei einem Hoster

`render.yaml` beschreibt den Betrieb bei Render. Wichtig dort: Das
Projektverzeichnis ist flüchtig, deshalb muss eine Persistent Disk eingebunden
und `DATA_DIR` auf deren Mount-Pfad gesetzt werden.

## Hinweis

Die Fragen sind eigenständig formulierte Trainingsfragen, keine veröffentlichten
Originalprüfungsaufgaben. Die konkrete Prüfung und das Fachgespräch werden vom
Prüfungsausschuss situationsbezogen gestaltet; aktuelle Einladung, Vordrucke und
Hinweise der IHK Nürnberg haben Vorrang.
#
