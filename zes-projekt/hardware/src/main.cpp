#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>
#include <LovyanGFX.hpp>
#include "mbedtls/md.h"

// --- 1. CONFIGURATION ---
const char* ssid = "MagentaWLAN-29Q3";
const char* password = "Esenha2022#";
const char* serverName = "https://ahmtimus.com/api/v1/stamp"; 
const char* device_secret = "MEIN_GEHEIMES_DEVICE_PASSWORT";

// --- 2. HARDWARE PINS (ESP32-S3) ---
#define MFRC522_SS_PIN  8
#define MFRC522_RST_PIN 3
#define AHMTIMUS_BLUE 0x19B1

// --- LovyanGFX Display Setup ---
class LGFX : public lgfx::LGFX_Device {
    lgfx::Panel_ILI9341 _panel_instance;
    lgfx::Bus_SPI _bus_instance;

public:
    LGFX(void) {
        {
            auto cfg = _bus_instance.config();
            cfg.spi_host = SPI2_HOST;
            cfg.spi_mode = 0;
            cfg.freq_write = 40000000;
            cfg.freq_read = 16000000;
            cfg.spi_3wire = false;
            cfg.use_lock = true;
            cfg.dma_channel = SPI_DMA_CH_AUTO;
            cfg.pin_sclk = 12;
            cfg.pin_mosi = 11;
            cfg.pin_miso = 13;
            cfg.pin_dc = 17;
            _bus_instance.config(cfg);
            _panel_instance.setBus(&_bus_instance);
        }

        {
            auto cfg = _panel_instance.config();
            cfg.pin_cs = 15;
            cfg.pin_rst = 16;
            cfg.pin_busy = -1;
            cfg.panel_width = 240;
            cfg.panel_height = 320;
            cfg.offset_x = 0;
            cfg.offset_y = 0;
            cfg.offset_rotation = 0;
            cfg.dummy_read_pixel = 8;
            cfg.dummy_read_bits = 1;
            cfg.readable = true;
            cfg.invert = false;
            cfg.rgb_order = false;
            cfg.dlen_16bit = false;
            cfg.bus_shared = true;
            _panel_instance.config(cfg);
        }

        setPanel(&_panel_instance);
    }
};

LGFX tft;
MFRC522 mfrc522(MFRC522_SS_PIN, MFRC522_RST_PIN);

String lastCardId = "";
unsigned long lastSendTime = 0;
char timeBuffer[6];
char dateBuffer[40];
char lastTimeBuffer[6] = "";
bool wifiConnected = false;
bool initialDrawDone = false; 

const char* daysOfWeek[7] = {"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"};
const char* monthsOfYear[12] = {"Januar", "Februar", "Maerz", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"};

// --- HELPER: ENCRYPTION ---
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

// --- DISPLAY LOGIC (LovyanGFX with smooth fonts!) ---
void displayResult(String line1, String line2, uint16_t color) {
    tft.fillScreen(TFT_BLACK);
    
    // User Name: Large font
    tft.setTextColor(color);
    tft.setFont(&fonts::FreeSansBold18pt7b);
    tft.setTextDatum(textdatum_t::top_center);
    tft.drawString(line1, tft.width() / 2, 70);
    
    // Status: Medium font
    tft.setTextColor(TFT_WHITE);
    tft.setFont(&fonts::Font4);
    tft.setTextDatum(textdatum_t::bottom_center);
    tft.drawString(line2, tft.width() / 2, tft.height() - 70);
}

void displayProcessing() {
    tft.fillScreen(TFT_BLACK);
    tft.setTextColor(TFT_DARKGREEN);
    tft.setTextDatum(textdatum_t::middle_center);
    tft.setFont(&fonts::Font4);
    tft.drawString("Verbinde...", tft.width()/2, tft.height()/2);
}

void displayLayout() {
    // 1. STATIC ELEMENTS (Draw Once)
    if (!initialDrawDone) {
        tft.fillScreen(TFT_BLACK);
        
        // Footer "AHMTIMUS (C)" - Font 2
        tft.setTextDatum(textdatum_t::bottom_left);
        tft.setTextColor(AHMTIMUS_BLUE);
        tft.setFont(&fonts::Font2);
        tft.drawString("AHMTIMUS (C)", 10, tft.height() - 10);
        
        // "Bitte Karte auflegen" - Font 4
        tft.setTextColor(TFT_WHITE);
        tft.setFont(&fonts::Font4);
        tft.setTextDatum(textdatum_t::middle_center);
        tft.drawString("Bitte Karte auflegen", tft.width() / 2, tft.height()/2 + 60);
        
        initialDrawDone = true;
    }

    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
        // 2. Date - FreeSans9pt7b (smooth!)
        sprintf(dateBuffer, "%s, %d. %s", daysOfWeek[timeinfo.tm_wday], timeinfo.tm_mday, monthsOfYear[timeinfo.tm_mon]);
        tft.setTextColor(TFT_WHITE);
        tft.setTextDatum(textdatum_t::middle_center);
        tft.setFont(&fonts::FreeSans9pt7b);
        tft.drawString(dateBuffer, tft.width() / 2, 133); 
        
        // 3. Time - Font 8 (LARGE & SMOOTH)
        strftime(timeBuffer, sizeof(timeBuffer), "%H:%M", &timeinfo);
        if(strcmp(timeBuffer, lastTimeBuffer) != 0) {
            tft.fillRect(0, 30, tft.width(), 80, TFT_BLACK); 
            tft.setFont(&fonts::Font8);
            tft.setTextColor(TFT_WHITE);
            tft.drawString(timeBuffer, tft.width() / 2, 70); 
            strcpy(lastTimeBuffer, timeBuffer);
        }
    }
}

