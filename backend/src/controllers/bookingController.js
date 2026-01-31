const db = require('../config/db');
const ExcelJS = require('exceljs');
const { logAudit } = require('../utils/logger');

// HILFSFUNKTION: Zählt Werktage (Mo-Fr) in einem Monat
function getWorkingDaysInMonth(year, month) {
    let date = new Date(year, month - 1, 1);
    let end = new Date(year, month, 0);
    let count = 0;
    while (date <= end) {
        const day = date.getDay();
        if (day !== 0 && day !== 6) { // 0=Sonntag, 6=Samstag
            count++;
        }
        date.setDate(date.getDate() + 1);
    }
    return count;
}

// HILFSFUNKTION: Berechnet Arbeitszeit mit automatischer Pause
// Regel: Für jede 6 Stunden Arbeitszeit wird 0.5 Stunden Pause abgezogen
function calculateWorkHoursWithBreak(startTime, endTime) {
    if (!startTime || !endTime) return 0;

    // Konvertiere Zeiten zu Stunden (Dezimal)
    const startParts = startTime.split(':');
    const endParts = endTime.split(':');

    const startHours = parseFloat(startParts[0]) + parseFloat(startParts[1]) / 60;
    const endHours = parseFloat(endParts[0]) + parseFloat(endParts[1]) / 60;

    // Berechne Roh-Arbeitszeit
    let rawHours = endHours - startHours;

    // Wenn über Mitternacht (z.B. 22:00 - 06:00)
    if (rawHours < 0) {
        rawHours += 24;
    }

    // Pausen-Berechnung: Für jede 6 Stunden = 0.5 Stunden Pause
    // Beispiel: 6h = 0.5h Pause, 12h = 1h Pause, 6.5h = 0.5h Pause
    const breakHours = Math.floor(rawHours / 6) * 0.5;

    // Netto-Arbeitszeit nach Pausen-Abzug
    const netHours = rawHours - breakHours;

    return Math.max(0, netHours); // Stelle sicher, dass nicht negativ
}

// -------------------------------------------------------------------------
// 1. DASHBOARD: Nur aktuelle Woche (IST-Stunden inkl. Anträge)
// -------------------------------------------------------------------------
exports.getDashboard = async (req, res) => {
    const userId = req.user.id;
    const currentYear = new Date().getFullYear();

    try {
        const userRes = await db.query('SELECT daily_target, vacation_days FROM users WHERE id = $1', [userId]);
        const dailyTarget = parseFloat(userRes.rows[0]?.daily_target || 8.0);
        const totalVacation = userRes.rows[0]?.vacation_days || 30;

        // Alerts (Offene Buchungen ohne Ende)
        const alerts = await db.query(`
            SELECT id, TO_CHAR(date, 'DD.MM.YYYY') as date, TO_CHAR(start_time, 'HH24:MI') as start
            FROM bookings
            WHERE user_id = $1 AND date < CURRENT_DATE AND start_time IS NOT NULL AND end_time IS NULL`,
            [userId]
        );

        // BERECHNUNG: IST-Stunden für DIESE WOCHE
        // WICHTIG: Summiert ALLE Einträge pro Tag (mehrfaches Stempeln wird korrekt addiert)
        // Pausen werden automatisch abgezogen (0.5h pro 6h Arbeitszeit)
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Montag der aktuellen Woche
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6); // Sonntag der aktuellen Woche

        const weekStartStr = weekStart.toISOString().split('T')[0];
        const weekEndStr = weekEnd.toISOString().split('T')[0];

        const stats = await db.query(`
            SELECT 
                COALESCE(SUM(
                    CASE 
                        -- FALL 1: Pauschale Tage (Zählen fix als Target-Stunden)
                        WHEN type IN ('Urlaub', 'Krank', 'Krankmeldung', 'Holiday', 'Sick', 'SICK', 'VACATION', 'Winter Urlaub') 
                        THEN $2
                        
                        -- FALL 2: Normale Arbeit - mit automatischer Pausen-Berechnung
                        WHEN end_time IS NOT NULL AND start_time IS NOT NULL THEN
                            -- Berechne Roh-Stunden (TIME-Subtraktion gibt INTERVAL)
                            -- Berücksichtigt auch Über-Mitternacht (end_time < start_time)
                            (
                                CASE 
                                    WHEN end_time::time >= start_time::time THEN
                                        EXTRACT(EPOCH FROM (end_time::time - start_time::time))/3600
                                    ELSE
                                        EXTRACT(EPOCH FROM (end_time::time - start_time::time + INTERVAL '1 day'))/3600
                                END
                            ) - 
                            -- Abzug: 0.5h Pause pro 6h Arbeitszeit
                            (FLOOR(
                                (CASE 
                                    WHEN end_time::time >= start_time::time THEN
                                        EXTRACT(EPOCH FROM (end_time::time - start_time::time))/3600
                                    ELSE
                                        EXTRACT(EPOCH FROM (end_time::time - start_time::time + INTERVAL '1 day'))/3600
                                END) / 6
                            ) * 0.5)
                        ELSE 0 
                    END
                ), 0) as hours_week
            FROM bookings 
            WHERE user_id = $1 
            AND date >= $3::date
            AND date <= $4::date
        `, [userId, dailyTarget, weekStartStr, weekEndStr]);

        const vacTakenRes = await db.query(`
            SELECT COUNT(*) as count FROM requests 
            WHERE user_id = $1 
            AND type IN ('Urlaub', 'Vacation', 'VACATION', 'Winter Urlaub') 
            AND status = 'approved' 
            AND EXTRACT(YEAR FROM date) = $2`,
            [userId, currentYear]
        );

        res.json({
            alerts: alerts.rows,
            hoursWeek: Math.round((parseFloat(stats.rows[0].hours_week) || 0) * 100) / 100,
            vacTaken: parseInt(vacTakenRes.rows[0].count || 0),
            vacationLeft: totalVacation - parseInt(vacTakenRes.rows[0].count || 0)
        });

    } catch (e) {
        // console.error("Dashboard Error:", e); // In Prod entfernen oder Logger nutzen
        res.status(500).json({ error: "Server Error" });
    }
};

