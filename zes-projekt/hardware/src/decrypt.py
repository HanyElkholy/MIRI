# Python Skript zum Entschlüsseln
SD_SECRET = "AHMTIMUS_SECURE_KEY_2025"

def decrypt(input_str):
    key = SD_SECRET
    output = []
    for i in range(len(input_str)):
        # XOR Operation genau wie im Arduino Code
        char_code = ord(input_str[i]) ^ ord(key[i % len(key)])
        output.append(chr(char_code))
    return "".join(output)

try:
    with open("system.dat", "r", encoding="utf-8") as f:
        print("--- Entschlüsselte Daten ---")
        for line in f:
            line = line.strip() # Wichtig: Zeilenumbruch entfernen
            if line:
                print(decrypt(line))
except FileNotFoundError:
    print("Datei system.dat nicht gefunden.")