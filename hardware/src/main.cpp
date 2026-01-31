#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>
#include <LovyanGFX.hpp>
#include <SD.h>
#include <FS.h>
#include <WiFiManager.h>

// Encryption & OTA Includes
#include "mbedtls/aes.h"
#include "mbedtls/base64.h"
#include "mbedtls/md.h"
#include <vector>
#include "OTAManager.h"


// --- CONFIGURATION ---
// --- CONFIGURATION ---
// const char* ssid = "MagentaWLAN-29Q3"; // REMOVED FOR WIFIMANAGER
// const char* password = "Esenha2022#"; // REMOVED FOR WIFIMANAGER
const char* serverName = "https://ahmtimus.com/api/v1/stamp"; 
const char* device_secret = "MEIN_GEHEIMES_DEVICE_PASSWORT";
const String SD_SECRET = "AHMTIMUS_SECURE_KEY_2025";
const char* otaVersionUrl = "https://ahmtimus.com/Miri/ota/version.txt";
const char* otaBinaryUrl = "https://ahmtimus.com/Miri/ota/firmware.bin";
const String ADMIN_CARD_ID = "24080D06"; 

// --- CERTIFICATES ---
// TODO: Replace with real Root CA for ahmtimus.com
// TODO: Replace with real Root CA for ahmtimus.com (ISRG Root X1)
// NOTE: Use \n inside the string for newlines, NOT broken lines
const char* rootCA_cert = \
"-----BEGIN CERTIFICATE-----\n" \
"MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw\n" \
"TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh\n" \
"cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4\n" \
"WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu\n" \
"ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY\n" \
"MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oLxfzQmGWeLpZI6J1\n" \
"7DonJl6CX4NkTA6kingphRG1tUgwL15dy9fWdQMkCXV1d6240E902V8Q0mP43019\n" \
"+MSzMOlX8KkX9q6o1eX4fD1g1j24FsMH+INFp932JOq9JIn0059882tIwJ53amOP\n" \
"tA8q5MA0E1gFkK7O1r7Qh0f7O2Nf5I85TV5lS8sZ993cO983c2G75T7lI5I2j68z\n" \
"0f3I8s3I5I5301853I5301853I5301853I5301853I5301853I5301853I530185\n" \
"3I5301853I5301853I5301853I5301853I5301853I5301853I5301853I530185\n" \
"3I5301853I5301853I5301853I5301853I5301853I5301853I5301853I530185\n" \
"3I5301853I5301853I5301853I5301853I5301853I5301853I5301853I530185\n" \
"3I5301853I5301853I5301853I5301853I5301853I5301853I5301853I530185\n" \
"3I5301853I5301853I5301853I5301853I5301853I5301853I5301853I530185\n" \
"3I5301853I5301853I5301853I5301853I5301853I5301853I5301853I530185\n" \
"-----END CERTIFICATE-----\n";

// --- PINS ---
#define MFRC522_SS_PIN  8
#define MFRC522_RST_PIN 3
#define SD_CS_PIN       40
#define SD_MOSI_PIN     35
#define SD_MISO_PIN     37
#define SD_SCK_PIN      36
#define AHMTIMUS_BLUE   0x19B1

// --- OBJECTS ---
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
            // cfg.pin_bl = -1; // IMPOSSIBLE: Schematic shows LED wired to 5V. Dimming disabled.
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
LGFX_Sprite sprite(&tft);
MFRC522 mfrc522(MFRC522_SS_PIN, MFRC522_RST_PIN);
SPIClass sdSPI(HSPI);
OTAManager otaManager;

// --- GLOBALS ---
String lastCardId = "";
unsigned long lastSendTime = 0;
char timeBuffer[6];
char dateBuffer[40];
bool wifiConnected = false;
bool sdAvailable = false;

// --- SCREEN SAVER GLOBALS ---
unsigned long lastActivityTime = 0;
bool isDimmed = false;
const int BRIGHTNESS_ACTIVE = 255;
const int BRIGHTNESS_DIM = 10;
const unsigned long DIM_TIMEOUT = 300000; // 5 minutes

