import { randomUUID } from 'node:crypto';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from '../../../config/database.js';

type AnyRecord = Record<string, any>;
type SortInput = string | Record<string, 1 | -1>;
type QueryOptions = {
  select?: string;
  skip?: number;
  limit?: number;
  sort?: SortInput;
  populate: Array<{ path: string; select?: string }>;
};

export interface SqlDocumentMethods<T> {
  _id: string;
  id: string;
  save(): Promise<T>;
}

interface StoredRow extends RowDataPacket {
  id: string;
  data: string;
  created_at: Date;
  updated_at: Date;
}

interface CreateModelOptions<T extends AnyRecord> {
  table: string;
  defaults?: () => Partial<T>;
}

const registry = new Map<string, SqlModel<any>>();

const fieldModelMap: Record<string, string> = {
  author: 'users',
  course: 'courses',
  enrolledCourses: 'courses',
  instructor: 'users',
  lessons: 'lessons',
  user: 'users',
};

const isObject = (value: unknown): value is AnyRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toMysqlDate = (value: Date = new Date()): string =>
  value.toISOString().slice(0, 19).replace('T', ' ');

const normalizeDateValue = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeDateValue);
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, normalizeDateValue(val)]));
  }
  return value;
};

const cloneData = <T>(value: T): T => JSON.parse(JSON.stringify(normalizeDateValue(value))) as T;

const readData = <T extends AnyRecord>(row: StoredRow): T => {
  const data = JSON.parse(row.data) as T;
  return {
    ...data,
    _id: data._id ?? row.id,
    id: data.id ?? data._id ?? row.id,
    createdAt: data.createdAt ?? row.created_at,
    updatedAt: data.updatedAt ?? row.updated_at,
  };
};

const getValue = (doc: AnyRecord, key: string): unknown => doc[key];

const matchesTextSearch = (doc: AnyRecord, term: string): boolean => {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return true;

  const collect = (value: unknown): string[] => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(collect);
    if (isObject(value)) return Object.values(value).flatMap(collect);
    return [];
  };

  return collect(doc).some((value) => value.toLowerCase().includes(normalized));
};

const matchesFilter = (doc: AnyRecord, filter: AnyRecord): boolean => {
  for (const [key, expected] of Object.entries(filter)) {
    if (key === '$text' && isObject(expected)) {
      if (!matchesTextSearch(doc, String(expected.$search ?? ''))) return false;
      continue;
    }

    const actual = getValue(doc, key);
    if (isObject(expected)) {
      if ('$ne' in expected && actual === expected.$ne) return false;
      if ('$in' in expected && Array.isArray(expected.$in) && !expected.$in.includes(actual)) return false;
      if ('$nin' in expected && Array.isArray(expected.$nin) && expected.$nin.includes(actual)) return false;
      continue;
    }

    if (Array.isArray(actual)) {
      if (!actual.includes(expected)) return false;
      continue;
    }

    if (actual !== expected) return false;
  }

  return true;
};

const getSortEntries = (sort?: SortInput): Array<[string, 1 | -1]> => {
  if (!sort) return [];
  if (typeof sort === 'string') {
    return [[sort.startsWith('-') ? sort.slice(1) : sort, sort.startsWith('-') ? -1 : 1]];
  }
  return Object.entries(sort);
};

const compareValues = (a: unknown, b: unknown): number => {
  const aValue = typeof a === 'string' && !Number.isNaN(Date.parse(a)) ? Date.parse(a) : a;
  const bValue = typeof b === 'string' && !Number.isNaN(Date.parse(b)) ? Date.parse(b) : b;

  if (aValue === bValue) return 0;
  if (aValue === undefined || aValue === null) return -1;
  if (bValue === undefined || bValue === null) return 1;
  return aValue > bValue ? 1 : -1;
};

