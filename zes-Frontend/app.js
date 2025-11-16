// Warten, bis das gesamte HTML-Dokument geladen ist
document.addEventListener('DOMContentLoaded', () => {

    // --- SEITE 1: LOGIN ---
    const loginPage = document.getElementById('login-page');
    const loginForm = document.getElementById('login-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMessage = document.getElementById('error-message');

    // --- SEITE 2: ZEITERFASSUNG (TRACKER) ---
    const trackerPage = document.getElementById('tracker-page');
    const logoutButton = document.getElementById('logout-button');

    // NEU: Navigationselemente (erweitert)
    const navOverviewButton = document.getElementById('nav-overview-button');
    const navLiveTrackerButton = document.getElementById('nav-live-tracker-button');
    const navMonthlyReportButton = document.getElementById('nav-monthly-report-button'); // NEU

    // NEU: Inhalts-Container (erweitert)
    const contentOverview = document.getElementById('content-overview');
    const contentLiveTracker = document.getElementById('content-live-tracker');
    const contentMonthlyReport = document.getElementById('content-monthly-report'); // NEU

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

    // 1. Login-Formular überwachen
    loginForm.addEventListener('submit', (event) => {
        event.preventDefault(); 
        const username = usernameInput.value;
        const password = passwordInput.value;

        if (username === 'admin' && password === 'password') {
            console.log('Login erfolgreich');
            
            loginPage.style.display = 'none';
            trackerPage.style.display = 'block';

            // Standardansicht nach Login
            contentOverview.style.display = 'block';
            contentLiveTracker.style.display = 'none';
            contentMonthlyReport.style.display = 'none'; // NEU
            
            setActiveNav(navOverviewButton);
            errorMessage.classList.add('hidden');
        } else {
            console.log('Login fehlgeschlagen');
            errorMessage.classList.remove('hidden');
        }
    });

    // 2. Logout-Button überwachen
    logoutButton.addEventListener('click', () => {
        trackerPage.style.display = 'none';
        loginPage.style.display = 'flex';

        usernameInput.value = '';
        passwordInput.value = '';
        
        // Alle Inhalte zurücksetzen
        contentOverview.style.display = 'block';
        contentLiveTracker.style.display = 'none';
        contentMonthlyReport.style.display = 'none'; // NEU
    });

    // --- LOGIK: INHALTS-NAVIGATION (erweitert) ---

    // 3. "Übersicht"-Button
    navOverviewButton.addEventListener('click', () => {
        contentOverview.style.display = 'block';
        contentLiveTracker.style.display = 'none';
        contentMonthlyReport.style.display = 'none'; // NEU
        setActiveNav(navOverviewButton);
    });

    // 4. "Live-Tracker"-Button
    navLiveTrackerButton.addEventListener('click', () => {
        contentOverview.style.display = 'none';
        contentLiveTracker.style.display = 'block';
        contentMonthlyReport.style.display = 'none'; // NEU
        setActiveNav(navLiveTrackerButton);
    });
    
    // 5. "Monatsjournal"-Button (NEU)
    navMonthlyReportButton.addEventListener('click', () => {
        contentOverview.style.display = 'none';
        contentLiveTracker.style.display = 'none';
        contentMonthlyReport.style.display = 'block'; // NEU
        setActiveNav(navMonthlyReportButton);
    });


    // Hilfsfunktion, um den aktiven Button zu formatieren (ANGEPASST)
    function setActiveNav(activeButton) {
        // Alle Buttons zurücksetzen (NEU: navMonthlyReportButton hinzugefügt)
        [navOverviewButton, navLiveTrackerButton, navMonthlyReportButton].forEach(button => {
            button.classList.remove('bg-ahmtimus-blue', 'text-white');
            button.classList.add('text-gray-300', 'hover:bg-gray-700', 'hover:text-white');
        });

        // Den aktiven Button hervorheben
        activeButton.classList.add('bg-ahmtimus-blue', 'text-white');
        activeButton.classList.remove('text-gray-300', 'hover:bg-gray-700', 'hover:text-white');
    }


    // --- LOGIK: ZEIT BEARBEITEN (Unverändert) ---
    // (Keine Änderungen in diesem Abschnitt nötig)

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