// --- OFFLINE SYNC GLOBALS ---
unsigned long lastSyncTime = 0;
const unsigned long SYNC_INTERVAL = 60000; // Check every 60s

const char* daysOfWeek[7] = {"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"};
const char* monthsOfYear[12] = {"Januar", "Februar", "Maerz", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"};

// --- ENCRYPTION HELPER ---
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

String encryptDecrypt(String input) {
    char key[SD_SECRET.length() + 1];
    SD_SECRET.toCharArray(key, sizeof(key));
    String output = input;
    for (int i = 0; i < input.length(); i++) {
        output[i] = input[i] ^ key[i % (sizeof(key) - 1)];
    }
    return output;
}

// --- SD STORAGE ---
void saveToSD(String cardId, String timestamp, String type) {
    if(!sdAvailable) return;
    File file = SD.open("/system.dat", FILE_APPEND);
    if(file) {
        JsonDocument doc;
        doc["cid"] = cardId; 
        doc["ts"] = timestamp; 
        doc["t"] = type;
        String jsonString; 
        serializeJson(doc, jsonString);
        file.println(encryptDecrypt(jsonString));
        file.close();
        Serial.println("Saved to SD: " + type);
    }
}

// --- DISPLAY FUNCTIONS ---
void drawWifiSignal(LGFX_Sprite* spr) {
    int x = spr->width() - 35, y = 5, w = 4, gap = 2;
    int32_t rssi = WiFi.RSSI();
    int bars = 0;
    
    if (WiFi.status() == WL_CONNECTED) {
        if (rssi > -55) bars = 4;
        else if (rssi > -65) bars = 3;
        else if (rssi > -75) bars = 2;
        else if (rssi > -85) bars = 1;
    }

    for (int i = 0; i < 4; i++) {
        int height = 4 + (i * 4);
        uint16_t color = (i < bars) ? TFT_WHITE : TFT_DARKGREY;
        spr->fillRect(x + (i * (w + gap)), 20 - height + y, w, height, color);
    }
}

void displayResult(String line1, String line2, uint16_t color) {
    tft.fillScreen(TFT_BLACK);
    
    // LOGO - PERSISTENT
    tft.setTextDatum(textdatum_t::bottom_left);
    tft.setTextColor(AHMTIMUS_BLUE);
    tft.setFont(&fonts::Font2);
    tft.drawString("AHMTIMUS (C)", 10, tft.height() - 10);

    tft.setTextColor(color);
    tft.setFont(&fonts::FreeSansBold18pt7b);
    tft.setTextDatum(textdatum_t::top_center);
    tft.drawString(line1, tft.width() / 2, 70);
    
    tft.setTextColor(TFT_WHITE);
    tft.setFont(&fonts::Font4);
    tft.setTextDatum(textdatum_t::bottom_center);
    tft.drawString(line2, tft.width() / 2, tft.height() - 70);
}

void displayProcessing() {
    tft.fillScreen(TFT_BLACK);
    
    // LOGO - PERSISTENT
    tft.setTextDatum(textdatum_t::bottom_left);
    tft.setTextColor(AHMTIMUS_BLUE);
    tft.setFont(&fonts::Font2);
    tft.drawString("AHMTIMUS (C)", 10, tft.height() - 10);

    tft.setTextColor(TFT_DARKGREEN);
    tft.setTextDatum(textdatum_t::middle_center);
    tft.setFont(&fonts::Font4);
    tft.drawString("Verbinde...", tft.width()/2, tft.height()/2);
}

void displayLayout() {
    sprite.fillScreen(TFT_BLACK);
    
    sprite.setTextDatum(textdatum_t::bottom_left);
    sprite.setTextColor(AHMTIMUS_BLUE);
    sprite.setFont(&fonts::Font2);
    sprite.drawString("AHMTIMUS (C)", 10, sprite.height() - 10);
    
    sprite.setTextColor(TFT_WHITE);
    sprite.setFont(&fonts::Font4);
    sprite.setTextDatum(textdatum_t::middle_center);
    sprite.drawString("Bitte Karte auflegen", sprite.width() / 2, sprite.height()/2 + 60);

    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
        sprintf(dateBuffer, "%s, %d. %s", daysOfWeek[timeinfo.tm_wday], timeinfo.tm_mday, monthsOfYear[timeinfo.tm_mon]);
        sprite.setTextColor(TFT_WHITE);
        sprite.setTextDatum(textdatum_t::middle_center);
        sprite.setFont(&fonts::FreeSans9pt7b);
        sprite.drawString(dateBuffer, sprite.width() / 2, 133); 
        
        strftime(timeBuffer, sizeof(timeBuffer), "%H:%M", &timeinfo);
        sprite.setFont(&fonts::Font8);
        sprite.setTextColor(TFT_WHITE);
        sprite.drawString(timeBuffer, sprite.width() / 2, 70); 
    }
    
    drawWifiSignal(&sprite);
    sprite.pushSprite(0, 0);
}

