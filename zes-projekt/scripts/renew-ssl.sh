#!/bin/bash
# MIRI SSL-Zertifikat Erneuerungsskript
# Dieses Skript erneuert Let's Encrypt-Zertifikate und lädt Nginx neu

set -e  # Exit bei Fehler

# Farben für Ausgabe
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Konfiguration
DOMAIN="ahmtimus.com"
EMAIL="${CERTBOT_EMAIL:-admin@ahmtimus.com}"  # Kann als Umgebungsvariable gesetzt werden
COMPOSE_FILE="${COMPOSE_FILE:-./docker-compose.yml}"

echo -e "${YELLOW}=== MIRI SSL-Zertifikat Erneuerung ===${NC}"
echo "Domain: $DOMAIN"
echo "Email: $EMAIL"
echo ""

# Prüfe ob certbot installiert ist
if ! command -v certbot &> /dev/null; then
    echo -e "${RED}Fehler: certbot ist nicht installiert!${NC}"
    echo "Installiere certbot mit: sudo apt-get update && sudo apt-get install -y certbot"
    exit 1
fi

# Prüfe ob docker-compose verfügbar ist
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}Fehler: docker-compose ist nicht verfügbar!${NC}"
    exit 1
fi

# Funktion: Prüfe ob Zertifikat bald abläuft (innerhalb von 30 Tagen)
check_cert_expiry() {
    CERT_PATH="/etc/letsencrypt/live/${DOMAIN}-0001/fullchain.pem"
    
    if [ ! -f "$CERT_PATH" ]; then
        echo -e "${YELLOW}Zertifikat nicht gefunden. Erstelle neues Zertifikat...${NC}"
        return 1
    fi
    
    EXPIRY_DATE=$(openssl x509 -enddate -noout -in "$CERT_PATH" | cut -d= -f2)
    EXPIRY_EPOCH=$(date -d "$EXPIRY_DATE" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y" "$EXPIRY_DATE" +%s 2>/dev/null)
    CURRENT_EPOCH=$(date +%s)
    DAYS_UNTIL_EXPIRY=$(( ($EXPIRY_EPOCH - $CURRENT_EPOCH) / 86400 ))
    
    echo "Zertifikat läuft ab in: $DAYS_UNTIL_EXPIRY Tagen"
    
    if [ $DAYS_UNTIL_EXPIRY -lt 30 ]; then
        return 0  # Erneuerung notwendig
    else
        echo -e "${GREEN}Zertifikat ist noch gültig. Keine Erneuerung notwendig.${NC}"
        return 1  # Keine Erneuerung notwendig
    fi
}

# Funktion: Erneuere Zertifikat
renew_certificate() {
    echo -e "${YELLOW}Erneuere Zertifikat für $DOMAIN...${NC}"
    
    # Erneuere mit certbot (non-interactive)
    certbot renew --cert-name ${DOMAIN}-0001 --quiet --no-self-upgrade
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Zertifikat erfolgreich erneuert!${NC}"
        return 0
    else
        echo -e "${RED}Fehler beim Erneuern des Zertifikats!${NC}"
        return 1
    fi
}

# Funktion: Lade Nginx neu
reload_nginx() {
    echo -e "${YELLOW}Lade Nginx-Container neu...${NC}"
    
    # Verwende docker-compose oder docker compose (je nach Version)
    if command -v docker-compose &> /dev/null; then
        docker-compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null || \
        docker-compose -f "$COMPOSE_FILE" restart nginx
    else
        docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null || \
        docker compose -f "$COMPOSE_FILE" restart nginx
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Nginx erfolgreich neu geladen!${NC}"
        return 0
    else
        echo -e "${RED}Fehler beim Neuladen von Nginx!${NC}"
        return 1
    fi
}

# Hauptlogik
if check_cert_expiry; then
    if renew_certificate; then
        reload_nginx
        echo -e "${GREEN}=== SSL-Erneuerung abgeschlossen ===${NC}"
    else
        echo -e "${RED}=== SSL-Erneuerung fehlgeschlagen ===${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}=== Keine Erneuerung notwendig ===${NC}"
fi
