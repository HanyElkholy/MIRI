


> **Hinweis**: Für die englische Version bitte nach unten scrollen.  
> **Note**: For the English version please scroll down.

# MIRI - Zeiterfassungssystem

MIRI ist ein modernes, umfassendes Zeiterfassungs- und Anwesenheitssystem, das für effizientes Mitarbeitermanagement entwickelt wurde. Es kombiniert eine responsive Web-Oberfläche mit physischer Hardware-Unterstützung (RFID) für eine nahtlose Zeiterfassung.

## 🚀 Funktionen

*   **Dashboard**: Übersicht der wöchentlichen Stunden, Systemstatus und Benachrichtigungen.
*   **Zeiterfassung**:
    *   **Web**: Manuelles Ein-/Ausstempeln über die Weboberfläche.
    *   **Hardware**: Unterstützung für ESP32-basierte RFID-Terminals für physische Ausweise.
*   **Antragsverwaltung**: Workflow für Urlaub, Krankheit und Zeitkorrekturen.
*   **Live-Monitor**: Echtzeit-Ansicht des Mitarbeiterstatus (Anwesend/Abwesend) für Administratoren.
*   **Journal & Historie**: Audit-Logs aller Aktionen und Zeiteinträge.
*   **Reporting**: Excel-Exportfunktion für monatliche Stundenzettel.
*   **Benutzerverwaltung**: Rollenbasierter Zugriff (Benutzer/Admin) und Passwortverwaltung.

## 🛠 Technologie-Stack

*   **Frontend**: HTML5, TailwindCSS, Vanilla JS (bereitgestellt über Nginx)
*   **Backend**: Node.js, Express, PostgreSQL
*   **Hardware**: ESP32 (C++ / PlatformIO)
*   **Containerisierung**: Docker & Docker Compose

## 📦 Installation & Einrichtung

1.  **Repository klonen:**
    ```bash
    git clone https://github.com/yourusername/miri.git
    cd miri
    ```

2.  **Konfiguration:**
    *   Überprüfen Sie die `.env` Einstellungen (prüfen Sie die Standards in `docker-compose.yml`).

3.  **System starten:**
    ```bash
    docker-compose up -d --build
    ```

4.  **Zugriff auf die Anwendung:**
    *   Frontend: `http://localhost:80` (oder konfigurierter Port)
    *   API: `http://localhost:3001`

## 🔑 Standard-Zugangsdaten

*   **Benutzername**: `admin`
*   **Passwort**: `admin123` (Bitte nach dem ersten Login sofort ändern!)

## 📂 Projektstruktur

*   `apps/miri/backend`: Node.js API Service.
*   `apps/miri/frontend`: Statischer Web-Client.
*   `apps/landing`: Landing Page für das Projekt.
*   `hardware`: PlatformIO Projekt für das ESP32 RFID Terminal.
*   `nginx`: Reverse Proxy Konfiguration.

## 📄 Lizenz

Copyright © 2026 AHMTIMUS GbR. All Rights Reserved. Automation • Human • Machine

---

# MIRI - Time Tracking System

MIRI is a modern, comprehensive time tracking and attendance system designed for efficient employee management. It combines a responsive web interface with physical hardware support (RFID) for seamless time recording.

## 🚀 Features

*   **Dashboard**: Overview of weekly hours, system status, and notifications.
*   **Time Tracking**: 
    *   **Web**: Manual clock-in/out via the web interface.
    *   **Hardware**: ESP32-based RFID terminal support for physical badges.
*   **Request Management**: Workflow for Vacation (Urlaub), Sickness (Krank), and Time Corrections.
*   **Live Monitor**: Real-time view of employee status (Present/Away) for admins.
*   **Journal & History**: Audit-logs of all actions and time entries.
*   **Reporting**: Excel export functionality for monthly timesheets.
*   **User Management**: Role-based access (User/Admin) and password management.

## 🛠 Tech Stack

*   **Frontend**: HTML5, TailwindCSS, Vanilla JS (served via Nginx)
*   **Backend**: Node.js, Express, PostgreSQL
*   **Hardware**: ESP32 (C++ / PlatformIO)
*   **Containerization**: Docker & Docker Compose

## 📦 Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/miri.git
    cd miri
    ```

2.  **Configuration:**
    *   Review `.env` settings (checks default in `docker-compose.yml`).

3.  **Start the System:**
    ```bash
    docker-compose up -d --build
    ```

4.  **Access the Application:**
    *   Frontend: `http://localhost:80` (or configured port)
    *   API: `http://localhost:3001`

## 🔑 Default Credentials

*   **Username**: `admin`
*   **Password**: `admin123` (Change immediately after first login!)

## 📂 Project Structure

*   `apps/miri/backend`: Node.js API Service.
*   `apps/miri/frontend`: Static Web Client.
*   `apps/landing`: Landing page for the project.
*   `hardware`: PlatformIO project for the ESP32 RFID terminal.
*   `nginx`: Reverse proxy configuration.

## 📄 License

Copyright © 2026 AHMTIMUS GbR. All Rights Reserved. Automation • Human • Machine