// --- NETWORK SYNC ---
void sendStampToServer(String cardId) {
    displayProcessing();
    
    struct tm timeinfo; 
    getLocalTime(&timeinfo); 
    String timestamp = String((unsigned long)mktime(&timeinfo));

    saveToSD(cardId, timestamp, "ATTEMPT");

    if (WiFi.status() != WL_CONNECTED) {
        displayResult("Offline", "Offline gesichert", TFT_ORANGE); 
        delay(4000); 
        displayLayout(); 
        return;
    }

    WiFiClientSecure client; 
    client.setInsecure();
    HTTPClient http;
    
    if (!http.begin(client, serverName)) {
        displayResult("Server weg", "Lokal gesichert", TFT_RED); 
        delay(4000); 
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

    int httpCode = http.POST(jsonPayload);
    
    if (httpCode == 200) {
        String payload = http.getString();
        JsonDocument docResponse; 
        deserializeJson(docResponse, payload);
        const char* user = docResponse["user"]; 
        const char* type = docResponse["type"];
        
        saveToSD(cardId, timestamp, String(type));
        
        uint16_t color = (String(type) == "Kommen") ? TFT_GREEN : TFT_ORANGE;
        displayResult(String(user), String(type) + " " + String(timeBuffer), color);
        
    } else if (httpCode == 404) {
        // Handle Unknown Card specifically
        saveToSD(cardId, timestamp, "UNKNOWN_CARD");
        displayResult("Fehler", "Unbekannte Karte", TFT_RED);
        
    } else if (httpCode > 0) {
        // Try to read server error message
        String payload = http.getString();
        JsonDocument docResponse;
        DeserializationError error = deserializeJson(docResponse, payload);
        
        if (!error && docResponse["message"].is<const char*>()) {
            String msg = docResponse["message"];
            displayResult("Fehler", msg, TFT_RED);
            saveToSD(cardId, timestamp, "ERR_MSG: " + msg);
        } else {
             displayResult("Fehler", "Code: " + String(httpCode), TFT_RED);
             saveToSD(cardId, timestamp, "HTTP_ERR_" + String(httpCode));
        }
    } else {
        saveToSD(cardId, timestamp, "CONN_ERR");
        displayResult("Netzwerk", "Fehler", TFT_RED);
    }
    
    http.end(); 
    delay(5000); 
    displayLayout();
}

// --- SCREEN SAVER ---
void wakeUp() {
    lastActivityTime = millis();
    if (isDimmed) {
        isDimmed = false;
        setCpuFrequencyMhz(240); // Restore full speed
        displayLayout();
        Serial.println("Wake Up!");
    }
}

void enterEcoMode() {
    isDimmed = true;
    setCpuFrequencyMhz(80); // Drop to 80MHz to save power
    tft.fillScreen(TFT_BLACK);
    Serial.println("Eco Mode: CPU 80MHz");
}

void drawEcoSaver() {
    static int x = tft.width() / 2;
    static int y = tft.height() / 2;
    static int dx = 2, dy = 2;
    
    // Clear previous small area or just assume black background
    // We can use XOR or just clear previous
    sprite.fillScreen(TFT_BLACK);
    sprite.setTextColor(AHMTIMUS_BLUE); // Use Brand Color
    sprite.setFont(&fonts::Font4);
    sprite.setTextDatum(textdatum_t::middle_center);
    sprite.drawString("Ahmtimus(c)", x, y);
    sprite.pushSprite(0, 0);

    // Calculate dynamic bounds based on text size
    int textHalfWidth = tft.textWidth("Ahmtimus(c)", &fonts::Font4) / 2;
    int textHalfHeight = tft.fontHeight(&fonts::Font4) / 2;

    x += dx; y += dy;
    
    // Bounds check with padding
    if (x <= textHalfWidth + 5 || x >= tft.width() - textHalfWidth - 5) dx = -dx;
    if (y <= textHalfHeight + 5 || y >= tft.height() - textHalfHeight - 5) dy = -dy;
    
    // delay(50); // REMOVED: Blocking delay prevents RFID read!
}

void checkInactivity() {
    if (!isDimmed && (millis() - lastActivityTime > DIM_TIMEOUT)) {
        enterEcoMode();
    }
}

// --- OFFLINE SYNC ---
void syncOfflineData() {
    if (WiFi.status() != WL_CONNECTED || !sdAvailable) return;
    
    // Rename system.dat to uploading.dat to prevent write conflicts
    if (!SD.exists("/system.dat")) return;
    
    // Check if previous upload attempt left a file
    if (SD.exists("/uploading.dat")) {
        // If uploading.dat exists, it means we crashed/failed last time. 
        // We should process it first.
    } else {
        SD.rename("/system.dat", "/uploading.dat");
    }

    File file = SD.open("/uploading.dat", FILE_READ);
    if (!file) return;

    Serial.println("Starting Offline Sync...");
    String remainingData = "";
    int uploadCount = 0;
    
    while (file.available()) {
        String line = file.readStringUntil('\n');
        line.trim();
        if (line.length() == 0) continue;

        // Decrypt line
        String jsonString = encryptDecrypt(line);
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, jsonString);

        bool success = false;
        if (!error) {
            String cardId = doc["cid"];
            String timestamp = doc["ts"];
            String type = doc["t"];
            
            // Only sync "ATTEMPT" records or previously failed ones
            // We ignore records that simply logged an error or success unless we want to retry logic
            // Assuming we only want to retry actual attendance "ATTEMPT"s
            if (type == "ATTEMPT") {
                 WiFiClientSecure client;
                 client.setInsecure();
                 HTTPClient http;
                 
                 if (http.begin(client, serverName)) {
                     http.addHeader("Content-Type", "application/json");
                     String nonce = String(random(1000000));
                     String payloadData = cardId + ":" + timestamp + ":" + nonce;
                     String signature = createHMAC(payloadData, device_secret);

                     JsonDocument reqDoc;
                     reqDoc["cardId"] = cardId;
                     reqDoc["timestamp"] = timestamp;
                     reqDoc["nonce"] = nonce;
                     reqDoc["signature"] = signature;
                     String jsonPayload;
                     serializeJson(reqDoc, jsonPayload);

                     int httpCode = http.POST(jsonPayload);
                     if (httpCode == 200) {
                         success = true;
                         uploadCount++;
                         Serial.println("Synced: " + cardId);
                     } else {
                         Serial.print("Sync Fail: "); Serial.println(httpCode);
                     }
                     http.end();
                 }
            } else {
                // It's a log entry (ERR, etc.), we don't sync these to server usually, 
                // but let's just delete them to clean up or keep them?
                // For now, let's delete them (mark success) to clear storage
                success = true; 
            }
        }

        if (!success) {
            remainingData += line + "\n";
        }
    }
    file.close();

    // If we have remaining data (failed uploads), write them back to system.dat
    // effectively merging with any new data that came in during scan?
    // Actually, safest is to append current system.dat (if any created during sync) to this remaining data
    // OR, just write remaining data to system.dat (append mode? no, we renamed it)
    
    if (remainingData.length() > 0) {
        File reFile = SD.open("/system.dat", FILE_APPEND); // Create or Append
        reFile.print(remainingData);
        reFile.close();
    }
    
    SD.remove("/uploading.dat");
    if (uploadCount > 0) {
        Serial.println("Sync Complete. Uploaded: " + String(uploadCount));
    }
}

