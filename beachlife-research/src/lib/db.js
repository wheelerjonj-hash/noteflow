import pg from 'pg';
import { log } from './log.js';

let pool;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString, max: 8 });
    pool.on('error', (err) => log.error('pg pool error', { err: err.message }));
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

export async function withTx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function close() {
  if (pool) await pool.end();
  pool = undefined;
}

/** Open an ingest_run row; returns { id, finish(status, counts) }. */
export async function startRun(source, note) {
  const { rows } = await query(
    'INSERT INTO ingest_run (source, note) VALUES ($1, $2) RETURNING id',
    [source, note ?? null],
  );
  const id = rows[0].id;
  log.info('ingest run started', { source, run: id });
  return {
    id,
    async finish(status, { rowsIn = 0, rowsWritten = 0, note: n } = {}) {
      await query(
        `UPDATE ingest_run
            SET finished_at = now(), status = $2, rows_in = $3, rows_written = $4,
                note = COALESCE($5, note)
          WHERE id = $1`,
        [id, status, rowsIn, rowsWritten, n ?? null],
      );
      log.info('ingest run finished', { source, run: id, status, rowsIn, rowsWritten });
    },
  };
}
