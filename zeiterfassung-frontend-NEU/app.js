
// Warten, bis das gesamte HTML-Dokument geladen ist
document.addEventListener('DOMContentLoaded', () => {

    // --- GLOBALE EINSTELLUNGEN ---
    const API_URL = 'http://localhost:3001/api/v1/times'; // URL zu unserem Backend
    let liveTrackerInterval; // Variable für unser Polling-Timer

    // --- SEITE 1: LOGIN ---
    const loginPage = document.getElementById('login-page');
    const loginForm = document.getElementById('login-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMessage = document.getElementById('error-message');

    // --- SEITE 2: ZEITERFASSUNG (TRACKER) ---
    const trackerPage = document.getElementById('tracker-page');
    const logoutButton = document.getElementById('logout-button');

    const navOverviewButton = document.getElementById('nav-overview-button');
    const navLiveTrackerButton = document.getElementById('nav-live-tracker-button');
    const navMonthlyReportButton = document.getElementById('nav-monthly-report-button'); 

    const contentOverview = document.getElementById('content-overview');
    const contentLiveTracker = document.getElementById('content-live-tracker');
    const contentMonthlyReport = document.getElementById('content-monthly-report'); 

    // Live-Tracker Tabellen-Container
    const liveTrackerTableBody = document.getElementById('live-tracker-table-body');

    // Zeit-Bearbeiten-Elemente (aus 'content-overview')
    const editButton = document.getElementById('edit-button');
    const saveButton = document.getElementById('save-button');
    const cancelButton = document.getElementById('cancel-button');
    const timeDisplayContainer = document.getElementById('time-display-container');
    const timeEditContainer = document.getElementById('time-edit-container');
    const editButtonsContainer = document.getElementById('edit-buttons-container');
    const timeDisplay = document.getElementById('time-display');
    const timeInput = document.getElementById('time-input');
    const editError = document.getElementById('edit-error');


    // --- LOGIK: LOGIN & SEITENWECHSEL ---

    loginForm.addEventListener('submit', (event) => {
        event.preventDefault(); 
        const username = usernameInput.value;
        const password = passwordInput.value;

        // HINWEIS: Dies ist noch ein "Mockup"-Login. 
        // Später werden wir dies an das Backend senden.
        if (username === 'admin' && password === 'password') {
            console.log('Login erfolgreich');
            
            loginPage.style.display = 'none';
            trackerPage.style.display = 'block';

            // Standardansicht nach Login (Übersicht)
            showOverview(); // Zeige die Übersicht als Startseite
            
            errorMessage.classList.add('hidden');
        } else {
            console.log('Login fehlgeschlagen');
            errorMessage.classList.remove('hidden');
        }
    });

    logoutButton.addEventListener('click', () => {
        trackerPage.style.display = 'none';
        loginPage.style.display = 'flex';
        usernameInput.value = '';
        passwordInput.value = '';
        
        // Polling stoppen, wenn wir uns ausloggen
        if (liveTrackerInterval) {
            clearInterval(liveTrackerInterval);
        }
    });

    // --- LOGIK: INHALTS-NAVIGATION ---

    navOverviewButton.addEventListener('click', showOverview);
    navLiveTrackerButton.addEventListener('click', showLiveTracker);
    navMonthlyReportButton.addEventListener('click', showMonthlyReport);
    
    function showOverview() {
        contentOverview.style.display = 'block';
        contentLiveTracker.style.display = 'none';
        contentMonthlyReport.style.display = 'none';
        setActiveNav(navOverviewButton);
        stopLiveTracker();
    }
    
    function showLiveTracker() {
        contentOverview.style.display = 'none';
        contentLiveTracker.style.display = 'block';
        contentMonthlyReport.style.display = 'none';
        setActiveNav(navLiveTrackerButton);
        startLiveTracker(); // Starte das Polling
    }
    
    function showMonthlyReport() {
        contentOverview.style.display = 'none';
        contentLiveTracker.style.display = 'none';
        contentMonthlyReport.style.display = 'block';
        setActiveNav(navMonthlyReportButton);
        stopLiveTracker();
    }

    function setActiveNav(activeButton) {
        [navOverviewButton, navLiveTrackerButton, navMonthlyReportButton].forEach(button => {
            button.classList.remove('bg-ahmtimus-blue', 'text-white');
            button.classList.add('text-gray-300', 'hover:bg-gray-700', 'hover:text-white');
        });
        activeButton.classList.add('bg-ahmtimus-blue', 'text-white');
        activeButton.classList.remove('text-gray-300', 'hover:bg-gray-700', 'hover:text-white');
    }

    
    // --- NEUE LOGIK: LIVE-TRACKER DATENABRUF ---

    function startLiveTracker() {
        // Stoppe den alten Timer, falls er läuft
        if (liveTrackerInterval) {
            clearInterval(liveTrackerInterval);
        }
        // Rufe die Daten sofort ab
        updateLiveTrackerData();
        // Starte einen neuen Timer, der alle 3 Sekunden die Daten neu lädt
        liveTrackerInterval = setInterval(updateLiveTrackerData, 3000);
    }

    function stopLiveTracker() {
        if (liveTrackerInterval) {
            clearInterval(liveTrackerInterval);
        }
    }

    // Holt die Daten vom Backend und baut die Tabelle neu
    async function updateLiveTrackerData() {
        console.log("Rufe Live-Daten vom Server ab...");
        try {
            const response = await fetch(API_URL);
            if (!response.ok) {
                throw new Error(`HTTP-Fehler! Status: ${response.status}`);
            }
            const data = await response.json();
            
            // Tabellen-Body leeren
            liveTrackerTableBody.innerHTML = '';
            
            // Für jeden Datensatz eine neue Zeile erstellen
            data.forEach(stamp => {
                const row = document.createElement('div');
                row.className = 'grid grid-cols-5 gap-4 items-center px-6 py-5 border-t border-gray-700';
                
                // Status-Farbe bestimmen
                let statusColor = 'text-white';
                if (stamp.type.toLowerCase().includes('kommen')) {
                    statusColor = 'text-green-500';
                } else if (stamp.type.toLowerCase().includes('gehen')) {
                    statusColor = 'text-red-500';
                } else if (stamp.type.toLowerCase().includes('pause')) {
                    statusColor = 'text-yellow-500';
                }

                // Datums- und Zeitformatierung
                const timestamp = new Date(stamp.time);
                const date = timestamp.toLocaleDateString('de-DE');
                const time = timestamp.toLocaleTimeString('de-DE');

                row.innerHTML = `
                    <div class="font-medium text-gray-400">${stamp.id}</div>
                    <div class="font-medium text-white">${stamp.user}</div>
                    <div class="text-white">${date}</div>
                    <div class="text-white">${time}</div>
                    <div class="text-right font-semibold ${statusColor}">${stamp.type}</div>
                `;
                liveTrackerTableBody.appendChild(row);
            });

        } catch (error) {
            console.error("Fehler beim Abrufen der Live-Daten:", error);
            liveTrackerTableBody.innerHTML = `
                <div class="grid grid-cols-1 gap-4 items-center px-6 py-5 border-t border-gray-700">
                    <div class="font-medium text-red-500 text-center">
                        Fehler beim Laden der Daten. Läuft der Backend-Server auf Port 3001?
                    </div>
                </div>`;
            stopLiveTracker(); // Polling stoppen bei Fehler
        }
    }


    // --- LOGIK: ZEIT BEARBEITEN (Unverändert) ---
    let originalTime = ''; 
    editButton.addEventListener('click', () => {
        originalTime = timeDisplay.textContent;
        timeInput.value = originalTime;
        timeDisplayContainer.classList.add('hidden');
        editButton.classList.add('hidden');
        timeEditContainer.classList.remove('hidden');
        editButtonsContainer.classList.remove('hidden');
    });

    cancelButton.addEventListener('click', () => {
        timeDisplayContainer.classList.remove('hidden');
        editButton.classList.remove('hidden');
        timeEditContainer.classList.add('hidden');
        editButtonsContainer.classList.add('hidden');
        editError.classList.add('hidden');
    });

    saveButton.addEventListener('click', () => {
        const newValue = parseFloat(timeInput.value);
        if (!isNaN(newValue) && newValue >= 0) {
            timeDisplay.textContent = newValue.toFixed(2);
            cancelButton.click(); 
        } else {
            editError.classList.remove('hidden');
        }
    });

});