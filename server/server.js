import "dotenv/config";
import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";

const app = express();
app.use(cors());

const pool = mysql.createPool({
  host: process.env.DB_HOST, // 127.0.0.1 if tunneling
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, // reader user is safest
  password: process.env.DB_PASS,
  database: process.env.DB_NAME, // spirulinadb
});

app.get("/api/watchlist", async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, product, price, url, stock_status, updated_at
      FROM watchlist
      ORDER BY updated_at DESC
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "query_failed" });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`API on :${port}`));
