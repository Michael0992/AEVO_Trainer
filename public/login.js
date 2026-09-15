const form = document.getElementById("loginForm");
const fehlerEl = document.getElementById("loginFehler");
const knopf = document.getElementById("btnAnmelden");

// Falls bereits angemeldet, direkt weiter ins Hauptmenue.
fetch("/api/session").then(async (r) => {
  if (r.ok) {
    const ziel = new URLSearchParams(location.search).get("weiter");
    location.replace(ziel && ziel.startsWith("/") ? ziel : "/index.html");
  }
});

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  fehlerEl.hidden = true;
  knopf.disabled = true;

  const username = document.getElementById("fNutzer").value;
  const password = document.getElementById("fPasswort").value;

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const inhalt = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(inhalt.fehler || "Anmeldung fehlgeschlagen.");

    const ziel = new URLSearchParams(location.search).get("weiter");
    location.replace(ziel && ziel.startsWith("/") ? ziel : "/index.html");
  } catch (err) {
    fehlerEl.textContent = err.message;
    fehlerEl.hidden = false;
    knopf.disabled = false;
  }
});