// -------------------------------------------------------------------------
// 4. Monats-Statistik (Dynamisch angepasst)
exports.getMonthStats = async (req, res) => {
    let { month, year, targetUserId } = req.query;
    const requesterId = req.user.id;
    const requesterRole = req.user.role;

    // Validierung
    const m = parseInt(month);
    const y = parseInt(year);
    if (isNaN(m) || isNaN(y)) return res.json({ soll: 0, ist: 0, saldo: 0 });

    let userId = requesterId;
    if (requesterRole === 'admin' && targetUserId) userId = parseInt(targetUserId);

    try {
        // A) Arbeitstage-Config laden
        const cRes = await db.query('SELECT working_days FROM customers WHERE id = $1', [req.user.customerId]);
        const workingDays = cRes.rows[0]?.working_days || [1, 2, 3, 4, 5]; // Default Mo-Fr

        // B) SOLL Berechnen (Dynamische Zählung)
        let dynamicWorkingDaysCount = 0;
        const daysInMonth = new Date(y, m, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
            const dayOfWeek = new Date(y, m - 1, d).getDay(); // JS Date (Month 0-11)
            if (workingDays.includes(dayOfWeek)) {
                dynamicWorkingDaysCount++;
            }
        }

        const uRes = await db.query('SELECT daily_target FROM users WHERE id = $1', [userId]);
        let dailyTarget = parseFloat(uRes.rows[0]?.daily_target || 8.0);
        const soll = dynamicWorkingDaysCount * dailyTarget;

        // C) IST (Arbeit) - mit automatischer Pausen-Berechnung
        // Pause: 0.5h pro 6h Arbeitszeit
        const workRes = await db.query(
            `SELECT COALESCE(SUM(
                -- Roh-Stunden berechnen (berücksichtigt auch Über-Mitternacht)
                CASE 
                    WHEN end_time::time >= start_time::time THEN
                        EXTRACT(EPOCH FROM (end_time::time - start_time::time))/3600
                    ELSE
                        EXTRACT(EPOCH FROM (end_time::time - start_time::time + INTERVAL '1 day'))/3600
                END - 
                -- Abzug: 0.5h Pause pro 6h Arbeitszeit
                (FLOOR(
                    (CASE 
                        WHEN end_time::time >= start_time::time THEN
                            EXTRACT(EPOCH FROM (end_time::time - start_time::time))/3600
                        ELSE
                            EXTRACT(EPOCH FROM (end_time::time - start_time::time + INTERVAL '1 day'))/3600
                    END) / 6
                ) * 0.5)
            ), 0) as hours 
             FROM bookings 
             WHERE user_id = $1 
             AND EXTRACT(MONTH FROM date) = $2 
             AND EXTRACT(YEAR FROM date) = $3
             AND type NOT IN ('Urlaub', 'Krank', 'Krankmeldung', 'Holiday', 'Sick', 'SICK', 'VACATION', 'Winter Urlaub') 
             AND end_time IS NOT NULL 
             AND start_time IS NOT NULL`,
            [userId, m, y]
        );
        let istWork = parseFloat(workRes.rows[0]?.hours) || 0;

        // D) IST (Urlaub/Krank) - Nur an definierten Arbeitstagen zählen
        const vacRes = await db.query(
            `SELECT COUNT(*) as days 
             FROM bookings 
             WHERE user_id = $1 AND EXTRACT(MONTH FROM date) = $2 AND EXTRACT(YEAR FROM date) = $3
             AND type IN ('Urlaub', 'Krank')
             AND EXTRACT(DOW FROM date) = ANY($4::int[])`, // <--- Hier passiert die Magie
            [userId, m, y, workingDays]
        );
        const vacDays = parseInt(vacRes.rows[0].days) || 0;
        const istVacation = vacDays * dailyTarget;

        const totalIst = istWork + istVacation;
        res.json({ soll, ist: totalIst, saldo: totalIst - soll });

    } catch (e) {
        // console.error("Month Stats Error:", e);
        res.json({ soll: 0, ist: 0, saldo: 0 });
    }
};