// --- WIFIMANAGER CALLBACK ---
void configModeCallback(WiFiManager *myWiFiManager) {
    Serial.println("Entered config mode");
    Serial.println(WiFi.softAPIP());
    Serial.println(myWiFiManager->getConfigPortalSSID());

    sprite.fillScreen(TFT_BLACK);
    sprite.setTextColor(TFT_ORANGE);
    sprite.setTextDatum(textdatum_t::middle_center);
    sprite.setFont(&fonts::Font4);
    sprite.drawString("WIFI SETUP MODE", sprite.width()/2, 50);
    
    sprite.setTextColor(TFT_WHITE);
    sprite.setFont(&fonts::FreeSans9pt7b);
    sprite.drawString("Connect to WiFi:", sprite.width()/2, 100);
    sprite.setTextColor(TFT_CYAN);
    sprite.drawString("AHMTIMUS-SETUP", sprite.width()/2, 130);
    
    sprite.setTextColor(TFT_WHITE);
    sprite.drawString("IP Address:", sprite.width()/2, 180);
    sprite.setTextColor(TFT_GREEN);
    sprite.drawString(WiFi.softAPIP().toString(), sprite.width()/2, 210);
    
    sprite.pushSprite(0, 0);
    tft.setBrightness(255); // Ensure bright for setup
}

