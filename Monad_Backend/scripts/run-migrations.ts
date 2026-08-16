import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const connectionString = process.env.APY_DATABASE_URL;
  if (!connectionString) {
    console.error("APY_DATABASE_URL is not set in environment.");
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  const migrationsDir = path.resolve(__dirname, "../src/core/services/apy/db/migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  console.log(`Found ${files.length} migrations in ${migrationsDir}:`);

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, "utf8");
    console.log(`Running migration ${file}...`);
    try {
      await pool.query(sql);
      console.log(`✓ Applied ${file}`);
    } catch (err: any) {
      console.error(`✗ Error applying ${file}:`, err.message);
    }
  }

  await pool.end();
  console.log("All migrations finished!");
}

run();
