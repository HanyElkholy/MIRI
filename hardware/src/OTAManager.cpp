#include "OTAManager.h"

// --- CONSTRUCTOR ---
OTAManager::OTAManager() : _versionUrl(nullptr), _binaryUrl(nullptr), _rootCA(nullptr), _callback(nullptr) {}

// --- CONFIG ---
void OTAManager::setServer(const char* versionUrl, const char* binaryUrl, const char* rootCA) {
    _versionUrl = versionUrl;
    _binaryUrl = binaryUrl;
    _rootCA = rootCA;
}

void OTAManager::setProgressCallback(OTAProgressCallback cb) {
    _callback = cb;
}

// --- HELPER ---
void OTAManager::updateProgress(int progress, String status) {
    if (_callback) _callback(progress, status);
}

// --- CORE OTA LOGIC ---
bool OTAManager::checkAndPerformUpdate(float currentVersion) {
    if (WiFi.status() != WL_CONNECTED) {
        updateProgress(-1, "No WiFi");
        return false;
    }

    WiFiClientSecure client;
    if (_rootCA) client.setCACert(_rootCA);
    else client.setInsecure(); 

    // 1. CHECK VERSION
    HTTPClient http;
    http.setReuse(false); // Disable Keep-Alive
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS); // Follow redirects
    http.setUserAgent("ESP32-S3-OTA"); // Identify ourselves (prevents 403 blocks)
    http.begin(client, _versionUrl);
    updateProgress(0, "Checking Version...");
    
    int httpCode = http.GET();
    float newVersion = 0.0;
    
    if (httpCode == HTTP_CODE_OK) {
        // MANUAL READ to fix "Empty String" issue without breaking connection
        String payload = "";
        WiFiClient *stream = http.getStreamPtr();
        unsigned long timeout = millis();
        while (http.connected() && (millis() - timeout < 2000)) {
            if (stream->available()) {
                char c = stream->read();
                payload += c;
                timeout = millis(); // Reset timeout on data
            }
            delay(1);
        }
        
        payload.trim(); // Remove whitespace/newlines
        Serial.println("Server Raw: '" + payload + "'");
        newVersion = payload.toFloat();
        Serial.printf("Current: %.1f, Server: %.1f\n", currentVersion, newVersion);
    } else {
        updateProgress(-1, "Check Failed: " + String(httpCode));
        Serial.printf("HTTP Error: %d\n", httpCode);
        http.end();
        return false;
    }
    http.end();

    if (newVersion <= currentVersion) {
        updateProgress(100, "Up to Date");
        delay(2000);
        return false;
    }

    // 2. DOWNLOAD & FLASH
    updateProgress(0, "Download Start...");
    http.begin(client, _binaryUrl);
    
    if (http.GET() == HTTP_CODE_OK) {
        int totalLength = http.getSize();
        int len = totalLength;
        
        if (Update.begin(len)) {
            WiFiClient *stream = http.getStreamPtr();
            uint8_t buff[128] = { 0 };
            size_t size = sizeof(buff);
            size_t written = 0;
            int totalWritten = 0;
            
            while(http.connected() && (len > 0 || len == -1)) {
                size_t sizeAvailable = stream->available();
                if (sizeAvailable) {
                    int readBytes = stream->readBytes(buff, ((sizeAvailable > size) ? size : sizeAvailable));
                    if(readBytes > 0) {
                        written = Update.write(buff, readBytes);
                        if (written > 0) {
                            totalWritten += written;
                            len -= written;
                            updateProgress((totalWritten * 100) / totalLength, "Downloading...");
                        } else {
                            updateProgress(-1, "Write Error");
                            return false;
                        }
                    }
                }
                delay(1);
            }
            
            if (Update.end() && Update.isFinished()) {
                updateProgress(100, "Update Success!");
                delay(2000);
                ESP.restart();
                return true;
            } else {
                updateProgress(-1, "Update Failed");
                return false;
            }
        } else {
                updateProgress(-1, "No Space");
                return false;
        }
    } else {
        updateProgress(-1, "Download Failed");
        http.end();
        return false;
    }
    http.end();
    return false;
}
