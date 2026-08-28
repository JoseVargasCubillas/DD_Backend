import mysql, { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { env } from './env.js';

let pool: Pool | null = null;

const entityTables = [
  'users',
  'courses',
  'modules',
  'lessons',
  'events',
  'blog_posts',
  'orders',
  'subscriptions',
  'tags',
  'packages',
  'promotions',
  'offers',
  'course_comments',
  'books',
  'email_queue_jobs',
  'leads',
] as const;

const quoteId = (identifier: string): string => `\`${identifier.replace(/`/g, '``')}\``;

const createEntityTableSql = (table: string): string => `
  CREATE TABLE IF NOT EXISTS ${quoteId(table)} (
    id VARCHAR(36) PRIMARY KEY,
    data LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const getPool = (): Pool => {
  if (!pool) throw new Error('MySQL pool has not been initialized. Call connectDB() first.');
  return pool;
};

export const query = async <T extends RowDataPacket[] | ResultSetHeader>(
  sql: string,
  params: any[] = [],
): Promise<T> => {
  const [rows] = await getPool().execute(sql, params);
  return rows as T;
};

const ensureDatabase = async (): Promise<void> => {
  const connection = await mysql.createConnection({
    host: env.database.host,
    port: env.database.port,
    user: env.database.user,
    password: env.database.password,
    multipleStatements: false,
  });

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS ${quoteId(env.database.name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await connection.end();
};

const initializeSchema = async (): Promise<void> => {
  await Promise.all(entityTables.map((table) => query<ResultSetHeader>(createEntityTableSql(table))));
};

export const connectDB = async (): Promise<void> => {
  await ensureDatabase();

  pool = mysql.createPool({
    host: env.database.host,
    port: env.database.port,
    user: env.database.user,
    password: env.database.password,
    database: env.database.name,
    waitForConnections: true,
    connectionLimit: env.database.connectionLimit,
    namedPlaceholders: false,
  });

  await query<RowDataPacket[]>('SELECT 1 AS ok');
  await initializeSchema();

  console.log(`MySQL connected: ${env.database.host}:${env.database.port}/${env.database.name}`);
};
