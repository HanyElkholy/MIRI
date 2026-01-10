#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h> // <--- NEU: Notwendig für HTTPS
#include "mbedtls/md.h"
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h> 
#include <TFT_eSPI.h> 
#include <SD.h>
#include <FS.h>

// ----------------------------------------
const char* device_secret = "MEIN_GEHEIMES_DEVICE_PASSWORT";
// ----------------------------------------

// Ein einfaches Passwort für die Verschlüsselung
const String SD_SECRET = "AHMTIMUS_SECURE_KEY_2025"; 

// Verschlüsselt/Entschlüsselt einen String (XOR Methode)
String encryptDecrypt(String input) {
  char key[SD_SECRET.length() + 1];
  SD_SECRET.toCharArray(key, sizeof(key));
  String output = input;
  
  for (int i = 0; i < input.length(); i++) {
    output[i] = input[i] ^ key[i % (sizeof(key) - 1)];
  }
  return output;
}

// --- Angepasste Farbpalette ---
#define AHMTIMUS_DARK   0x08C5 // Nicht mehr verwendet
#define AHMTIMUS_LIGHT  0xFFDF // Nicht mehr verwendet
#define AHMTIMUS_BLUE   0x19B1  // (Hex: #1e3a8a) - Für das Logo
// ----------------------------------------

// --- DEINE DATEN ---
const char* ssid = "Apartment A110";
const char* password = "83748813000626132739";

// --- WICHTIG: NEUE URL (HTTPS) ---
const char* serverName = "https://ahmtimus.com/zes/api/v1/stamp";

// --- Pin-Definition für MFRC522 ---
#define MFRC522_RST_PIN  4
#define MFRC522_SS_PIN   5  



// --- Globale Objekte ---
MFRC522 mfrc522(MFRC522_SS_PIN, MFRC522_RST_PIN); 
TFT_eSPI tft = TFT_eSPI(); 

SPIClass sdSPI(HSPI); // Zweiter Bus

String lastCardId = "";
unsigned long lastSendTime = 0;

// --- Globale Variablen für Uhrzeit ---
unsigned long lastTimeUpdate = 0; 
char timeBuffer[6]; // "HH:MM"
char dateBuffer[40]; 
static char lastTimeBuffer[6] = "     "; 

const char* daysOfWeek[7] = {"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"};
const char* monthsOfYear[12] = {"Januar", "Februar", "Maerz", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"};

// --- DISPLAY-FUNKTIONEN (Mit schwarzen Farben) ---

void displayClockUpdate() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return; 
  }
  
  strftime(timeBuffer, sizeof(timeBuffer), "%H:%M", &timeinfo);
  
  if (strcmp(timeBuffer, lastTimeBuffer) != 0) {
    // Schwarzes Rechteck über die alte Uhrzeit
    tft.fillRect(0, 40, tft.width(), 60, TFT_BLACK); 
    
    tft.setTextColor(TFT_WHITE, TFT_BLACK); 
    tft.setTextDatum(MC_DATUM); 
    
    tft.setTextFont(8); 
    tft.drawString(timeBuffer, tft.width() / 2, 70);

    strcpy(lastTimeBuffer, timeBuffer);
  }
}