// ... Hier folgen getBookings, stamp, manualStamp etc. (unverändert lassen) ...
// 2. Buchungen laden
exports.getBookings = async (req, res) => {
    const { id, role, customerId } = req.user;
    const { from, to } = req.query;
    try {
        let q = `SELECT id, user_id as "userId", TO_CHAR(date, 'YYYY-MM-DD') as date, 
                        TO_CHAR(start_time, 'HH24:MI') as start, TO_CHAR(end_time, 'HH24:MI') as end, 
                        type, remarks, history 
                 FROM bookings WHERE user_id IN (SELECT id FROM users WHERE customer_id = $1)`;
        let p = [customerId];
        let c = 2;

        if (from && to) {
            q += ` AND date >= $${c} AND date <= $${c + 1}`;
            p.push(from, to);
            c += 2;
        }

        if (role !== 'admin') {
            q += ` AND user_id = $${c}`;
            p.push(id);
        }

        q += ` ORDER BY date DESC, start_time DESC LIMIT 500`;
        const result = await db.query(q, p);
        res.json(result.rows);
    } catch (err) { console.error(err); res.status(500).json({}); }
};

// 3. Manuelles Stempeln (Web) - MIT URLAUBS-SPERRE
exports.manualStamp = async (req, res) => {
    const { action } = req.body;
    const userId = req.user.id;
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    const timeStr = now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour12: false });

    try {
        // --- NEU: SICHERHEITS-CHECK START ---
        // Prüfen, ob für HEUTE schon Urlaub oder Krank eingetragen ist
        const checkRes = await db.query(
            'SELECT type FROM bookings WHERE user_id = $1 AND date = $2',
            [userId, dateStr]
        );

        // Wir prüfen alle Einträge von heute. Wenn einer davon Urlaub/Krank ist -> BLOCKIEREN.
        const isBlocked = checkRes.rows.some(row => row.type === 'Urlaub' || row.type === 'Krank');

        if (isBlocked) {
            return res.status(400).json({
                status: "error",
                message: "Stempeln nicht möglich: Für heute ist bereits Urlaub oder Krankheit eingetragen!"
            });
        }
        // --- NEU: SICHERHEITS-CHECK ENDE ---

        if (action === 'start') {
            await db.query(`INSERT INTO bookings (user_id, date, start_time, type) VALUES ($1, $2, $3, 'Web-Terminal')`,
                [userId, dateStr, timeStr]);
            await logAudit(req.user.customerId, req.user.displayName, 'Stempeln', '', 'Kommen', req.user.displayName);
        } else {
            const open = await db.query(`SELECT id FROM bookings WHERE user_id = $1 AND date = $2 AND end_time IS NULL`,
                [userId, dateStr]);
            if (open.rows.length > 0) {
                await db.query(`UPDATE bookings SET end_time = $1 WHERE id = $2`, [timeStr, open.rows[0].id]);
                await logAudit(req.user.customerId, req.user.displayName, 'Stempeln', '', 'Gehen', req.user.displayName);
            }
        }
        res.json({ status: "success" });
    } catch (e) { console.error(e); res.status(500).json({}); }
};

