#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>

// Bibliotheken aus platformio.ini
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h> // Zum Senden von JSON

// --- 🔴🔴🔴 UNBEDINGT ANPASSEN 🔴🔴🔴 ---

// 1. Deine WLAN-Daten
const char* ssid = "MagentaWLAN-29Q3";
const char* password = "Esenha2022#";

// 2. Die IP-Adresse deines PCs (wo das Backend läuft)
//    Führe 'cmd' aus und tippe 'ipconfig', um deine 'IPv4-Adresse' zu finden
const char* serverName = "http://192.168.2.201:3001/api/v1/stamp"; 

// ---------------------------------------------------

// Pin-Definition für MFRC522 (basierend auf unserer Verkabelung)
#define RST_PIN   22  // Reset-Pin
#define SS_PIN    5    // Chip-Select-Pin (SDA)

// Globale Objekte
MFRC522 mfrc522(SS_PIN, RST_PIN);  
String lastCardId = ""; // Speichert die letzte Karten-ID
unsigned long lastSendTime = 0; // Speichert, wann zuletzt gesendet wurde

// Funktion, um die Stempelung an den Server zu senden
void sendStampToServer(String cardId) {
  
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverName);
    http.addHeader("Content-Type", "application/json"); // Sagen, dass wir JSON senden

    // JSON-Dokument erstellen (benötigt ArduinoJson)
    JsonDocument doc;
    doc["cardId"] = cardId;

    // JSON in einen String umwandeln
    String jsonPayload;
    serializeJson(doc, jsonPayload);

    Serial.print("Sende JSON an Server: ");
    Serial.println(jsonPayload);

    // HTTP POST-Anfrage senden
    int httpResponseCode = http.POST(jsonPayload);

    // Antwort vom Server auswerten
    if (httpResponseCode > 0) {
      String payload = http.getString();
      Serial.print("HTTP Antwort-Code: ");
      Serial.println(httpResponseCode);
      Serial.print("Antwort-Payload: ");
      Serial.println(payload); // z.B. {"status":"success","user":"Max Mustermann"}
    } else {
      Serial.print("Fehler bei HTTP POST. Code: ");
      Serial.println(httpResponseCode); // z.B. -1 (Connection refused)
    }
    
    http.end(); // Verbindung schließen
  } else {
    Serial.println("Fehler: WLAN nicht verbunden.");
  }
}

void setup() {
  Serial.begin(115200); // Startet den seriellen Monitor (für Debugging)
  delay(1000);

  // 1. Mit WLAN verbinden
  Serial.print("Verbinde mit WLAN: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); 
    Serial.print(".");
  }
  Serial.println("\nErfolgreich mit WLAN verbunden!");
  Serial.print("ESP32 IP-Adresse: ");
  Serial.println(WiFi.localIP());

  // 2. MFRC522 (NFC-Leser) initialisieren
  Serial.println("Initialisiere MFRC522-Leser...");
  SPI.begin(); // SPI-Bus starten
  mfrc522.PCD_Init(); // MFRC522 starten
  mfrc522.PCD_DumpVersionToSerial(); // Zeigt die Version im Monitor an
  Serial.println("-----------------------------------------");
  Serial.println("NFC-Leser ist bereit. Bitte Karte auflegen!");
  Serial.println("-----------------------------------------");
}

void loop() {
  // Loop schaut die ganze Zeit nach neuen Karten

  // 1. Prüfen, ob eine neue Karte vorhanden ist
  if ( ! mfrc522.PICC_IsNewCardPresent()) {
    delay(50); // Kurz warten, um CPU nicht zu überlasten
    return;    // Nichts zu tun, starte den Loop neu
  }

  // 2. Prüfen, ob die Karte gelesen werden kann
  if ( ! mfrc522.PICC_ReadCardSerial()) {
    delay(50);
    return;    // Karte war da, aber konnte nicht gelesen werden
  }

  // 3. Karte ist da! UID (Karten-ID) auslesen
  String cardId = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    // Führende Nullen hinzufügen (z.B. "A" wird "0A")
    if (mfrc522.uid.uidByte[i] < 0x10) { cardId += "0"; }
    cardId += String(mfrc522.uid.uidByte[i], HEX);
  }
  cardId.toUpperCase(); // Stellt sicher, dass alle Buchstaben groß sind (z.B. "BA59E52A")

  Serial.print("Karte erkannt! UID: ");
  Serial.println(cardId);

  // 4. "Entprellen" (Debouncing): Sende dieselbe Karte nicht 10x pro Sekunde
  unsigned long currentTime = millis(); // Aktuelle Millisekunden seit Start
  
  if (cardId == lastCardId && (currentTime - lastSendTime) < 5000) {
    // Dieselbe Karte wurde innerhalb der letzten 5 Sekunden schonmal gesendet
    Serial.println("Doppelte Stempelung, wird ignoriert.");
  } else {
    // Es ist eine NEUE Karte ODER es sind >5 Sekunden vergangen
    sendStampToServer(cardId);
    lastCardId = cardId; // Merke dir diese Karte
    lastSendTime = currentTime; // Merke dir die Sendezeit
  }

  // Wichtig: Karte "schlafen legen", damit sie als "neu" erkannt wird, wenn sie das nächste Mal kommt
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();

  Serial.println("-----------------------------------------");
}