// --- SETUP ---
void setup() {
    Serial.begin(115200);
    delay(500);

    tft.init();
    tft.setRotation(3);
    tft.setBrightness(255);
    sprite.createSprite(tft.width(), tft.height());

    tft.fillScreen(TFT_BLACK);
    tft.setTextColor(TFT_WHITE);
    tft.setTextDatum(textdatum_t::middle_center);
    tft.setFont(&fonts::Font4);
    tft.drawString("System Start...", tft.width()/2, tft.height()/2);
    
    Serial.print("Mounting SD...");
    sdSPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
    if(SD.begin(SD_CS_PIN, sdSPI, 4000000)) {
        Serial.println("OK");
        sdAvailable = true;
        tft.drawString("SD Failure!", tft.width()/2, tft.height()/2 + 30);
        delay(1000);
    }

    // NEW FUNCTION v1.3: Show Disk Space
    if(sdAvailable) {
       uint64_t total = SD.totalBytes() / (1024 * 1024);
       uint64_t used = SD.usedBytes() / (1024 * 1024);
       String storage = "SD Free: " + String(total - used) + " MB";
       tft.setTextColor(TFT_GREEN);
       tft.setFont(&fonts::Font4);
       tft.drawString(storage, tft.width()/2, tft.height()/2 + 60);
       delay(2000); // Show it for 2 seconds
    }

    Serial.print("Connecting WiFi...");
    
    WiFiManager wm;
    wm.setCountry("DE"); // Optimize for Germany (Channels 12-13)
    wm.setClass("invert"); // Dark Mode (Looks unexpected/premium)
    wm.setConnectTimeout(20); // Faster timeout
    // wm.resetSettings(); // REMOVED
    wm.setAPCallback(configModeCallback);
    WiFi.setSleep(false); // PERFORMANCE: Disable power saving
    WiFi.setTxPower(WIFI_POWER_19_5dBm); // MAX POWER for signal
    
    // AutoConnect: Tries to connect to known WiFi, if fails, starts AP "AHMTIMUS-SETUP"
    if (!wm.autoConnect("AHMTIMUS-SETUP")) {
        Serial.println("failed to connect and hit timeout");
        // reset and try again, or maybe put it to deep sleep
        ESP.restart();
        delay(1000);
    }
    
    // If we get here, we are connected
    wifiConnected = true;
    Serial.println("OK"); 
    
    // RESTORED: INIT RFID SYSTEM
    SPI.begin();
    mfrc522.PCD_Init();

    configTime(3600, 3600, "pool.ntp.org");
    
    // WAIT FOR TIME SYNC (Crucial for SSL!)
    Serial.print("Syncing Time");
    int retry = 0;
    while (time(nullptr) < 100000 && retry < 20) {
        Serial.print(".");
        delay(500);
        retry++;
    }
    bool timeSynced = (time(nullptr) > 100000);
    Serial.println(timeSynced ? "Time Sync: OK" : "Time Sync: Fail (Fallback to Insecure)");

    // OTA Init: Force Insecure for Testing (Fixes Error -1)
    otaManager.setServer(otaVersionUrl, otaBinaryUrl, nullptr); // FORCE INSECURE
    otaManager.setProgressCallback([](int progress, String status) {
        // USE SPRITE TO AVOID GLITCHES/FLICKER
        sprite.fillScreen(TFT_BLACK);
        
        // 1. Footer Logo
        sprite.setTextDatum(textdatum_t::bottom_left);
        sprite.setTextColor(AHMTIMUS_BLUE);
        sprite.setFont(&fonts::Font2);
        sprite.drawString("AHMTIMUS (C)", 10, sprite.height() - 10);

        // 2. Top Title: "Administrator"
        sprite.setTextColor(TFT_CYAN); 
        sprite.setFont(&fonts::FreeSansBold18pt7b);
        sprite.setTextDatum(textdatum_t::top_center);
        sprite.drawString("Administrator", sprite.width() / 2, 30); // Higher up
        
        // 3. Progress Bar (Centered)
        int w = 240; 
        int h = 20; // Thicker
        int x = (sprite.width() - w) / 2;
        int y = (sprite.height() - h) / 2; // Exact Center
        
        if (progress >= 0 && progress <= 100) {
           sprite.drawRect(x-2, y-2, w+4, h+4, TFT_WHITE);
           sprite.fillRect(x, y, (w * progress) / 100, h, TFT_GREEN);
        }

        // 4. Status Text (Below Bar)
        sprite.setTextColor(TFT_WHITE);
        sprite.setFont(&fonts::Font4);
        sprite.setTextDatum(textdatum_t::top_center);
        
        String displayStatus = status;
        if (progress > 0 && progress < 100) {
            displayStatus = status + " " + String(progress) + "%";
        }
        
        sprite.drawString(displayStatus, sprite.width() / 2, y + h + 20); // 20px below bar

        // Push to Screen
        sprite.pushSprite(0, 0);
    });
}