void displayLayout() {
  tft.fillScreen(TFT_BLACK); 
  
  // --- Copyright (Unten Links, in Firmenfarbe) ---
  tft.setTextDatum(BL_DATUM); // Bottom Left
  tft.setTextColor(AHMTIMUS_BLUE); // Akzentfarbe Blau (Bleibt)
  tft.setTextFont(2); 
  tft.drawString("AHMTIMUS (C)", 10, tft.height() - 10);
  
  // --- Datum ---
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    sprintf(dateBuffer, "%s, %d. %s", daysOfWeek[timeinfo.tm_wday], timeinfo.tm_mday, monthsOfYear[timeinfo.tm_mon]);
    
    tft.setTextColor(TFT_WHITE, TFT_BLACK); 
    tft.setTextDatum(MC_DATUM); 
    tft.setFreeFont(&FreeSans9pt7b); // 9-Punkt Schriftart
    tft.drawString(dateBuffer, tft.width() / 2, 133); 
    tft.setTextFont(1); // Schriftart zurücksetzen
  }

  // --- Uhrzeit ---
  tft.setTextFont(8); 
  tft.setTextColor(TFT_WHITE, TFT_BLACK); 
  tft.setTextDatum(MC_DATUM);
  strftime(timeBuffer, sizeof(timeBuffer), "%H:%M", &timeinfo);
  tft.drawString(timeBuffer, tft.width() / 2, 70);
  strcpy(lastTimeBuffer, timeBuffer); 
  
  // --- Status-Aufforderung ---
  tft.setTextColor(TFT_WHITE, TFT_BLACK); 
  tft.setTextDatum(MC_DATUM); 
  tft.setTextFont(4);
  tft.drawString("Bitte Karte auflegen", tft.width() / 2, tft.height() / 2 +60);
  
  Serial.println("Display: Layout gezeichnet.");
}

// Lade-Bildschirm
void displayProcessing() {
  tft.fillScreen(TFT_BLACK); 
  tft.setTextColor(TFT_DARKGREEN); 
  tft.setTextDatum(MC_DATUM);

  tft.setTextFont(4);    
  tft.drawString("Verarbeite...", tft.width() / 2, tft.height() / 2 - 10);
  
  // Die zweite Zeile war schon korrekt auf Font 4
  tft.drawString("Bitte warten", tft.width() / 2, tft.height() / 2 + 40);
  
  Serial.println("Display: Ladebildschirm angezeigt.");
}

// Ergebnis-Bildschirm
void displayResult(String line1, String line2, uint16_t color) {
  tft.fillScreen(TFT_BLACK); 
  tft.setTextColor(color); 
  
  // --- Zeile 1: Der Name (Groß) ---
  tft.setFreeFont(&FreeSansBold18pt7b); 
  tft.setTextDatum(TC_DATUM); 
  tft.drawString(line1, tft.width() / 2, 70);

  // --- Zeile 2: Status + Uhrzeit (Klein) ---
  tft.setTextFont(4); 
  tft.setTextDatum(BC_DATUM); 
  tft.drawString(line2, tft.width() / 2, tft.height() - 70);

  // Wichtig: Schriftart für den Rest des Programms zurücksetzen
  tft.setTextFont(1); 
  
  Serial.println("Display: Ergebnis " + line1 + " " + line2 + " angezeigt.");
}


void saveToSD(String cardId, String timestamp, String type) {
  // Wenn keine SD Karte da ist, abbrechen
  if(SD.cardType() == CARD_NONE) {
    Serial.println("SD INFO: Keine Karte gefunden.");
    return;
  }

  // Wir öffnen die Datei im "Append" Modus (Anhängen)
  File file = SD.open("/system.dat", FILE_APPEND);
  if(!file) {
    Serial.println("❌ SD FEHLER: Konnte Datei nicht öffnen!");
    return;
  }

  // JSON bauen
  JsonDocument doc;
  doc["cid"] = cardId;
  doc["ts"] = timestamp;
  doc["t"] = type; 
  
  String jsonString;
  serializeJson(doc, jsonString);

  // Verschlüsseln
  String encrypted = encryptDecrypt(jsonString);
  
  // Schreiben und Prüfen
  // file.println gibt zurück, wie viele Bytes geschrieben wurden.
  // Wenn > 0, war es erfolgreich.
  if (file.println(encrypted)) {
      Serial.println("✅ SD ERFOLG: Daten sicher verschlüsselt gespeichert.");
  } else {
      Serial.println("❌ SD FEHLER: Schreiben fehlgeschlagen!");
  }
  
  file.close();
}


