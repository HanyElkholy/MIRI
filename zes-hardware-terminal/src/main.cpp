#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>

#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h> 
#include <TFT_eSPI.h> // Die funktionierende Display-Bibliothek

// --- DEINE DATEN (Aus deinem letzten Code) ---
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
unsigned long lastTimeUpdate = 0; // Wann wurde die Uhr zuletzt aktualisiert?
char timeBuffer[9]; // Speicher für "HH:MM:SS"


// --- DISPLAY-FUNKTIONEN ---

// NEU: Funktion zur Aktualisierung der Uhrzeit (ohne den Rest zu löschen)
void displayTimeUpdate() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return; // Zeit noch nicht synchron
  }
  
  // Zeit als "HH:MM:SS" formatieren
  strftime(timeBuffer, sizeof(timeBuffer), "%H:%M:%S", &timeinfo);
  
  // Schwarzes Rechteck über die alte Uhrzeit malen (verhindert Flackern)
  tft.fillRect(tft.width() - 110, 5, 105, 25, TFT_BLACK); 
  
  tft.setTextColor(TFT_WHITE);
  tft.setTextDatum(TR_DATUM); // Top Right
  tft.setTextFont(4); 
  tft.drawString(timeBuffer, tft.width() - 10, 10);
}

// ANGEPASST: Der Haupt-Bildschirm (Layout)
void displayLayout() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextDatum(MC_DATUM); // Text zentrieren
  
  // 1. Logo (Oben Links)
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setTextFont(4); 
  tft.setTextDatum(TL_DATUM); // Top Left
  tft.drawString("ZES", 10, 10);
  
  tft.setTextFont(2);
  tft.setTextColor(TFT_DARKGREY);
  tft.drawString("AHMTIMUS", 10, 40);

  // 2. Uhrzeit (Oben Rechts)
  displayTimeUpdate(); // Uhrzeit sofort zeichnen
  
  // 3. Status (Mitte)
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextDatum(MC_DATUM); // Wieder zentrieren
  tft.setTextFont(4);
  tft.drawString("Bitte Karte", tft.width() / 2, tft.height() / 2 + 10);
  tft.drawString("auflegen", tft.width() / 2, tft.height() / 2 + 40);
  
  Serial.println("Display: Layout gezeichnet.");
}

// NEU: Lade-Bildschirm (blockierend)
void displayProcessing() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_ORANGE);
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(4);
  tft.drawString("Verarbeite...", tft.width() / 2, tft.height() / 2 - 10);
  tft.drawString("Bitte warten", tft.width() / 2, tft.height() / 2 + 30);
  Serial.println("Display: Ladebildschirm angezeigt.");
}

// NEU: Ergebnis-Bildschirm (blockierend)
void displayResult(String line1, String line2, uint16_t color) {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(color); // Grüne oder Rote Schrift
  tft.setTextDatum(MC_DATUM);
  
  tft.setTextFont(7); // Große Schrift
  tft.drawString(line1, tft.width() / 2, tft.height() / 2 - 30);
  
  tft.setTextFont(4); // Kleinere Schrift
  tft.drawString(line2, tft.width() / 2, tft.height() / 2 + 40);
  
  Serial.println("Display: Ergebnis " + line1 + " " + line2 + " angezeigt.");
}


// ANGEPASST: Server-Funktion steuert jetzt das blockierende UI
void sendStampToServer(String cardId) {
  
  // SCHRITT 1: Ladebildschirm anzeigen
  displayProcessing();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Fehler: WLAN nicht verbunden.");
    displayResult("Fehler", "Kein WLAN", TFT_RED);
    delay(3000);
    displayLayout(); // Zurück zum Hauptmenü
    return;
  }

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

  // SCHRITT 2: Ergebnis verarbeiten
  if (httpResponseCode > 0) {
    String payload = http.getString();
    Serial.println("Antwort erhalten: " + payload);

    if (httpResponseCode == 200) {
      JsonDocument docResponse;
      deserializeJson(docResponse, payload);
      String userName = docResponse["user"]; 
      
      if (userName.length() > 0) {
        displayResult("Erfolgreich", "Willkommen, " + userName, TFT_GREEN);
      } else {
        displayResult("Fehler", "Name (JSON)", TFT_RED); 
      }
    } else {
      displayResult("Fehler", "Karte ungueltig", TFT_ORANGE); // z.B. 404
    }
  } else {
    Serial.print("Fehler bei HTTP POST. Code: ");
    Serial.println(httpResponseCode);
    displayResult("Fehler", "Server nicht erreichbar", TFT_RED); // z.B. -1
  }
  
  http.end(); 

  // SCHRITT 3: Ergebnis anzeigen und zurück zum Hauptmenü
  delay(2500); // Ergebnis 2.5 Sek. anzeigen
  displayLayout(); // Zurück zum Haupt-Bildschirm
}

// SETUP (mit NTP-Zeitsynchronisierung)
void setup() {
  Serial.begin(115200); 
  delay(1000);
  Serial.println("=== ZES v4 START (Mit Ladebildschirm) ===");

  SPI.begin(); 

  Serial.println("Initialisiere TFT_eSPI Display...");
  tft.init();
  tft.setRotation(1); 
  tft.setTextFont(4); 
  
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE);
  tft.setTextDatum(MC_DATUM);
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

  // 4. MFRC522 (NFC-Leser) initialisieren
  Serial.println("Initialisiere MFRC522-Leser...");
  mfrc522.PCD_Init(); 
  mfrc522.PCD_DumpVersionToSerial(); 

  // 5. Finales Layout zeichnen
  displayLayout();

  Serial.println("-----------------------------------------");
  Serial.println("System bereit. Bitte Karte auflegen!");
  Serial.println("-----------------------------------------");
}

// ANGEPASSTE, VEREINFACHTE LOOP
void loop() {
  
  unsigned long currentTime = millis();

  // --- TEIL 1: Uhrzeit aktualisieren (jede Sekunde) ---
  if (currentTime - lastTimeUpdate > 1000) {
    lastTimeUpdate = currentTime;
    displayTimeUpdate(); // Funktion zum Zeichnen der Uhr aufrufen
  }

  // --- TEIL 2: NFC-Karte prüfen (so oft wie möglich) ---
  if ( ! mfrc522.PICC_IsNewCardPresent()) {
    return; // Nichts zu tun
  }
  if ( ! mfrc522.PICC_ReadCardSerial()) {
    return; // Lesefehler
  }

  // Karte ist da! UID auslesen
  String cardId = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) { cardId += "0"; }
    cardId += String(mfrc522.uid.uidByte[i], HEX);
  }
  cardId.toUpperCase(); 

  Serial.print("Karte erkannt! UID: ");
  Serial.println(cardId);

  // "Entprellen" (Debouncing)
  if (cardId == lastCardId && (currentTime - lastSendTime) < 5000) {
    Serial.println("Doppelte Stempelung, wird ignoriert.");
  } else {
    // Diese Funktion blockiert jetzt das Display,
    // zeigt "Laden", "Ergebnis" und kehrt dann zum Layout zurück.
    sendStampToServer(cardId); 
    
    lastCardId = cardId; 
    lastSendTime = currentTime; 

    // MFRC522 nach der Server-Kommunikation re-initialisieren
    mfrc522.PCD_Init();
  }

  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  Serial.println("-----------------------------------------");
}