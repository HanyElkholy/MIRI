#!/bin/bash
# MIRI SSL-Zertifikat Initialisierungsskript
# Dieses Skript erstellt das erste Let's Encrypt-Zertifikat

set -e

# Farben für Ausgabe
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Konfiguration
DOMAIN="ahmtimus.com"
EMAIL="${CERTBOT_EMAIL:-admin@ahmtimus.com}"
COMPOSE_FILE="${COMPOSE_FILE:-./docker-compose.yml}"

echo -e "${YELLOW}=== MIRI SSL-Zertifikat Initialisierung ===${NC}"
echo "Domain: $DOMAIN"
echo "Email: $EMAIL"
echo ""

# Prüfe ob certbot installiert ist
if ! command -v certbot &> /dev/null; then
    echo -e "${RED}Fehler: certbot ist nicht installiert!${NC}"
    echo "Installiere certbot mit:"
    echo "  sudo apt-get update"
    echo "  sudo apt-get install -y certbot"
    exit 1
fi

# Prüfe ob Docker läuft
if ! docker ps &> /dev/null; then
    echo -e "${RED}Fehler: Docker läuft nicht!${NC}"
    exit 1
fi

# Starte Nginx (falls nicht läuft) für HTTP-01 Challenge
echo -e "${YELLOW}Stelle sicher, dass Nginx läuft...${NC}"
if command -v docker-compose &> /dev/null; then
    docker-compose -f "$COMPOSE_FILE" up -d nginx
else
    docker compose -f "$COMPOSE_FILE" up -d nginx
fi

# Warte kurz bis Nginx startet
sleep 5

# Erstelle Zertifikat mit HTTP-01 Challenge
echo -e "${YELLOW}Erstelle Let's Encrypt-Zertifikat...${NC}"
echo "Stelle sicher, dass die Domain $DOMAIN auf diesen Server zeigt!"
echo ""

certbot certonly \
    --webroot \
    --webroot-path=/usr/share/nginx/html \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --non-interactive \
    -d "$DOMAIN" \
    -d "www.$DOMAIN"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Zertifikat erfolgreich erstellt!${NC}"
    echo ""
    echo "Nächste Schritte:"
    echo "1. Prüfe die Nginx-Konfiguration in nginx/nginx.conf"
    echo "2. Starte alle Container neu: docker-compose restart"
    echo "3. Richte automatische Erneuerung ein: siehe SSL_SETUP.md"
else
    echo -e "${RED}Fehler beim Erstellen des Zertifikats!${NC}"
    exit 1
fi
