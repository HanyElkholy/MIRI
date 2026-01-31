const db = require('../config/db');

exports.logAudit = async (customerId, actor, action, oldVal, newVal, affectedUser) => {
    try {
        await db.query(
            `INSERT INTO audit_logs (customer_id, actor, action, old_value, new_value, affected_user)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [customerId, actor, action, oldVal || '', newVal || '', affectedUser || actor]
        );
    } catch (e) {
        console.error("Audit Log Fehler:", e);
    }
};