const applyUpdate = (doc: AnyRecord, update: AnyRecord): AnyRecord => {
  const next = { ...doc };

  for (const [key, value] of Object.entries(update)) {
    if (key === '$inc' && isObject(value)) {
      for (const [field, amount] of Object.entries(value)) {
        next[field] = Number(next[field] ?? 0) + Number(amount);
      }
      continue;
    }

    if (key === '$addToSet' && isObject(value)) {
      for (const [field, item] of Object.entries(value)) {
        const current = Array.isArray(next[field]) ? next[field] : [];
        next[field] = current.includes(item) ? current : [...current, item];
      }
      continue;
    }

    if (key === '$push' && isObject(value)) {
      for (const [field, item] of Object.entries(value)) {
        const current = Array.isArray(next[field]) ? next[field] : [];
        next[field] = [...current, item];
      }
      continue;
    }

    if (key === '$pull' && isObject(value)) {
      for (const [field, item] of Object.entries(value)) {
        const current = Array.isArray(next[field]) ? next[field] : [];
        next[field] = current.filter((entry: unknown) => entry !== item);
      }
      continue;
    }

    next[key] = value;
  }

  next.updatedAt = new Date().toISOString();
  return next;
};

const applySelect = <T extends AnyRecord>(doc: T, select?: string): T => {
  if (!select) return doc;
  const fields = select.split(/\s+/).filter(Boolean);

  if (fields.includes('-password')) {
    const { password: _password, ...rest } = doc;
    return rest as T;
  }

  return doc;
};

const pickFields = (doc: AnyRecord, select?: string): AnyRecord => {
  if (!select) return doc;
  const fields = select.split(/\s+/).filter(Boolean).filter((field) => !field.startsWith('-'));
  if (!fields.length) return applySelect(doc, select);

  const picked: AnyRecord = { _id: doc._id, id: doc.id ?? doc._id };
  for (const field of fields) picked[field] = doc[field];
  return picked;
};

export class SqlQuery<T> implements PromiseLike<T> {
  private options: QueryOptions = { populate: [] };
  private promise: Promise<T> | null = null;

  constructor(private readonly runner: (options: QueryOptions) => Promise<T>) {}

  select(fields: string): this {
    this.options.select = fields;
    return this;
  }

  populate(path: string, select?: string): this {
    this.options.populate.push({ path, select });
    return this;
  }

  skip(value: number): this {
    this.options.skip = value;
    return this;
  }

  limit(value: number): this {
    this.options.limit = value;
    return this;
  }

  sort(value: SortInput): this {
    this.options.sort = value;
    return this;
  }

