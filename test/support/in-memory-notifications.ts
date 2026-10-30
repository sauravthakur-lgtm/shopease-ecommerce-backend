import { randomUUID } from 'node:crypto';

// Minimal in-memory stand-in for the Prisma notification/user delegates used by
// NotificationsService. It enforces the (userId, dedupeKey) unique index with
// PostgreSQL semantics (NULL keys never conflict) and applies `where` filters,
// so ownership and duplicate handling can be tested without a database.

export interface StoredNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  data: unknown;
  isRead: boolean;
  readAt: Date | null;
  dedupeKey: string | null;
  createdAt: Date;
}

type Where = Partial<Pick<StoredNotification, 'id' | 'userId' | 'isRead'>>;

interface UserRecord {
  id: string;
  role: string;
  isActive: boolean;
}

function matches(row: StoredNotification, where: Where = {}) {
  return Object.entries(where).every(
    ([key, value]) => row[key as keyof StoredNotification] === value,
  );
}

function pick(row: StoredNotification, select?: Record<string, boolean>) {
  if (!select) return { ...row };
  return Object.fromEntries(
    Object.keys(select)
      .filter((key) => select[key])
      .map((key) => [key, row[key as keyof StoredNotification]]),
  );
}

export function createInMemoryNotificationsPrisma(users: UserRecord[] = []) {
  const rows: StoredNotification[] = [];
  let clock = Date.parse('2026-10-30T00:00:00.000Z');

  const isDuplicate = (userId: string, dedupeKey: string | null) =>
    dedupeKey !== null &&
    rows.some((row) => row.userId === userId && row.dedupeKey === dedupeKey);

  const notification = {
    createMany: jest.fn(
      async ({
        data,
        skipDuplicates,
      }: {
        data: Array<Partial<StoredNotification>>;
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const input of data) {
          const dedupeKey = input.dedupeKey ?? null;
          if (isDuplicate(input.userId!, dedupeKey)) {
            if (skipDuplicates) continue;
            throw new Error('Unique constraint failed on (userId, dedupeKey)');
          }
          clock += 1000;
          rows.push({
            id: randomUUID(),
            userId: input.userId!,
            type: input.type!,
            title: input.title!,
            message: input.message!,
            data: input.data ?? null,
            isRead: false,
            readAt: null,
            dedupeKey,
            createdAt: new Date(clock),
          });
          count += 1;
        }
        return { count };
      },
    ),
    findMany: jest.fn(
      async ({
        where,
        skip = 0,
        take,
        select,
      }: {
        where?: Where;
        skip?: number;
        take?: number;
        select?: Record<string, boolean>;
      }) =>
        rows
          .filter((row) => matches(row, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(skip, take === undefined ? undefined : skip + take)
          .map((row) => pick(row, select)),
    ),
    count: jest.fn(async ({ where }: { where?: Where }) =>
      rows.filter((row) => matches(row, where)).length,
    ),
    findFirst: jest.fn(
      async ({ where, select }: { where?: Where; select?: Record<string, boolean> }) => {
        const row = rows.find((candidate) => matches(candidate, where));
        return row ? pick(row, select) : null;
      },
    ),
    updateMany: jest.fn(
      async ({ where, data }: { where?: Where; data: Partial<StoredNotification> }) => {
        const targets = rows.filter((row) => matches(row, where));
        targets.forEach((row) => Object.assign(row, data));
        return { count: targets.length };
      },
    ),
    deleteMany: jest.fn(async ({ where }: { where?: Where }) => {
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index], where)) rows.splice(index, 1);
      }
      return { count: before - rows.length };
    }),
  };

  const user = {
    findMany: jest.fn(
      async ({ where }: { where: { role: string; isActive: boolean } }) =>
        users
          .filter(
            (candidate) =>
              candidate.role === where.role &&
              candidate.isActive === where.isActive,
          )
          .map(({ id }) => ({ id })),
    ),
  };

  return { prisma: { notification, user }, rows };
}
