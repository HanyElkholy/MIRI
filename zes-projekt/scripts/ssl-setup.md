# MIRI SSL/TLS Setup & Erneuerung

Dieses Dokument beschreibt die Einrichtung und Verwaltung von SSL/TLS-Zertifikaten mit Let's Encrypt für das MIRI Zeiterfassungssystem.

---

## 📋 Voraussetzungen

1. **Domain zeigt auf Server**: `ahmtimus.com` und `www.ahmtimus.com` müssen auf die IP des AWS Lightsail Servers zeigen
2. **Port 80 und 443 sind offen**: Firewall muss HTTP (80) und HTTPS (443) erlauben
3. **Certbot installiert**: Auf dem Host-System (nicht im Container)

---

## 🚀 Erstinstallation

### 1. Certbot installieren (auf dem Ubuntu-Server)

```bash
# SSH auf den AWS Lightsail Server
ssh ubuntu@your-server-ip

# Update System
sudo apt-get update

# Installiere Certbot
sudo apt-get install -y certbot
```

### 2. Zertifikat erstellen

```bash
# Navigiere zum Projekt-Verzeichnis
cd /path/to/zes-projekt

# Stelle sicher, dass Nginx läuft
docker-compose up -d nginx

# Führe das Initialisierungsskript aus
chmod +x scripts/init-ssl.sh
sudo ./scripts/init-ssl.sh
```

**Alternativ manuell:**

```bash
sudo certbot certonly \
    --webroot \
    --webroot-path=/usr/share/nginx/html \
    --email admin@ahmtimus.com \
    --agree-tos \
    --no-eff-email \
    -d ahmtimus.com \
    -d www.ahmtimus.com
```

### 3. Container neu starten

```bash
docker-compose restart nginx
```

### 4. SSL testen

```bash
# Teste HTTPS
curl -I https://ahmtimus.com

# Teste Zertifikat-Gültigkeit
openssl s_client -connect ahmtimus.com:443 -servername ahmtimus.com < /dev/null 2>/dev/null | openssl x509 -noout -dates
```

---

## 🔄 Automatische Erneuerung einrichten

Let's Encrypt-Zertifikate laufen nach 90 Tagen ab und müssen regelmäßig erneuert werden.

### Option 1: Cron-Job (Empfohlen)

```bash
# Öffne Crontab
sudo crontab -e

# Füge diese Zeile hinzu (prüft täglich um 3:00 Uhr)
0 3 * * * /path/to/zes-projekt/scripts/renew-ssl.sh >> /var/log/miri-ssl-renewal.log 2>&1
```

**Wichtig**: Stelle sicher, dass das Skript ausführbar ist:

```bash
chmod +x /path/to/zes-projekt/scripts/renew-ssl.sh
```

### Option 2: systemd-Timer (Modernere Alternative)

1. **Erstelle Timer-Datei:**

```bash
sudo nano /etc/systemd/system/miri-ssl-renewal.timer
```

Inhalt:
```ini
[Unit]
Description=Renew SSL certificates for MIRI
After=network.target

[Timer]
OnCalendar=daily
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

2. **Erstelle Service-Datei:**

```bash
sudo nano /etc/systemd/system/miri-ssl-renewal.service
```

Inhalt:
```ini
[Unit]
Description=Renew SSL certificates for MIRI
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/path/to/zes-projekt
ExecStart=/path/to/zes-projekt/scripts/renew-ssl.sh
User=root
```

3. **Aktiviere Timer:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable miri-ssl-renewal.timer
sudo systemctl start miri-ssl-renewal.timer

# Prüfe Status
sudo systemctl status miri-ssl-renewal.timer
```

### Option 3: Certbot Auto-Renewal (Standard)

Certbot installiert standardmäßig einen systemd-Timer:

```bash
# Status prüfen
sudo systemctl status certbot.timer

# Aktivieren (falls deaktiviert)
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

**Aber**: Nach der Erneuerung muss Nginx neu geladen werden!

Erweitere den Certbot-Hook:

```bash
sudo nano /etc/letsencrypt/renewal/ahmtimus.com-0001.conf
```

Füge am Ende hinzu:
```ini
[renewalparams]
post_hook = docker-compose -f /path/to/zes-projekt/docker-compose.yml exec -T nginx nginx -s reload || docker-compose -f /path/to/zes-projekt/docker-compose.yml restart nginx
```

---

## 🔍 Zertifikat-Status prüfen

### Gültigkeit prüfen

```bash
# Zeige Ablaufdatum
sudo certbot certificates

# Oder mit OpenSSL
openssl x509 -enddate -noout -in /etc/letsencrypt/live/ahmtimus.com-0001/fullchain.pem
```

### Manuell erneuern (Test)

```bash
# Trockenlauf (keine Änderungen)
sudo certbot renew --dry-run

# Echte Erneuerung (nur wenn innerhalb von 30 Tagen abläuft)
sudo ./scripts/renew-ssl.sh
```

---

## ⚠️ Troubleshooting

### Problem: Zertifikat kann nicht erstellt werden

**Lösung:**
1. Prüfe DNS-Einträge: `dig ahmtimus.com`
2. Prüfe Port 80: `curl -I http://ahmtimus.com/.well-known/acme-challenge/test`
3. Prüfe Nginx-Logs: `docker-compose logs nginx`
4. Stelle sicher, dass `.well-known/acme-challenge/` in Nginx konfiguriert ist

### Problem: Zertifikat wird nicht erneuert

**Lösung:**
1. Prüfe Cron-Logs: `grep SSL /var/log/syslog`
2. Prüfe Skript-Berechtigungen: `ls -l scripts/renew-ssl.sh`
3. Teste manuell: `sudo ./scripts/renew-ssl.sh`
4. Prüfe Certbot-Timer: `sudo systemctl status certbot.timer`

### Problem: Nginx lädt nicht nach Erneuerung

**Lösung:**
1. Prüfe Nginx-Konfiguration: `docker-compose exec nginx nginx -t`
2. Lade manuell neu: `docker-compose exec nginx nginx -s reload`
3. Oder starte neu: `docker-compose restart nginx`

---

## 📝 Nginx SSL-Optimierungen

Die Nginx-Konfiguration wurde mit folgenden SSL-Best-Practices optimiert:

- **TLS 1.2 und 1.3**: Nur moderne, sichere Protokolle
- **Starke Cipher Suites**: ECDHE-Primitiven bevorzugt
- **HSTS Header**: Erzwingt HTTPS für 1 Jahr
- **Security Headers**: X-Frame-Options, X-Content-Type-Options, etc.

---

## 🔐 Sicherheit

### Empfohlene Einstellungen

1. **Firewall (UFW)**:
   ```bash
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

2. **Fail2Ban** (Optional):
   ```bash
   sudo apt-get install -y fail2ban
   ```

3. **Regelmäßige Updates**:
   ```bash
   sudo apt-get update && sudo apt-get upgrade -y
   ```

---

## 📞 Support

Bei Problemen:
1. Prüfe Certbot-Logs: `sudo journalctl -u certbot` oder `/var/log/letsencrypt/letsencrypt.log`
2. Prüfe Nginx-Logs: `docker-compose logs nginx`
3. Teste manuell: `sudo certbot renew --dry-run`

---

## 📚 Weitere Ressourcen

- [Let's Encrypt Dokumentation](https://letsencrypt.org/docs/)
- [Certbot Dokumentation](https://certbot.eff.org/docs/)
- [SSL Labs Test](https://www.ssllabs.com/ssltest/) - Teste deine SSL-Konfiguration