  exec(): Promise<T> {
    this.promise ??= this.runner(this.options);
    return this.promise;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

export class SqlModel<T extends AnyRecord> {
  constructor(private readonly options: CreateModelOptions<T>) {
    registry.set(options.table, this);
  }

  async create(input: Partial<T>): Promise<T> {
    const now = new Date();
    const id = String((input as AnyRecord)._id ?? randomUUID());
    const doc = this.attachDocument({
      ...(this.options.defaults?.() ?? {}),
      ...cloneData(input),
      _id: id,
      id,
      createdAt: (input as AnyRecord).createdAt ?? now.toISOString(),
      updatedAt: (input as AnyRecord).updatedAt ?? now.toISOString(),
    } as unknown as T);

    await this.upsert(doc);
    return doc;
  }

  find(filter: AnyRecord = {}): SqlQuery<T[]> {
    return new SqlQuery((queryOptions) => this.findMany(filter, queryOptions));
  }

  findOne(filter: AnyRecord): SqlQuery<T | null> {
    return new SqlQuery(async (queryOptions) => {
      const [doc] = await this.findMany(filter, { ...queryOptions, limit: 1 });
      return doc ?? null;
    });
  }

  findById(id: string): SqlQuery<T | null> {
    return this.findOne({ _id: id });
  }

  findByIdAndUpdate(id: string, update: Partial<T> | AnyRecord, _options: AnyRecord = {}): SqlQuery<T | null> {
    return new SqlQuery(async (queryOptions) => {
      const current = await this.findById(id);
      if (!current) return null;
      const updated = this.attachDocument(applyUpdate(current, update as AnyRecord) as T);
      await this.upsert(updated);
      return this.applyResultOptions(updated, queryOptions);
    });
  }

  findOneAndUpdate(filter: AnyRecord, update: Partial<T> | AnyRecord, _options: AnyRecord = {}): SqlQuery<T | null> {
    return new SqlQuery(async (queryOptions) => {
      const current = await this.findOne(filter);
      if (!current) return null;
      const updated = this.attachDocument(applyUpdate(current, update as AnyRecord) as T);
      await this.upsert(updated);
      return this.applyResultOptions(updated, queryOptions);
    });
  }

  async findByIdAndDelete(id: string): Promise<T | null> {
    const current = await this.findById(id);
    if (!current) return null;
    await query<ResultSetHeader>(`DELETE FROM \`${this.options.table}\` WHERE id = ?`, [id]);
    return current;
  }

  async countDocuments(filter: AnyRecord = {}): Promise<number> {
    const docs = await this.readAll();
    return docs.filter((doc) => matchesFilter(doc, filter)).length;
  }

  private async findMany(filter: AnyRecord, queryOptions: QueryOptions): Promise<T[]> {
    let docs = (await this.readAll()).filter((doc) => matchesFilter(doc, filter));

    const sortEntries = getSortEntries(queryOptions.sort);
    if (sortEntries.length) {
      docs = [...docs].sort((left, right) => {
        for (const [field, direction] of sortEntries) {
          const result = compareValues(left[field], right[field]);
          if (result !== 0) return result * direction;
        }
        return 0;
      });
    }

    if (queryOptions.skip) docs = docs.slice(queryOptions.skip);
    if (queryOptions.limit !== undefined) docs = docs.slice(0, queryOptions.limit);

    return Promise.all(docs.map((doc) => this.applyResultOptions(doc, queryOptions)));
  }

  private async readAll(): Promise<T[]> {
    const rows = await query<StoredRow[]>(`SELECT id, data, created_at, updated_at FROM \`${this.options.table}\``);
    return rows.map((row) => this.attachDocument(readData<T>(row)));
  }

  private async upsert(doc: T): Promise<void> {
    const id = String(doc._id ?? (doc as AnyRecord).id);
    const now = new Date();
    const createdAt = new Date(String((doc as AnyRecord).createdAt ?? now.toISOString()));
    const updatedAt = new Date(String((doc as AnyRecord).updatedAt ?? now.toISOString()));
    const data = JSON.stringify(cloneData({ ...doc, _id: id, id }));

    await query<ResultSetHeader>(
      `INSERT INTO \`${this.options.table}\` (id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)`,
      [id, data, toMysqlDate(createdAt), toMysqlDate(updatedAt)],
    );
  }

  private attachDocument(doc: T): T {
    const model = this;
    const target = {
      ...doc,
      _id: String(doc._id ?? (doc as AnyRecord).id),
      id: String((doc as AnyRecord).id ?? doc._id),
    } as T;

    Object.defineProperty(target, 'save', {
      enumerable: false,
      value: async function save() {
        (target as AnyRecord).updatedAt = new Date().toISOString();
        await model.upsert(target);
        return target;
      },
    });

    return target;
  }

  private async applyResultOptions(doc: T, queryOptions: QueryOptions): Promise<T> {
    let result = cloneData(doc) as AnyRecord;

    for (const populate of queryOptions.populate) {
      const table = fieldModelMap[populate.path];
      const model = table ? registry.get(table) : null;
      if (!model) continue;

      const current = result[populate.path];
      if (Array.isArray(current)) {
        const related = await Promise.all(current.map((id) => model.findById(String(id))));
        result[populate.path] = related.filter(Boolean).map((entry) => pickFields(entry as AnyRecord, populate.select));
      } else if (current) {
        const related = await model.findById(String(current));
        if (related) result[populate.path] = pickFields(related as AnyRecord, populate.select);
      }
    }

    result = applySelect(result, queryOptions.select);
    return this.attachDocument(result as T);
  }
}

export const createSqlModel = <T extends AnyRecord>(options: CreateModelOptions<T>): SqlModel<T> =>
  new SqlModel<T>(options);
