# KassenSpiel ONLINE SYNC V3

Diese Version speichert jetzt zentral in Supabase:

- Firmen und Benutzer
- Produkte
- Produktbilder / Bild-URLs
- Coupons
- Bons / Verkäufe
- Tagesumsatz und Vorgänge
- Aktivitäten

Der Warenkorb bleibt absichtlich lokal pro Kasse. Dadurch können PC, Handy und iPad gleichzeitig als getrennte Kassen arbeiten.

## UPDATE VON DEINER JETZIGEN VERSION

### 1. Supabase
Öffne:
Supabase -> dein Projekt -> SQL Editor -> New query

Kopiere den kompletten Inhalt von:
`supabase_upgrade_online_sync.sql`

Drücke `Run`.

Wenn `Success` erscheint, ist die Datenbank fertig.

### 2. GitHub
Lade den kompletten Inhalt dieses Ordners in dein bestehendes GitHub-Repository hoch und überschreibe gleichnamige Dateien.

Wichtig:
- index.html
- api/auth.js
- package.json
- vercel.json

### 3. Vercel
Deine bestehenden Environment Variables bleiben gleich:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- APP_SECRET

Nach dem GitHub-Commit sollte Vercel automatisch neu deployen.
Warte auf `Ready`.

## Erster Start
Login:
- admin
- 1234

Beim ersten Start nach dem Update werden die vorhandenen Beispielprodukte und Coupons automatisch in Supabase übernommen.

Danach gilt:
- Artikel auf einem Gerät ändern -> kurze Zeit später auf allen anderen Geräten sichtbar.
- Bon auf Kasse 1 erstellen -> erscheint auch auf Kasse 2 / iPad / Handy.
- Umsatz und Vorgänge werden serverseitig gezählt.
- Wenn kurz kein Internet da ist, kassiert die lokale Kasse weiter; Bons werden später nachgesendet.

Build:
ONLINE-SYNC-V3-13-50
