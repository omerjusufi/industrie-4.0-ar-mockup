#!/bin/bash
# Startet den localhost.run-Tunnel zu Node-RED (Port 1880) und meldet jede neue Adresse per MQTT.
#
# Kostenlose localhost.run-Adressen wechseln bei jedem Verbindungsaufbau und nach einigen Stunden.
# Damit die Webapp (live.html) trotzdem WebSocket und REST findet, veröffentlicht dieses Skript
# die aktuelle Adresse als "retained" Nachricht. Die Webapp liest sie beim Verbinden mit HiveMQ.
#
# Läuft als Dienst p101-tunnel (siehe p101-tunnel.service).
BROKER="broker.hivemq.com"
TOPIC="bbk/25it1/rpi18/gateway"

ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes \
    -R 80:127.0.0.1:1880 nokey@localhost.run 2>&1 |
while IFS= read -r zeile; do
    echo "$zeile"
    url=$(printf '%s\n' "$zeile" | grep -oE 'https://[a-z0-9]+\.lhr\.life' | head -n 1)
    if [ -n "$url" ]; then
        if mosquitto_pub -h "$BROKER" -t "$TOPIC" -r -q 1 \
            -m "{\"gateway\":\"${url#https://}\",\"since\":\"$(date -Iseconds)\"}"; then
            echo "Adresse per MQTT gemeldet: $url"
        else
            echo "Adresse konnte nicht per MQTT gemeldet werden: $url"
        fi
    fi
done

# Exitcode von ssh weitergeben, damit systemd den Tunnel neu startet
exit "${PIPESTATUS[0]}"
