import base64
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

# MUSS 16 Zeichen lang sein (genau wie im C++ Code)
KEY = b"AHMTIMUS_SECURE!" 

def decrypt(encrypted_b64):
    try:
        # 1. Base64 Decode
        encrypted_bytes = base64.b64decode(encrypted_b64)
        
        # 2. Extract IV (First 16 bytes)
        iv = encrypted_bytes[:16]
        ciphertext = encrypted_bytes[16:]
        
        # 3. Decrypt (AES-128 CBC)
        cipher = AES.new(KEY, AES.MODE_CBC, iv)
        decrypted_bytes = unpad(cipher.decrypt(ciphertext), AES.block_size)
        
        return decrypted_bytes.decode('utf-8')
    except Exception as e:
        return f"Error: {e}"

try:
    print("--- Reading system.dat ---")
    with open("system.dat", "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                print(f"Encrypted: {line[:20]}...")
                print(f"Decrypted: {decrypt(line)}")
                print("-" * 30)
except FileNotFoundError:
    print("Datei system.dat nicht gefunden. Bitte kopieren Sie die Datei von der SD-Karte hierher.")