void sendStampToServer(String cardId) {
    displayProcessing();
    
    if (WiFi.status() != WL_CONNECTED) {
        displayResult("Offline", "Kein WiFi!", TFT_RED); 
        delay(2000); 
        tft.fillScreen(TFT_BLACK);
        initialDrawDone = false; 
        displayLayout(); 
        return;
    }

    struct tm timeinfo; 
    getLocalTime(&timeinfo); 
    time_t now; 
    time(&now);
    String timestamp = String((unsigned long)now);

    WiFiClientSecure client; 
    client.setInsecure();
    HTTPClient http;
    
    Serial.println("Verbinde zu: " + String(serverName)); 

    if (!http.begin(client, serverName)) {
        displayResult("Server weg", "Lokal gesichert", TFT_RED); 
        delay(2000); 
        tft.fillScreen(TFT_BLACK);
        initialDrawDone = false; 
        displayLayout(); 
        return;
    }

    http.addHeader("Content-Type", "application/json");
    String nonce = String(random(1000000));
    String payloadData = cardId + ":" + timestamp + ":" + nonce;
    String signature = createHMAC(payloadData, device_secret);

    JsonDocument doc; 
    doc["cardId"] = cardId; 
    doc["timestamp"] = timestamp; 
    doc["nonce"] = nonce; 
    doc["signature"] = signature;
    String jsonPayload; 
    serializeJson(doc, jsonPayload);

    int httpResponseCode = http.POST(jsonPayload);
    
    if (httpResponseCode > 0) {
        String payload = http.getString();
        Serial.println("Antwort: " + payload);
        
        if (httpResponseCode == 200) {
            JsonDocument docResponse; 
            deserializeJson(docResponse, payload);
            const char* user = docResponse["user"]; 
            const char* type = docResponse["type"];
            
            // Display with timestamp
            String displayTime = String(timeBuffer);
            uint16_t color = (String(type) == "Kommen") ? TFT_GREEN : TFT_ORANGE;
            displayResult(String(user), String(type) + " " + displayTime, color);
        } else {
            JsonDocument docResponse; 
            deserializeJson(docResponse, payload);
            String msg = docResponse["message"]; 
            displayResult("Abgelehnt", msg, TFT_RED);
        }
    } else {
        displayResult("Fehler", String(httpResponseCode), TFT_RED);
    }
    
    http.end(); 
    delay(2500); 
    
    // Clear & Restore
    tft.fillScreen(TFT_BLACK);
    strcpy(lastTimeBuffer, ""); 
    initialDrawDone = false; 
    displayLayout();
}

void setup() {
    Serial.begin(115200);
    delay(500);

    // 1. INIT Display (LovyanGFX)
    tft.init();
    tft.setRotation(3);  // 180 degrees rotated (was 1, now 3)
    tft.setBrightness(255);
    
    // --- BOOT SEQUENCE ---
    tft.fillScreen(TFT_BLACK);
    tft.setTextColor(TFT_WHITE);
    tft.setTextDatum(textdatum_t::middle_center);
    tft.setFont(&fonts::Font4);
    tft.drawString("Cloud Sync...", tft.width()/2, tft.height()/2);
    
    // 2. WIFI
    Serial.print("Connecting WiFi...");
    WiFi.begin(ssid, password);
    int t = 0;
    while (WiFi.status() != WL_CONNECTED) { 
        delay(500); 
        Serial.print("."); 
        t++; 
        if(t > 20) { 
            wifiConnected = false; 
            break; 
        }
    }
    
    Serial.println(); 
    if(WiFi.status() == WL_CONNECTED) {
        wifiConnected = true;
        Serial.println("CONNECTED!"); 
        configTime(3600, 3600, "pool.ntp.org");
        delay(500);
    } else {
        Serial.println("FAILED!");
    }

    // 3. RFID
    SPI.begin();
    mfrc522.PCD_Init();
    if(mfrc522.PCD_PerformSelfTest()) { 
        Serial.println("RFID OK"); 
    } 
    mfrc522.PCD_Init();

    // Show Main Layout
    tft.fillScreen(TFT_BLACK);
    initialDrawDone = false; 
    displayLayout();
}

void loop() {
    static unsigned long lastTime = 0;
    
    // Update display every second
    if(millis() - lastTime > 1000) {
        lastTime = millis();
        if(wifiConnected) displayLayout();
    }

    if (!mfrc522.PICC_IsNewCardPresent()) return;
    if (!mfrc522.PICC_ReadCardSerial()) return;

    String cardId = "";
    for (byte i = 0; i < mfrc522.uid.size; i++) {
        if (mfrc522.uid.uidByte[i] < 0x10) cardId += "0";
        cardId += String(mfrc522.uid.uidByte[i], HEX);
    }
    cardId.toUpperCase();
    
    // Debounce (4 second window)
    if (cardId == lastCardId && (millis() - lastSendTime) < 4000) { 
        // Ignore duplicate reads
    } else {
        Serial.println("Karte: " + cardId);
        sendStampToServer(cardId);
        lastCardId = cardId;
        lastSendTime = millis();
    }
    
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
}