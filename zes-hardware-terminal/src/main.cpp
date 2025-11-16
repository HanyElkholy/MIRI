#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>

#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h> 
#include <TFT_eSPI.h> // Die funktionierende Display-Bibliothek

// --- DEINE DATEN (Aus deinem letzten Code) ---
const char* ssid = "FRITZ!Box 7520 FW";
const char* password = "27789451587160632705";
const char* serverName = "http://192.168.178.107:3001/api/v1/stamp"; 

// --- Pin-Definition für MFRC522 ---
// (Die SPI-Pins 18, 19, 23 werden geteilt)
#define MFRC522_RST_PIN  4   // NEUER PIN! (war 22, aber 22 ist jetzt TFT_CS)
#define MFRC522_SS_PIN   5   

// --- Globale Objekte ---
MFRC522 mfrc522(MFRC522_SS_PIN, MFRC522_RST_PIN); 
TFT_eSPI tft = TFT_eSPI(); // Das Display-Objekt
String lastCardId = "";
unsigned long lastSendTime = 0;


// --- DISPLAY-FUNKTIONEN (Angepasst an TFT_eSPI) ---

void displayWelcome() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setTextDatum(MC_DATUM); // MC_DATUM = Middle Center (Text zentrieren)
  
  tft.setTextFont(4); // Lade Schriftart 4
  tft.drawString("AHMTIMUS ZES", tft.width() / 2, tft.height() / 2 - 50);
  
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.drawString("Bitte Karte", tft.width() / 2, tft.height() / 2 + 10);
  tft.drawString("auflegen", tft.width() / 2, tft.height() / 2 + 40);
  
  tft.setTextFont(1); // Zurück auf Standard-Schrift
  Serial.println("Display: Welcome-Screen angezeigt.");
}

void displaySuccess(String name) {
  tft.fillScreen(TFT_GREEN);
  tft.setTextColor(TFT_BLACK, TFT_GREEN);
  tft.setTextDatum(MC_DATUM); 
  
  tft.setTextFont(7); // Lade Schriftart 7 (aus build_flags)
  tft.drawString("Willkommen,", tft.width() / 2, tft.height() / 2 - 30);
  tft.drawString(name, tft.width() / 2, tft.height() / 2 + 30);
  
  tft.setTextFont(1); 
  Serial.println("Display: Erfolg angezeigt.");
  
  delay(2500);
  displayWelcome();
}

void displayError(String error) {
  tft.fillScreen(TFT_RED);
  tft.setTextColor(TFT_WHITE, TFT_RED);
  tft.setTextDatum(MC_DATUM);

  tft.setTextFont(7); 
  tft.drawString("FEHLER", tft.width() / 2, tft.height() / 2 - 30);
  
  tft.setTextFont(4); 
  tft.drawString(error, tft.width() / 2, tft.height() / 2 + 30);
  
  tft.setTextFont(1); 
  Serial.println("Display: Fehler angezeigt.");

  delay(2500);
  displayWelcome();
}


// --- Server-Funktion (unverändert) ---
void sendStampToServer(String cardId) {
  
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Fehler: WLAN nicht verbunden.");
    displayError("Kein WLAN");
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

  if (httpResponseCode > 0) {
    String payload = http.getString();
    Serial.println("Antwort erhalten:");
    Serial.println(payload);

    if (httpResponseCode == 200) {
      JsonDocument docResponse;
      deserializeJson(docResponse, payload);
      String userName = docResponse["user"]; 
      
      if (userName.length() > 0) {
        displaySuccess(userName);
      } else {
        displayError("Fehler: Name"); 
      }
    } else {
      displayError("Karte ungueltig"); // z.B. 404
    }
  } else {
    Serial.print("Fehler bei HTTP POST. Code: ");
    Serial.println(httpResponseCode);
    displayError("Server-Fehler"); // z.B. -1
  }
  
  http.end(); 
}

// --- SETUP (Zusammengeführt) ---
void setup() {
  Serial.begin(115200); 
  delay(1000);
  Serial.println("=== FULL STACK ZES START ===");

  // WICHTIG: SPI-Bus starten (nur einmal!)
  SPI.begin(); 

  // 1. Display initialisieren
  Serial.println("Initialisiere TFT_eSPI Display...");
  tft.init();
  tft.setRotation(1); // 0=Portrait, 1=Landscape, 2=Portrait(180), 3=Landscape(180)
  tft.setTextFont(4); 
  displayWelcome(); 

  // 2. Mit WLAN verbinden
  Serial.print("Verbinde mit WLAN: ");
  Serial.println(ssid);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.setTextDatum(BL_DATUM); // Bottom-Left Datum
  tft.setTextFont(2); // Kleine Schrift (Font 2)
  tft.drawString("Verbinde WLAN...", 10, tft.height() - 10);
  
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); 
    Serial.print(".");
  }
  Serial.println("\nErfolgreich mit WLAN verbunden!");
  displayWelcome(); // WLAN-Text überschreiben

  // 3. MFRC522 (NFC-Leser) initialisieren
  Serial.println("Initialisiere MFRC522-Leser...");
  mfrc522.PCD_Init(); 
  mfrc522.PCD_DumpVersionToSerial(); 
  Serial.println("-----------------------------------------");
  Serial.println("NFC-Leser ist bereit. Bitte Karte auflegen!");
  Serial.println("-----------------------------------------");
}

// --- LOOP (Unverändert) ---
void loop() {
  if ( ! mfrc522.PICC_IsNewCardPresent()) {
    delay(50); 
    return;
  }
  if ( ! mfrc522.PICC_ReadCardSerial()) {
    delay(50);
    return;
  }

  String cardId = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) { cardId += "0"; }
    cardId += String(mfrc522.uid.uidByte[i], HEX);
  }
  cardId.toUpperCase(); 

  Serial.print("Karte erkannt! UID: ");
  Serial.println(cardId);

  unsigned long currentTime = millis();
  if (cardId == lastCardId && (currentTime - lastSendTime) < 5000) {
    Serial.println("Doppelte Stempelung, wird ignoriert.");
  } else {
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