// --- Server-Funktion (ANGEPASST für HTTPS) ---
void sendStampToServer(String cardId) {
  
  displayProcessing();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Fehler: WLAN nicht verbunden.");
    displayResult("Fehler", "Kein WLAN", TFT_RED);
  } else {
    
    // --- NEU: Secure Client für HTTPS ---
    WiFiClientSecure client;
    client.setInsecure(); // Wir vertrauen dem Zertifikat ohne Prüfung (Einfacher)
    
    HTTPClient http;
    // Wir übergeben den 'client' an http.begin!
    http.begin(client, serverName); 
    // ------------------------------------

    http.addHeader("Content-Type", "application/json"); 

    // --- SICHERHEITS LOGIK ---
    // Zeitstempel holen (wichtig gegen Replay Attacks)
    struct tm timeinfo;
    if(!getLocalTime(&timeinfo)){
        Serial.println("Konnte Zeit nicht holen!");
        return;
    }
    time_t now;
    time(&now); 
    
    String timestamp = String((unsigned long)now);
    String nonce = String(random(1000000)); // Zufallszahl

    // Signatur erstellen: cardId + timestamp + nonce
    String payloadData = cardId + ":" + timestamp + ":" + nonce;
    String signature = createHMAC(payloadData, device_secret);

    // JSON bauen
    JsonDocument doc;
    doc["cardId"] = cardId;
    doc["timestamp"] = timestamp;
    doc["nonce"] = nonce;
    doc["signature"] = signature;

    String jsonPayload;
    serializeJson(doc, jsonPayload);
    // --------------------------

    Serial.print("Sende Secure JSON: ");
    Serial.println(jsonPayload);

    int httpResponseCode = http.POST(jsonPayload);

    if (httpResponseCode > 0) {
      String payload = http.getString();
      Serial.println("Antwort erhalten: " + payload);

      if (httpResponseCode == 200) {
        JsonDocument docResponse;
        deserializeJson(docResponse, payload);
        
        // --- Sichere JSON-Prüfung (Dein Original-Code) ---
        String userName = "";
        String status = "";

        if (docResponse.containsKey("user") && !docResponse["user"].isNull()) {
            userName = docResponse["user"].as<String>();
        }

        if (docResponse.containsKey("type") && !docResponse["type"].isNull()) {
            status = docResponse["type"].as<String>();
        }
        // --- ENDE PRÜFUNG ---

        if (userName.length() > 0) {
          String line1 = userName;
          String line2_status;
          saveToSD(cardId, timeBuffer, status);
          if (status.length() == 0) {
            Serial.println("WARNUNG: Server-Antwort enthaelt keinen 'type' (Status).");
            line2_status = "Gebucht"; 
          } else {
            line2_status = status; 
          }

          String stampTime = timeBuffer; 
          String line2 = line2_status + " um " + stampTime + " Uhr";

          uint16_t displayColor = TFT_WHITE;
          
          displayResult(line1, line2, displayColor);

        } else {
          Serial.println("FEHLER: 'user' fehlt in JSON-Antwort oder ist null.");
          displayResult("Fehler", "Name (JSON)", TFT_RED); 
        }
      } else {
        displayResult("Fehler", "Karte ungueltig", TFT_RED); 
      }
    } else {
      Serial.print("Fehler bei HTTP POST. Code: ");
      Serial.println(httpResponseCode);
      displayResult("Fehler", "Server Fehler", TFT_RED); 
    }
    
    http.end(); 
  }

  delay(2500); 
  displayLayout(); 
}

String createHMAC(String data, const char* key) {
    byte hmacResult[32];
    mbedtls_md_context_t ctx;
    mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;
    
    mbedtls_md_init(&ctx);
    mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 1);
    mbedtls_md_hmac_starts(&ctx, (const unsigned char *) key, strlen(key));
    mbedtls_md_hmac_update(&ctx, (const unsigned char *) data.c_str(), data.length());
    mbedtls_md_hmac_finish(&ctx, hmacResult);
    mbedtls_md_free(&ctx);
    
    String hash = "";
    for(int i=0; i<32; i++){
        if(hmacResult[i] < 16) hash += "0";
        hash += String(hmacResult[i], HEX);
    }
    return hash;
}

