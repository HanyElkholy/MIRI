#ifndef OTAMANAGER_H
#define OTAMANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Update.h>

// Progress callback: (progress 0-100, status text)
typedef void (*OTAProgressCallback)(int progress, String status);

class OTAManager {
public:
    OTAManager();
    
    void setServer(const char* versionUrl, const char* binaryUrl, const char* rootCA);
    bool checkAndPerformUpdate(float currentVersion);
    void setProgressCallback(OTAProgressCallback cb);

private:
    const char* _versionUrl;
    const char* _binaryUrl;
    const char* _rootCA;
    OTAProgressCallback _callback;

    void updateProgress(int progress, String status);
};

#endif
