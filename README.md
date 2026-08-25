# KassenSpiel – Vercel + Supabase

Diese Version löst den Login NICHT mehr über localStorage.
Benutzer/Firmen liegen zentral in Supabase und Login/API laufen über Vercel.

## 1. Supabase
1. Neues oder vorhandenes Supabase-Projekt öffnen.
2. SQL Editor öffnen.
3. `supabase_setup.sql` komplett ausführen.
4. Unter Project Settings > API notieren:
   - Project URL
   - service_role Key (NICHT öffentlich teilen)

## 2. GitHub
Den INHALT dieses Ordners/ZIP in dein Repository hochladen:
- index.html
- package.json
- vercel.json
- supabase_setup.sql
- api/auth.js

## 3. Vercel
Repository in Vercel importieren.

In Vercel > Project > Settings > Environment Variables anlegen:
- SUPABASE_URL = deine Supabase Project URL
- SUPABASE_SERVICE_ROLE_KEY = dein service_role Key
- APP_SECRET = ein langes zufälliges Geheimnis, z. B. mindestens 32 Zeichen

Danach Redeploy.

## 4. Erster Login
Benutzername: admin
Passwort: 1234

Beim ersten erfolgreichen `admin / 1234` Login wird das zentrale Groß-Admin-Konto automatisch in Supabase angelegt/repariert.

## Wichtig
GitHub Pages allein kann `/api/auth` nicht ausführen. Diese Version muss über Vercel geöffnet werden.
Du kannst den Code weiterhin in GitHub speichern, aber die öffentliche URL muss die Vercel-URL sein.

## Konten
- Groß-Admin: sieht/verwaltert alle Konten aller Firmen.
- Firmen-Admin: verwaltet seine Firma.
- Mitarbeiter: normales Kassenkonto.
- Firmen- und Mitarbeiterregistrierung werden ebenfalls zentral in Supabase gespeichert.