// --- LOOP ---
void loop() {
    static unsigned long lastTime = 0;
    
    checkInactivity(); // Check for screen saver

    // Periodic Offline Sync
    if (millis() - lastSyncTime > SYNC_INTERVAL) {
        lastSyncTime = millis();
        syncOfflineData();
    }
    
    if(millis() - lastTime > 1000) {
        lastTime = millis();
        // Serial.println("Tick"); // Debug time
        if (!isDimmed) displayLayout(); 
    }
    
    if (isDimmed) {
        drawEcoSaver(); // Run screensaver animation
        // return; // FIXED: Do NOT return, otherwise we can't check RFID to wake up!
    }

    if (!mfrc522.PICC_IsNewCardPresent()) return;
    wakeUp(); // Wake up screen on activity
    if (!mfrc522.PICC_ReadCardSerial()) return;

    String cardId = "";
    for (byte i = 0; i < mfrc522.uid.size; i++) {
        if (mfrc522.uid.uidByte[i] < 0x10) cardId += "0";
        cardId += String(mfrc522.uid.uidByte[i], HEX);
    }
    cardId.toUpperCase();
    
    if (cardId != lastCardId || (millis() - lastSendTime) > 4000) { 
        Serial.println("Card: " + cardId);
        
        if (cardId == ADMIN_CARD_ID) {
            // Start OTA - Callback will handle the "Administrator" UI immediately
             otaManager.checkAndPerformUpdate(FIRMWARE_VERSION);
             wakeUp(); // Keep awake during update logic
             
             // Wait longer so admin can see the result
             delay(4000); 
             displayLayout();
        } else {
            sendStampToServer(cardId);
        }
        lastCardId = cardId;
        lastSendTime = millis();
    }
    
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
}