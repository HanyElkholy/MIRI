require('dotenv').config();

const { Pool } = require('pg');

const bcrypt = require('bcrypt');



const pool = new Pool({

  user: process.env.DB_USER,

  host: process.env.DB_HOST,

  database: process.env.DB_NAME,

  password: process.env.DB_PASSWORD,

  port: process.env.DB_PORT,

});



async function resetPassword() {

    const newPassword = "123"; // Oder dein Wunsch-Passwort

    const hashedPassword = await bcrypt.hash(newPassword, 10);



    console.log("Neuer Hash:", hashedPassword);



    try {

        await pool.query(

            'UPDATE users SET password = $1 WHERE username = $2',

            [hashedPassword, 'admin']

        );

        console.log("✅ Admin-Passwort wurde repariert!");

    } catch (e) {

        console.error("Fehler:", e);

    } finally {

        pool.end();

    }

}



resetPassword();
