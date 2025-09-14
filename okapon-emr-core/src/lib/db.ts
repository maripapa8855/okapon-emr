import pg from "pg";
const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const q = (text: string, params?: any[]) => pool.query(text, params);