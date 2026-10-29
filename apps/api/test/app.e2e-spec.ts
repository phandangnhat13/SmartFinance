import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AI_TAXONOMY } from '@smart-finance/shared-types';
import request from 'supertest';
import type { SuperAgentTest } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';

interface AccountBody {
  id: string;
  name: string;
  balance: string;
}

interface TransactionBody {
  id: string;
  description: string;
  amount: string;
  type: string;
  occurredAt: string;
}

describe('Smart Finance API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: SuperAgentTest;
  let otherAgent: SuperAgentTest;

  const state = {
    userId: '',
    cashAccountId: '',
    bankAccountId: '',
    otherUserId: '',
    foodCategoryId: '',
    salaryCategoryId: '',
    expenseId: '',
    incomeId: '',
    transferOutId: '',
    budgetId: '',
    importBatchId: '',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');

    for (const item of AI_TAXONOMY) {
      await prisma.category.upsert({
        where: { slug: item.slug },
        update: { name: item.name, type: item.type, isSystem: true, isArchived: false },
        create: {
          slug: item.slug,
          name: item.name,
          type: item.type,
          isSystem: true,
        },
      });
    }

    agent = request.agent(app.getHttpServer()) as unknown as SuperAgentTest;
    otherAgent = request.agent(app.getHttpServer()) as unknown as SuperAgentTest;
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes a health endpoint', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(response.body).toMatchObject({
      database: 'up',
    });
    expect(response.body).toHaveProperty('aiService');
  });

  it('rejects unauthenticated access to protected resources', async () => {
    await request(app.getHttpServer()).get('/api/v1/accounts').expect(401);
  });

  it('rejects unsafe requests from a foreign origin', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', 'https://evil.example')
      .send({ email: 'evil@example.com', password: 'Password123!' })
      .expect(403);
  });

  it('registers a user and sets an HttpOnly session cookie', async () => {
    const response = await agent
      .post('/api/v1/auth/register')
      .send({ email: 'an@example.com', password: 'Password123!', displayName: 'An' })
      .expect(201);

    state.userId = response.body.user.id as string;
    expect(response.headers['set-cookie']?.[0]).toContain('sf_access_token=');
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');

    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.user.email).toBe('an@example.com');
  });

  it('creates accounts with initial balances', async () => {
    const cash = await agent
      .post('/api/v1/accounts')
      .send({ name: 'Tiền mặt', type: 'CASH', initialBalance: '1000000', currency: 'VND' })
      .expect(201);
    state.cashAccountId = cash.body.account.id as string;
    expect(cash.body.account.balance).toBe('1000000.00');

    const bank = await agent
      .post('/api/v1/accounts')
      .send({ name: 'Vietcombank', type: 'BANK', initialBalance: '0', currency: 'VND' })
      .expect(201);
    state.bankAccountId = bank.body.account.id as string;
  });

  it('resolves system categories for transactions', async () => {
    const response = await agent.get('/api/v1/categories?type=EXPENSE').expect(200);
    const categories = response.body.items as { id: string; slug: string | null }[];
    const food = categories.find((category) => category.slug === 'food');
    expect(food).toBeDefined();
    state.foodCategoryId = food!.id;

    const income = await agent.get('/api/v1/categories?type=INCOME').expect(200);
    const salary = (income.body.items as { id: string; slug: string | null }[]).find(
      (category) => category.slug === 'salary',
    );
    expect(salary).toBeDefined();
    state.salaryCategoryId = salary!.id;
  });

  it('creates expense and income transactions and updates balances', async () => {
    const expense = await agent
      .post('/api/v1/transactions')
      .send({
        accountId: state.cashAccountId,
        categoryId: state.foodCategoryId,
        type: 'EXPENSE',
        amount: '100000',
        occurredAt: '2026-10-15T03:00:00.000Z',
        description: 'Ăn trưa văn phòng',
      })
      .expect(201);
    state.expenseId = (expense.body.transaction as TransactionBody).id;

    const income = await agent
      .post('/api/v1/transactions')
      .send({
        accountId: state.cashAccountId,
        categoryId: state.salaryCategoryId,
        type: 'INCOME',
        amount: '500000',
        occurredAt: '2026-10-01T03:00:00.000Z',
        description: 'Lương tháng 10',
      })
      .expect(201);
    state.incomeId = (income.body.transaction as TransactionBody).id;

    const accounts = await agent.get('/api/v1/accounts').expect(200);
    const cash = (accounts.body.items as AccountBody[]).find(
      (account) => account.id === state.cashAccountId,
    );
    expect(cash?.balance).toBe('1400000.00');
  });

  it('rejects invalid money and mismatched category types', async () => {
    await agent
      .post('/api/v1/transactions')
      .send({
        accountId: state.cashAccountId,
        categoryId: state.foodCategoryId,
        type: 'EXPENSE',
        amount: '-5000',
        occurredAt: '2026-10-15T03:00:00.000Z',
        description: 'Số âm',
      })
      .expect(400);

    const mismatch = await agent
      .post('/api/v1/transactions')
      .send({
        accountId: state.cashAccountId,
        categoryId: state.salaryCategoryId,
        type: 'EXPENSE',
        amount: '5000',
        occurredAt: '2026-10-15T03:00:00.000Z',
        description: 'Sai loại danh mục',
      })
      .expect(400);
    expect(mismatch.body.statusCode).toBe(400);
  });

  it('moves money atomically between accounts as transfers', async () => {
    const response = await agent
      .post('/api/v1/transactions/transfers')
      .send({
        fromAccountId: state.cashAccountId,
        toAccountId: state.bankAccountId,
        amount: '200000',
        occurredAt: '2026-10-20T03:00:00.000Z',
        description: 'Nạp tiền vào ngân hàng',
      })
      .expect(201);

    const pairs = response.body.transactions as TransactionBody[];
    expect(pairs).toHaveLength(2);
    state.transferOutId = pairs.find((transaction) => transaction.type === 'TRANSFER')!.id;

    const accounts = await agent.get('/api/v1/accounts').expect(200);
    const balances = new Map(
      (accounts.body.items as AccountBody[]).map((account) => [account.id, account.balance]),
    );
    expect(balances.get(state.cashAccountId)).toBe('1200000.00');
    expect(balances.get(state.bankAccountId)).toBe('200000.00');
  });

  it('excludes transfers from income and expense analytics', async () => {
    const summary = await agent
      .get('/api/v1/analytics/summary?from=2026-10-01&to=2026-10-31')
      .expect(200);
    expect(summary.body).toMatchObject({
      income: '500000.00',
      expense: '100000.00',
      net: '400000.00',
      transactionCount: 2,
    });

    const byCategory = await agent
      .get('/api/v1/analytics/by-category?from=2026-10-01&to=2026-10-31')
      .expect(200);
    expect(byCategory.body.total).toBe('100000.00');

    const trend = await agent
      .get('/api/v1/analytics/trend?from=2026-09-01&to=2026-10-31&interval=month')
      .expect(200);
    const points = trend.body.points as { period: string; income: string; expense: string }[];
    const october = points.find((point) => point.period.startsWith('2026-10'));
    expect(october?.expense).toBe('100000.00');
    expect(october?.income).toBe('500000.00');
  });

  it('enforces ownership across users', async () => {
    const other = await otherAgent
      .post('/api/v1/auth/register')
      .send({ email: 'binh@example.com', password: 'Password123!' })
      .expect(201);
    state.otherUserId = other.body.user.id as string;

    await otherAgent.get(`/api/v1/transactions/${state.expenseId}`).expect(404);
    await otherAgent
      .patch(`/api/v1/accounts/${state.cashAccountId}`)
      .send({ name: 'Hacked' })
      .expect(404);
    await otherAgent
      .post('/api/v1/transactions')
      .send({
        accountId: state.cashAccountId,
        categoryId: state.foodCategoryId,
        type: 'EXPENSE',
        amount: '1000',
        occurredAt: '2026-10-15T03:00:00.000Z',
        description: 'Cross-user',
      })
      .expect(400);

    const otherAccounts = await otherAgent.get('/api/v1/accounts').expect(200);
    expect(otherAccounts.body.items).toHaveLength(0);
  });

  it('tracks budgets and only persists each alert threshold once', async () => {
    const created = await agent
      .post('/api/v1/budgets')
      .send({
        name: 'Ngân sách ăn uống',
        categoryId: state.foodCategoryId,
        month: '2026-10',
        limitAmount: '500000',
        warningThresholds: [80, 100],
      })
      .expect(201);
    state.budgetId = created.body.budget.id as string;
    expect(created.body.budget.status).toBe('OK');
    expect(created.body.budget.alerts).toHaveLength(0);

    await agent
      .post('/api/v1/transactions')
      .send({
        accountId: state.cashAccountId,
        categoryId: state.foodCategoryId,
        type: 'EXPENSE',
        amount: '400000',
        occurredAt: '2026-10-21T03:00:00.000Z',
        description: 'Tiệc cuối tháng',
      })
      .expect(201);

    const first = await agent.get('/api/v1/budgets?month=2026-10').expect(200);
    const budget = (
      first.body.items as { id: string; status: string; percentage: number; alerts: unknown[] }[]
    ).find((item) => item.id === state.budgetId)!;
    expect(budget.status).toBe('EXCEEDED');
    expect(budget.percentage).toBe(100);
    expect(budget.alerts).toHaveLength(2);

    const second = await agent.get('/api/v1/budgets?month=2026-10').expect(200);
    const repeated = (second.body.items as { id: string; alerts: unknown[] }[]).find(
      (item) => item.id === state.budgetId,
    )!;
    expect(repeated.alerts).toHaveLength(2);

    const alertCount = await prisma.budgetAlert.count({ where: { budgetId: state.budgetId } });
    expect(alertCount).toBe(2);
  });

  it('previews CSV imports, flags duplicates and commits only valid rows', async () => {
    const csv = [
      'account,type,amount,occurredAt,description,category,note,currency',
      'Tiền mặt,EXPENSE,65000,2026-10-25,Highlands Coffee,Ăn uống,,VND',
      'Tiền mặt,EXPENSE,65000,2026-10-25,Highlands Coffee,Ăn uống,,VND',
      'Tiền mặt,EXPENSE,not-a-number,2026-10-25,Dòng lỗi,Ăn uống,,VND',
    ].join('\n');

    const preview = await agent
      .post('/api/v1/imports/csv')
      .attach('file', Buffer.from(csv, 'utf8'), 'transactions.csv')
      .expect(201);

    expect(preview.body.batch).toMatchObject({
      totalRows: 3,
      validRows: 1,
      invalidRows: 1,
      duplicateRows: 1,
      status: 'PREVIEW_READY',
    });
    state.importBatchId = preview.body.batch.id as string;

    const commit = await agent.post(`/api/v1/imports/${state.importBatchId}/commit`).expect(200);
    expect(commit.body.batch).toMatchObject({ status: 'COMPLETED', importedRows: 1 });

    await agent.post(`/api/v1/imports/${state.importBatchId}/commit`).expect(409);

    const replay = await agent
      .post('/api/v1/imports/csv')
      .attach('file', Buffer.from(csv, 'utf8'), 'transactions.csv')
      .expect(201);
    expect(replay.body.batch.validRows).toBe(0);
    expect(replay.body.batch.duplicateRows).toBe(2);
  });

  it('exports CSV with formula injection escaped', async () => {
    await agent
      .post('/api/v1/transactions')
      .send({
        accountId: state.cashAccountId,
        categoryId: state.foodCategoryId,
        type: 'EXPENSE',
        amount: '1000',
        occurredAt: '2026-10-26T03:00:00.000Z',
        description: '=SUM(A1:A2)',
      })
      .expect(201);

    const response = await agent.get('/api/v1/exports/transactions.csv').expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain("'=SUM(A1:A2)");
  });

  it('falls back gracefully when the AI service is unreachable', async () => {
    const response = await agent
      .post('/api/v1/ai/classify-transaction')
      .send({ description: 'Highlands Coffee', type: 'EXPENSE' })
      .expect(200);
    expect(response.body.status).toBe('model_not_ready');
    expect(response.body.categoryId).toBeNull();
  });

  it('returns the required error envelope', async () => {
    const response = await agent.get('/api/v1/transactions/not-a-uuid').expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(typeof response.body.message).toBe('string');
  });
});