// SETUP
void setup() {
  Serial.begin(115200); 
  delay(1000);
  Serial.println("=== ZES v7 START (Black Edition) ===");

  SPI.begin(); 

  Serial.println("Initialisiere TFT_eSPI Display...");
  tft.init();

  // --- Dein SD Code ---
  Serial.println("Initialisiere SD-Karte...");
  // Starte den zweiten Bus: sck=14, miso=12, mosi=13, ss=26
  sdSPI.begin(14, 27, 13, 26);


  if (!SD.begin(26,sdSPI,4000000)) {
    Serial.println("WARNUNG: Keine SD-Karte gefunden oder Fehler beim Initialisieren!");
  } else {
    Serial.println("SD-Karte erfolgreich initialisiert.");
    uint8_t cardType = SD.cardType();
    if(cardType == CARD_NONE){
        Serial.println("Keine SD-Karte eingelegt.");
    } else {
        Serial.print("SD-Kartentyp: ");
        if(cardType == CARD_MMC) Serial.println("MMC");
        else if(cardType == CARD_SD) Serial.println("SDSC");
        else if(cardType == CARD_SDHC) Serial.println("SDHC");
        else Serial.println("UNKNOWN");
        
        uint64_t cardSize = SD.cardSize() / (1024 * 1024);
        Serial.printf("SD-Kartengröße: %lluMB\n", cardSize);
    }
  }
  // --------------------

  tft.setRotation(1); 
  
  tft.fillScreen(TFT_BLACK); 
  tft.setTextColor(TFT_WHITE); 
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(4);
  tft.drawString("System startet...", tft.width()/2, tft.height()/2);
  
  Serial.print("Verbinde mit WLAN: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); 
    Serial.print(".");
  }
  Serial.println("\nErfolgreich mit WLAN verbunden!");

  Serial.println("Synchronisiere Uhrzeit...");
  configTime(3600, 3600, "pool.ntp.org");
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo)) {
    Serial.println("Warte auf Zeitsynchronisierung...");
    delay(1000);
  }
  Serial.println("Uhrzeit synchronisiert!");

  Serial.println("Initialisiere MFRC522-Leser...");
  mfrc522.PCD_Init(); 
  mfrc522.PCD_DumpVersionToSerial(); 

  displayLayout();

  Serial.println("-----------------------------------------");
  Serial.println("System bereit. Bitte Karte auflegen!");
  Serial.println("-----------------------------------------");
}

// LOOP (Dein originaler Loop)
void loop() {
  
  unsigned long currentTime = millis();

  // Uhrzeit aktualisieren
  if (currentTime - lastTimeUpdate > 1000) {
    lastTimeUpdate = currentTime;
    displayClockUpdate(); 
  }

  // 1. Auf neue Karte prüfen
  if ( ! mfrc522.PICC_IsNewCardPresent()) {
    return; 
  }
  // 2. Karten-UID lesen
  if ( ! mfrc522.PICC_ReadCardSerial()) {
    return; 
  }

  // 3. Karten-UID in String umwandeln
  String cardId = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) { cardId += "0"; }
    cardId += String(mfrc522.uid.uidByte[i], HEX);
  }
  cardId.toUpperCase(); 

  Serial.print("Karte erkannt! UID: ");
  Serial.println(cardId);

  // 4. Prüfen, ob dieselbe Karte zu schnell hintereinander gescannt wurde
  if (cardId == lastCardId && (currentTime - lastSendTime) < 5000) { 
    Serial.println("Doppelte Stempelung (innerhalb 5s), wird ignoriert.");
  } else {
    // 5. Stempelung an Server senden
    sendStampToServer(cardId); 
    lastCardId = cardId; 
    lastSendTime = currentTime; 
  }

  // 6. Karte "anhalten"
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
}