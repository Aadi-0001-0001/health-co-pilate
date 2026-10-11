const mysql = require('mysql2/promise');

const cfg = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};
const DB_NAME = process.env.DB_NAME || 'healthcopilot';
let pool;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS health_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('heart_rate','steps','sleep','calories') NOT NULL,
    \`value\` DOUBLE NOT NULL,
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    category VARCHAR(50) DEFAULT 'Lab Reports',
    source VARCHAR(150),
    file_path VARCHAR(255) NOT NULL,
    mime VARCHAR(100),
    ai_summary TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS medicines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    dose VARCHAR(50),
    timing VARCHAR(50),
    \`time\` CHAR(5) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS medicine_logs (
    medicine_id INT NOT NULL,
    \`date\` DATE NOT NULL,
    taken TINYINT NOT NULL DEFAULT 1,
    PRIMARY KEY (medicine_id, \`date\`),
    FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS doctors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    specialty VARCHAR(80) NOT NULL,
    degree VARCHAR(100),
    experience INT,
    fee INT,
    rating DECIMAL(2,1),
    reviews INT,
    is_online TINYINT DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    doctor_id INT NOT NULL,
    slot VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'booked',
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    role ENUM('user','assistant') NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
];

// Server start hote hi: database + tables + sample doctors tayar
async function init() {
  const boot = await mysql.createConnection(cfg);
  await boot.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
  await boot.end();

  pool = mysql.createPool({ ...cfg, database: DB_NAME, connectionLimit: 10, decimalNumbers: true });
  for (const sql of SCHEMA) await pool.query(sql);

  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM doctors');
  if (c === 0) {
    await pool.query(
      'INSERT INTO doctors (name,specialty,degree,experience,fee,rating,reviews) VALUES ?',
      [[
        ['Dr. Neha Sharma', 'General Physician', 'MBBS, MD', 8, 499, 4.8, 1200],
        ['Dr. Rahul Verma', 'General Physician', 'MBBS, MD', 10, 599, 4.7, 980],
        ['Dr. Pooja Singh', 'Nutritionist', 'BSc Nutrition', 5, 399, 4.6, 720],
        ['Dr. Amit Khanna', 'Cardiologist', 'MBBS, DM', 12, 899, 4.9, 640],
        ['Dr. Sneha Rao', 'Dermatologist', 'MBBS, MD', 9, 699, 4.7, 510],
      ]]
    );
  }
}

const q = async (sql, params = []) => (await pool.query(sql, params))[0]; // rows ya insert result
const one = async (sql, params = []) => (await q(sql, params))[0];        // sirf pehli row

module.exports = { init, q, one };
