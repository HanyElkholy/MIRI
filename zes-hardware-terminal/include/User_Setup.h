// --- include/User_Setup.h (FINALE VERSION) ---

#define ILI9341_DRIVER

// ESP32 Pin-Definitionen (Sichere Auswahl)
#define TFT_MISO 19
#define TFT_MOSI 23
#define TFT_SCLK 18

#define TFT_CS   22  // Sicherer Pin
#define TFT_DC   17  // Sicherer Pin
#define TFT_RST  21  // Sicherer Pin
#define TFT_BL   16  // Sicherer Pin (Hintergrundbeleuchtung)

// #define TOUCH_CS // Auskommentiert

// Schriften
#define LOAD_GLCD
#define LOAD_FONT2
#define LOAD_FONT4

// SPI-Einstellungen (WICHTIG!)
#define SPI_FREQUENCY  20000000 // 20 MHz

// --- Ende der User_Setup.h ---