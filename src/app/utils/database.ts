import { Pool, QueryResult, PoolClient, QueryResultRow } from 'pg';
import logger from '../utils/logger';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err: Error, client: PoolClient) => {
  logger.error('Unexpected error on idle client', {
    error: err,
    client,
  });
});

export const query = async <T extends QueryResultRow>(
  text: string,
  // The 'pg' library uses `any[]` for parameters, so we align with that here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any[] = []
): Promise<QueryResult<T>> => {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    logger.debug('executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    logger.error('Error executing query', {
      text,
      error,
    });
    throw error;
  }
};

export const getClient = async (): Promise<PoolClient> => {
  const client = await pool.connect();
  return client;
};

export default pool;
