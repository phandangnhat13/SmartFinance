/**
 * Seed script.
 *
 * - System categories are always upserted (required by the AI taxonomy and by
 *   every user's default category list).
 * - Demo users/transactions are created ONLY when SEED_DEMO=true is passed
 *   explicitly. Nothing is deleted or overwritten.
 */
import { PrismaClient, CategoryType, TransactionType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AI_TAXONOMY } from '@smart-finance/shared-types';

const prisma = new PrismaClient();

const SYSTEM_CATEGORY_NAMES: Record<string, string> = {
  food: 'Ăn uống',
  transport: 'Di chuyển',
  shopping: 'Mua sắm',
  housing: 'Nhà ở',
  health: 'Sức khỏe',
  entertainment: 'Giải trí',
  education: 'Giáo dục',
  transfer_fee: 'Phí chuyển khoản',
  other: 'Khác',
  salary: 'Lương',
  income_other: 'Thu nhập khác',
};

async function seedSystemCategories(): Promise<void> {
  for (const item of AI_TAXONOMY) {
    const type = item.type === 'INCOME' ? CategoryType.INCOME : CategoryType.EXPENSE;
    await prisma.category.upsert({
      where: { slug: item.slug },
      update: {
        name: SYSTEM_CATEGORY_NAMES[item.slug] ?? item.name,
        type,
        isSystem: true,
        userId: null,
      },
      create: {
        slug: item.slug,
        name: SYSTEM_CATEGORY_NAMES[item.slug] ?? item.name,
        type,
        isSystem: true,
        userId: null,
      },
    });
  }
  console.log(`Seeded ${AI_TAXONOMY.length} system categories.`);
}

async function seedDemo(): Promise<void> {
  const email = process.env.DEMO_EMAIL ?? 'demo@smartfinance.local';
  const password = process.env.DEMO_PASSWORD ?? 'Demo1234!';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Demo user ${email} already exists - nothing changed.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: 'Người dùng Demo',
      defaultCurrency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
    },
  });

  const cash = await prisma.account.create({
    data: {
      userId: user.id,
      name: 'Tiền mặt',
      type: 'CASH',
      initialBalance: 2_000_000,
      currency: 'VND',
    },
  });
  const bank = await prisma.account.create({
    data: {
      userId: user.id,
      name: 'Tài khoản ngân hàng',
      type: 'BANK',
      initialBalance: 20_000_000,
      currency: 'VND',
    },
  });

  const categories = await prisma.category.findMany({ where: { isSystem: true } });
  const bySlug = new Map(categories.map((category) => [category.slug, category.id]));

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const previousMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0),
  );

  const samples: Array<{
    accountId: string;
    slug: string | null;
    type: TransactionType;
    amount: number;
    description: string;
    dayOffset: number;
  }> = [
    {
      accountId: bank.id,
      slug: 'salary',
      type: 'INCOME',
      amount: 25_000_000,
      description: 'Lương tháng này',
      dayOffset: 1,
    },
    {
      accountId: bank.id,
      slug: 'housing',
      type: 'EXPENSE',
      amount: 6_000_000,
      description: 'Tiền thuê nhà',
      dayOffset: 2,
    },
    {
      accountId: cash.id,
      slug: 'food',
      type: 'EXPENSE',
      amount: 85_000,
      description: 'Ăn trưa văn phòng',
      dayOffset: 1,
    },
    {
      accountId: cash.id,
      slug: 'food',
      type: 'EXPENSE',
      amount: 210_000,
      description: 'Đi chợ cuối tuần',
      dayOffset: 3,
    },
    {
      accountId: bank.id,
      slug: 'transport',
      type: 'EXPENSE',
      amount: 120_000,
      description: 'Đổ xăng xe máy',
      dayOffset: 3,
    },
    {
      accountId: bank.id,
      slug: 'shopping',
      type: 'EXPENSE',
      amount: 450_000,
      description: 'Mua quần áo',
      dayOffset: 4,
    },
    {
      accountId: cash.id,
      slug: 'entertainment',
      type: 'EXPENSE',
      amount: 180_000,
      description: 'Vé xem phim',
      dayOffset: 5,
    },
    {
      accountId: bank.id,
      slug: 'health',
      type: 'EXPENSE',
      amount: 320_000,
      description: 'Mua thuốc cảm cúm',
      dayOffset: 6,
    },
    {
      accountId: cash.id,
      slug: 'education',
      type: 'EXPENSE',
      amount: 500_000,
      description: 'Sách lập trình',
      dayOffset: 7,
    },
    {
      accountId: bank.id,
      slug: 'housing',
      type: 'EXPENSE',
      amount: 6_000_000,
      description: 'Tiền thuê nhà tháng trước',
      dayOffset: -20,
    },
    {
      accountId: cash.id,
      slug: 'food',
      type: 'EXPENSE',
      amount: 150_000,
      description: 'Cà phê và bánh mì',
      dayOffset: -22,
    },
    {
      accountId: bank.id,
      slug: 'salary',
      type: 'INCOME',
      amount: 25_000_000,
      description: 'Lương tháng trước',
      dayOffset: -27,
    },
  ];

  for (const [index, sample] of samples.entries()) {
    const base = index >= 9 ? previousMonthStart : monthStart;
    const occurredAt = new Date(base);
    occurredAt.setUTCDate(base.getUTCDate() + Math.abs(sample.dayOffset));
    occurredAt.setUTCHours(4, 30, 0, 0);
    await prisma.transaction.create({
      data: {
        userId: user.id,
        accountId: sample.accountId,
        categoryId: sample.slug ? (bySlug.get(sample.slug) ?? null) : null,
        type: sample.type,
        amount: sample.amount,
        description: sample.description,
        occurredAt,
      },
    });
  }

  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  await prisma.budget.create({
    data: {
      userId: user.id,
      categoryId: bySlug.get('food') ?? null,
      scopeKey: bySlug.get('food') ?? 'ALL',
      name: 'Ngân sách ăn uống',
      periodStart: monthStart,
      periodEnd: monthEnd,
      limitAmount: 2_000_000,
      warningThresholds: [80, 100],
    },
  });
  await prisma.savingsGoal.create({
    data: {
      userId: user.id,
      name: 'Quỹ dự phòng',
      targetAmount: 50_000_000,
      targetDate: new Date(Date.UTC(now.getUTCFullYear() + 1, 5, 30)),
      contributions: {
        create: {
          userId: user.id,
          amount: 5_000_000,
          contributedAt: new Date(),
          note: 'Khoản tiết kiệm đầu tiên',
        },
      },
    },
  });

  console.log(`Demo data created for ${email} (password from DEMO_PASSWORD).`);
}

async function main(): Promise<void> {
  await seedSystemCategories();
  if (process.env.SEED_DEMO === 'true') {
    await seedDemo();
  } else {
    console.log('SEED_DEMO is not true - skipped demo data.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