// 4. Hardware Stempeln (Karte) - MIT URLAUBS-SPERRE
exports.stamp = async (req, res) => {
    const { cardId } = req.body;
    if (!cardId) return res.status(400).json({ message: "Keine Karten-ID" });

    try {
        const uRes = await db.query('SELECT * FROM users WHERE card_id = $1', [cardId]);
        if (uRes.rows.length === 0) return res.status(404).json({ message: "Unbekannte Karte" });

        const user = uRes.rows[0];
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
        const timeStr = now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour12: false });

        // --- NEU: SICHERHEITS-CHECK START ---
        const checkRes = await db.query(
            'SELECT type FROM bookings WHERE user_id = $1 AND date = $2',
            [user.id, dateStr]
        );

        const isBlocked = checkRes.rows.some(row => row.type === 'Urlaub' || row.type === 'Krank');

        if (isBlocked) {
            // Wichtig: Hardware-Terminals erwarten oft einen kurzen Status
            return res.status(400).json({ message: "GEBLOCKt: URLAUB/KRANK" });
        }
        // --- NEU: SICHERHEITS-CHECK ENDE ---

        const openB = await db.query(
            'SELECT * FROM bookings WHERE user_id = $1 AND date = $2 AND end_time IS NULL',
            [user.id, dateStr]
        );

        let type = "Kommen";
        if (openB.rows.length > 0) {
            await db.query('UPDATE bookings SET end_time = $1 WHERE id = $2', [timeStr, openB.rows[0].id]);
            type = "Gehen";
        } else {
            await db.query('INSERT INTO bookings (user_id, date, start_time, type) VALUES ($1, $2, $3, $4)',
                [user.id, dateStr, timeStr, 'valid']);
        }

        await logAudit(user.customer_id, 'Terminal', 'Chip Stempelung', '', type, user.display_name);

        res.status(200).json({ status: "success", user: user.display_name, type: type });
    } catch (e) { console.error(e); res.status(500).json({ message: "Server Fehler" }); }
};

/// 5. Historie laden (Mit Filtern)
exports.getHistory = async (req, res) => {
    const { customerId, role, displayName } = req.user;
    const { startDate, endDate, targetUserId } = req.query; // Neue Parameter

    try {
        let q = `SELECT timestamp, actor, action, old_value as "oldValue", new_value as "newValue", affected_user as "affectedUser" 
                 FROM audit_logs WHERE customer_id = $1`;
        let p = [customerId];
        let c = 2;

        // A) Datum Filter
        if (startDate) {
            q += ` AND timestamp >= $${c}::date`;
            p.push(startDate);
            c++;
        }
        if (endDate) {
            // +1 Tag, damit der End-Tag voll inkludiert ist (oder man nutzt <= 'YYYY-MM-DD 23:59:59')
            q += ` AND timestamp < ($${c}::date + INTERVAL '1 day')`;
            p.push(endDate);
            c++;
        }

        // B) User Filter (Logik)
        if (role === 'admin') {
            // Admin kann filtern
            if (targetUserId) {
                // Wir müssen den Namen zum ID finden, da Audit-Log Namen speichert
                const uRes = await db.query('SELECT display_name FROM users WHERE id = $1 AND customer_id = $2', [targetUserId, customerId]);
                if (uRes.rows.length > 0) {
                    const targetName = uRes.rows[0].display_name;
                    q += ` AND (actor = $${c} OR affected_user = $${c})`;
                    p.push(targetName);
                    c++;
                }
            }
        } else {
            // Normaler User sieht nur sich selbst (Actor oder Betroffener)
            q += ` AND (actor = $${c} OR affected_user = $${c})`;
            p.push(displayName);
            c++;
        }

        q += ` ORDER BY timestamp DESC LIMIT 200`; // Limit etwas erhöht

        const r = await db.query(q, p);
        res.json(r.rows);
    } catch (e) { console.error(e); res.status(500).json({}); }
};

