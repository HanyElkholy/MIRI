const db = require('../config/db');

exports.getNotifications = async (req, res) => {
    const { id, role, customerId } = req.user;
    try {
        let result = { items: [], count: 0 };
        
        if (role === 'admin') {
            // Admin sieht offene Anträge [cite: 313]
            const r = await db.query(
                `SELECT r.id, r.type, TO_CHAR(r.date, 'DD.MM.YYYY') as date, u.display_name as user
                 FROM requests r JOIN users u ON r.user_id = u.id
                 WHERE u.customer_id = $1 AND r.status = 'pending' ORDER BY r.id DESC`,
                [customerId]
            );
            result.items = r.rows;
            result.type = 'admin_open_requests';
        } else {
            // User sieht Antworten auf Anträge [cite: 326]
            const r = await db.query(
                `SELECT id, status, type, reason, TO_CHAR(date, 'DD.MM.YYYY') as date
                 FROM requests 
                 WHERE user_id = $1 AND status != 'pending' AND user_seen = FALSE ORDER BY id DESC`,
                [id]
            );
            result.items = r.rows;
            result.type = 'user_updates';
        }
        
        result.count = result.items.length;
        res.json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "DB Error" });
    }
};

exports.markRead = async (req, res) => {
    try {
        await db.query(`UPDATE requests SET user_seen = TRUE WHERE user_id = $1`, [req.user.id]);
        res.json({ status: "success" });
    } catch (e) { res.status(500).json({}); }
};