#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>

#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h> 
#include <TFT_eSPI.h> 


// --- Angepasste Farbpalette ---
#define AHMTIMUS_DARK   0x08C5 // Nicht mehr verwendet
#define AHMTIMUS_LIGHT  0xFFDF // Nicht mehr verwendet
#define AHMTIMUS_BLUE   0x19B1  // (Hex: #1e3a8a) - Für das Logo
// ----------------------------------------

// --- DEINE DATEN (bleiben gleich) ---
const char* ssid = "Apartment A110";
const char* password = "83748813000626132739";
const char* serverName = "http://192.168.178.28:3001/api/v1/stamp"; 

// --- Pin-Definition für MFRC522 ---
#define MFRC522_RST_PIN  4
#define MFRC522_SS_PIN   5  

// --- Globale Objekte ---
MFRC522 mfrc522(MFRC522_SS_PIN, MFRC522_RST_PIN); 
TFT_eSPI tft = TFT_eSPI(); 
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

// Lade-Bildschirm (KORRIGIERT: Verwendet Font 4 statt 7)
void displayProcessing() {
  tft.fillScreen(TFT_BLACK); 
  tft.setTextColor(TFT_DARKGREEN); 
  tft.setTextDatum(MC_DATUM);

  // tft.setTextFont(7); // <--- WAR FALSCH (kann keine Buchstaben)
  tft.setTextFont(4);    // <--- KORREKT (kann Buchstaben)
  tft.drawString("Verarbeite...", tft.width() / 2, tft.height() / 2 - 10);
  
  // Die zweite Zeile war schon korrekt auf Font 4
  tft.drawString("Bitte warten", tft.width() / 2, tft.height() / 2 + 40);
  
  Serial.println("Display: Ladebildschirm angezeigt.");
}
// Ergebnis-Bildschirm (KORRIGIERT: Verwendet GFXFF-Font und manuelle Positionierung)
void displayResult(String line1, String line2, uint16_t color) {
  tft.fillScreen(TFT_BLACK); 
  tft.setTextColor(color); 
  
  // --- Zeile 1: Der Name (Groß) ---
  // Wir verwenden die GFX-Schriftart, die Buchstaben kann
  tft.setFreeFont(&FreeSansBold18pt7b); 
  // Text-Anker auf "Mitte Oben" (Middle Top) setzen
  tft.setTextDatum(TC_DATUM); 
  // Manuell positionieren: mittig (X = width/2), und 70 Pixel von oben (Y = 70)
  tft.drawString(line1, tft.width() / 2, 70);


  // --- Zeile 2: Status + Uhrzeit (Klein) ---
  // Wir wechseln zurück zur normalen Schriftart 4
  tft.setTextFont(4); 
  // Text-Anker auf "Mitte Unten" (Bottom Center)
  tft.setTextDatum(BC_DATUM); 
  // Manuell positionieren: mittig (X = width/2), und 70 Pixel von unten (Y = height - 70)
  tft.drawString(line2, tft.width() / 2, tft.height() - 70);

  // Wichtig: Schriftart für den Rest des Programms zurücksetzen
  tft.setTextFont(1); 
  
  Serial.println("Display: Ergebnis " + line1 + " " + line2 + " angezeigt.");
}

// --- Server-Funktion (ANGEPASST: Robuste JSON-Prüfung) ---
void sendStampToServer(String cardId) {
  
  displayProcessing();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Fehler: WLAN nicht verbunden.");
    displayResult("Fehler", "Kein WLAN", TFT_RED);
  } else {
    HTTPClient http;
    http.begin(serverName);
    http.addHeader("Content-Type", "application/json"); 

    JsonDocument doc;
    doc["cardId"] = cardId;
    String jsonPayload;
    serializeJson(doc, jsonPayload);

    Serial.print("Sende JSON an Server: ");
    Serial.println(jsonPayload);

    int httpResponseCode = http.POST(jsonPayload);

    if (httpResponseCode > 0) {
      String payload = http.getString();
      Serial.println("Antwort erhalten: " + payload);

      if (httpResponseCode == 200) {
        JsonDocument docResponse;
        deserializeJson(docResponse, payload);
        
        // --- NEU: Sichere JSON-Prüfung ---
        String userName = "";
        String status = "";

        // 1. 'user' sicher auslesen
        // Prüft, ob der Schlüssel "user" existiert UND ob er nicht 'null' ist
        if (docResponse.containsKey("user") && !docResponse["user"].isNull()) {
            userName = docResponse["user"].as<String>();
        }

        // 2. 'type' sicher auslesen
        // Prüft, ob der Schlüssel "type" existiert UND ob er nicht 'null' ist
        if (docResponse.containsKey("type") && !docResponse["type"].isNull()) {
            status = docResponse["type"].as<String>();
        }
        // --- ENDE NEUE PRÜFUNG ---


        // 3. Logik wie zuvor, aber jetzt mit sauberen Variablen
        if (userName.length() > 0) {
          
          // Zeile 1 (Groß) = Name
          String line1 = userName;

          // Zeile 2 (Klein) = Status + Uhrzeit
          String line2_status;
          
          if (status.length() == 0) { // Wenn 'type' fehlte oder null war
            Serial.println("WARNUNG: Server-Antwort enthaelt keinen 'type' (Status).");
            line2_status = "Gebucht"; // Fallback-Text
          } else {
            line2_status = status; // z.B. "Kommen" oder "Gehen"
          }

          String stampTime = timeBuffer; 
          String line2 = line2_status + " um " + stampTime + " Uhr";

          uint16_t displayColor = TFT_WHITE;
          
          displayResult(line1, line2, displayColor);

        } else {
          // Dieser Block wird jetzt korrekt ausgelöst, wenn 'user' fehlt oder null ist
          Serial.println("FEHLER: 'user' fehlt in JSON-Antwort oder ist null.");
          displayResult("Fehler", "Name (JSON)", TFT_RED); 
        }
      } else {
        displayResult("Fehler", "Karte ungueltig", TFT_RED); 
      }
    } else {
      Serial.print("Fehler bei HTTP POST. Code: ");
      Serial.println(httpResponseCode);
      displayResult("Fehler", "Server nicht erreichbar", TFT_RED); 
    }
    
    http.end(); 
  }

  delay(2500); 
  displayLayout(); 
}


// SETUP (unverändert)
void setup() {
  Serial.begin(115200); 
  delay(1000);
  Serial.println("=== ZES v7 START (Black Edition) ===");

  SPI.begin(); 

  Serial.println("Initialisiere TFT_eSPI Display...");
  tft.init();
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

// LOOP (ANGEPASST für die Sperrzeit-Logik)
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
  // HINWEIS: Die Zeit wurde von 'lastTimeUpdate' auf 'lastSendTime' korrigiert
  if (cardId == lastCardId && (currentTime - lastSendTime) < 5000) { 
    Serial.println("Doppelte Stempelung (innerhalb 5s), wird ignoriert.");
  } else {
    // 5. Stempelung an Server senden
    sendStampToServer(cardId); 
    lastCardId = cardId; 
    lastSendTime = currentTime; 
  }

  // 6. Karte "anhalten" und für nächsten Scan vorbereiten
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  // Serial.println("-----------------------------------------"); // Optional: Weniger Spam in der Konsole
}