// NEU: Professioneller Excel Export (Repariert für 'pool')
exports.exportExcel = async (req, res) => {
    const { month, year, targetUserId } = req.query;
    const requesterId = req.user.id;
    const requesterRole = req.user.role;
    const customerId = req.user.customerId;

    try {
        // 1. Filter Logik bauen
        let queryParams = [customerId];
        let queryStr = `
            SELECT b.date, b.start_time, b.end_time, b.type, b.remarks, u.display_name, u.card_id 
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            WHERE u.customer_id = $1
        `;
        let count = 2;

        // Zeit-Filter
        if (month && year) {
            queryStr += ` AND EXTRACT(MONTH FROM b.date) = $${count} AND EXTRACT(YEAR FROM b.date) = $${count + 1}`;
            queryParams.push(month, year);
            count += 2;
        }

        // User-Filter
        if (requesterRole === 'admin' && targetUserId) {
            queryStr += ` AND b.user_id = $${count}`;
            queryParams.push(targetUserId);
        } else if (requesterRole !== 'admin') {
            queryStr += ` AND b.user_id = $${count}`;
            queryParams.push(requesterId);
        }

        queryStr += ` ORDER BY b.date ASC, b.start_time ASC`;

        // 2. Daten holen (HIER WAR DAS PROBLEM: pool statt db nutzen!)
        // Wir probieren beides, falls du db oder pool nutzt, aber pool ist wahrscheinlicher.
        const result = await (typeof pool !== 'undefined' ? pool : db).query(queryStr, queryParams);
        const bookings = result.rows;

        // 3. Excel Workbook erstellen
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Export');

        worksheet.columns = [
            { header: 'Datum', key: 'date', width: 15 },
            { header: 'Mitarbeiter', key: 'name', width: 25 },
            { header: 'Typ', key: 'type', width: 15 },
            { header: 'Start', key: 'start', width: 10 },
            { header: 'Ende', key: 'end', width: 10 },
            { header: 'Dauer (Std)', key: 'duration', width: 15 },
            { header: 'Bemerkung', key: 'remarks', width: 30 }
        ];

        worksheet.getRow(1).font = { bold: true };

        bookings.forEach(b => {
            const dateObj = new Date(b.date);
            const dateStr = dateObj.toLocaleDateString('de-DE');
            let duration = '';

            if (b.start_time && b.end_time) {
                // Berechne Roh-Stunden
                const [h1, m1] = b.start_time.split(':');
                const [h2, m2] = b.end_time.split(':');
                const start = parseInt(h1) * 60 + parseInt(m1);
                const end = parseInt(h2) * 60 + parseInt(m2);

                // Roh-Arbeitszeit (berücksichtigt Über-Mitternacht)
                let rawHours = (end - start) / 60;
                if (rawHours < 0) rawHours += 24; // Über Mitternacht

                // Pausen-Berechnung: 0.5h pro 6h Arbeitszeit
                const breakHours = Math.floor(rawHours / 6) * 0.5;

                // Netto-Arbeitszeit nach Pausen-Abzug
                const netHours = Math.max(0, rawHours - breakHours);
                duration = netHours.toFixed(2);
            } else if (b.type === 'Urlaub' || b.type === 'Krank') {
                duration = '8.00';
            }

            worksheet.addRow({
                date: dateStr,
                name: b.display_name,
                type: b.type,
                start: b.start_time || '-',
                end: b.end_time || '-',
                duration: duration,
                remarks: b.remarks || ''
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=' + `Export_${year}_${month}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (e) {
        // console.error("Excel Export Fehler:", e);
        res.status(500).send("Fehler beim Exportieren: " + e.message);
    }
};