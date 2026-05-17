import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

let pool;
let schemaReady = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const localDataDir = path.join(__dirname, '..', 'data');
const localStoreFile = path.join(localDataDir, 'collab_documents.json');

function hasDatabaseConfig() {
  return Boolean(process.env.DATABASE_URL || process.env.DB_HOST || process.env.PGHOST);
}

function getPool() {
  if (!hasDatabaseConfig()) {
    return null;
  }

  if (!pool) {
    pool = process.env.DATABASE_URL
      ? new Pool({ connectionString: process.env.DATABASE_URL })
      : new Pool({
          host: process.env.DB_HOST ?? process.env.PGHOST ?? 'localhost',
          port: Number(process.env.DB_PORT ?? process.env.PGPORT ?? 5432),
          database: process.env.DB_NAME ?? process.env.PGDATABASE ?? 'extra_editable',
          user: process.env.DB_USER ?? process.env.PGUSER ?? 'postgres',
          password: process.env.DB_PASSWORD ?? process.env.PGPASSWORD ?? 'postgres',
        });
  }

  return pool;
}

async function ensureSchema() {
  const db = getPool();
  if (!db || schemaReady) {
    return db;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS collab_documents (
      room_name TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  schemaReady = true;
  return db;
}

async function readLocalStore() {
  try {
    const raw = await readFile(localStoreFile, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

async function writeLocalStore(store) {
  await mkdir(localDataDir, { recursive: true });
  await writeFile(localStoreFile, JSON.stringify(store, null, 2), 'utf8');
}

export async function getStoredDocumentContent(roomName) {
  const db = await ensureSchema();
  if (!db) {
    const store = await readLocalStore();
    const content = typeof store?.[roomName] === 'string' ? store[roomName] : '';
    return { found: content.length > 0 || Object.prototype.hasOwnProperty.call(store, roomName), content };
  }

  const result = await db.query(
    'SELECT content FROM collab_documents WHERE room_name = $1',
    [roomName],
  );

  if (result.rows.length === 0) {
    return { found: false, content: '' };
  }

  return { found: true, content: String(result.rows[0].content ?? '') };
}

export async function upsertStoredDocumentContent(roomName, content) {
  const db = await ensureSchema();
  if (!db) {
    const store = await readLocalStore();
    store[roomName] = content;
    await writeLocalStore(store);
    return true;
  }

  await db.query(
    `
      INSERT INTO collab_documents (room_name, content, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (room_name)
      DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
    `,
    [roomName, content],
  );

  return true;
}

export async function closeDocumentStore() {
  if (pool) {
    await pool.end();
    pool = undefined;
    schemaReady = false;
  }
}