#!/bin/bash
# Setzt ein Passwort für den Node-RED-Editor (Benutzer: admin).
# Nötig, bevor Node-RED über den localhost.run-Tunnel aus dem Internet erreichbar ist.
# Gespeichert wird nur ein bcrypt-Hash in ~/.node-red/settings.js, nicht das Passwort selbst.
# WebSocket, MQTT und REST-Endpunkt bleiben ohne Login erreichbar (für die Webapp).
#
# Aufruf auf dem Pi:  bash editor-passwort.sh
set -e
SETTINGS="$HOME/.node-red/settings.js"
BCRYPT=/usr/lib/node_modules/node-red/node_modules/bcryptjs

[ -f "$SETTINGS" ] || { echo "Nicht gefunden: $SETTINGS"; exit 1; }

echo "Passwort für den Node-RED-Editor festlegen (Benutzer: admin, mindestens 8 Zeichen)."
read -rsp "Passwort: " PW1; echo
read -rsp "Passwort wiederholen: " PW2; echo
[ "$PW1" = "$PW2" ] || { echo "Die Eingaben stimmen nicht überein. Bitte nochmal starten."; exit 1; }
[ "${#PW1}" -ge 8 ] || { echo "Das Passwort ist zu kurz (mindestens 8 Zeichen)."; exit 1; }

# Passwort über eine Umgebungsvariable übergeben, damit es nicht in der Prozessliste steht
HASH=$(PW="$PW1" node -e "process.stdout.write(require('$BCRYPT').hashSync(process.env.PW, 8))")
unset PW1 PW2

cp "$SETTINGS" "$SETTINGS.vor-passwort"
HASH="$HASH" python3 - "$SETTINGS" <<'PY'
import os, re, sys
pfad = sys.argv[1]
s = open(pfad, encoding="utf-8").read()
block = ('    adminAuth: {\n'
         '        type: "credentials",\n'
         '        users: [{\n'
         '            username: "admin",\n'
         '            password: "' + os.environ["HASH"] + '",\n'
         '            permissions: "*"\n'
         '        }]\n'
         '    },\n')
aktiv = re.compile(r'^    adminAuth: \{\n.*?^    \},\n', re.S | re.M)
auskommentiert = re.compile(r'^    //adminAuth: \{\n(?:    //.*\n)*?    //\},\n', re.M)
if aktiv.search(s):
    s = aktiv.sub(lambda m: block, s, count=1)
elif auskommentiert.search(s):
    s = auskommentiert.sub(lambda m: block, s, count=1)
else:
    sys.exit("adminAuth-Abschnitt in settings.js nicht gefunden, nichts geändert.")
open(pfad, "w", encoding="utf-8").write(s)
PY

# Node-RED nur neu starten, wenn gerade keine Installation läuft
while pgrep -f "npm install" >/dev/null; do echo "Warte, bis die laufende Installation fertig ist …"; sleep 10; done
sudo systemctl restart nodered
echo "Fertig. Der Editor fragt jetzt nach Benutzer admin und deinem Passwort."
echo "Sicherung der alten Einstellungen: $SETTINGS.vor-passwort"
