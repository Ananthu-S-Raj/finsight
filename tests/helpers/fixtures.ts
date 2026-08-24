import type { Profile, Transaction } from "@/lib/finance";

let seq = 0;
export function nextId(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

/** Deterministic-ish ID per factory instance. */
function makeId(prefix: string): string {
  seq += 1;
  return `${prefix}-${String(seq).padStart(12, "0")}`;
}

export const USER_A_ID = "aaaaaaaa-0000-4000-8000-000000000001";
export const USER_B_ID = "bbbbbbbb-0000-4000-8000-000000000002";
export const ADMIN_ID = "cccccccc-0000-4000-8000-000000000003";

export function makeUser(overrides: Partial<Profile> = {}): Profile {
  return {
    id: USER_A_ID,
    email: "user.a@example.com",
    full_name: "User A",
    role: "user",
    monthly_budget: 50000,
    salary_balance: 80000,
    savings_balance: 20000,
    date_of_birth: null,
    ...overrides,
  };
}

export type AdminProfile = Profile & {
  role: string;
  account_status: string;
  password_changed_at: string | null;
};

export function makeAdminProfile(overrides: Partial<AdminProfile> = {}): AdminProfile {
  return {
    id: ADMIN_ID,
    email: "admin@finsight.app",
    full_name: "Admin",
    monthly_budget: 0,
    salary_balance: 0,
    savings_balance: 0,
    date_of_birth: null,
    role: "admin",
    account_status: "active",
    password_changed_at: null,
    ...overrides,
  };
}

export type TxOverrides = Partial<Transaction>;

export function makeTransaction(overrides: TxOverrides = {}): Transaction {
  return {
    id: makeId("tx"),
    user_id: USER_A_ID,
    type: "expense",
    category: "Food",
    subcategory: "Restaurants",
    amount: 500,
    overspend_amount: 0,
    note: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeSalaryTx(overrides: TxOverrides = {}): Transaction {
  return makeTransaction({
    type: "salary_add",
    category: "Salary",
    subcategory: null,
    amount: 80000,
    ...overrides,
  });
}

export function makeSavingsMoveTx(overrides: TxOverrides = {}): Transaction {
  return makeTransaction({
    type: "savings_move",
    category: "Savings",
    subcategory: null,
    amount: 10000,
    ...overrides,
  });
}

export function makeCreditCardTx(overrides: TxOverrides = {}): Transaction {
  return makeTransaction({
    type: "credit_card",
    category: "Shopping",
    subcategory: "Amazon",
    amount: 1500,
    ...overrides,
  });
}

export function makeLoanTx(overrides: TxOverrides = {}): Transaction {
  return makeTransaction({
    type: "loan_add",
    category: "Lend",
    subcategory: "Friend",
    amount: 5000,
    ...overrides,
  });
}

export function makeBudget(overrides: Record<string, unknown> = {}) {
  return {
    id: makeId("budget"),
    user_id: USER_A_ID,
    category: "Food",
    monthly_limit: 10000,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeCreditCard(overrides: Record<string, unknown> = {}) {
  return {
    id: makeId("cc"),
    user_id: USER_A_ID,
    name: "HDFC Millennia",
    outstanding: 0,
    due_date: "2026-09-05",
    ...overrides,
  };
}

export function makeLoan(overrides: Record<string, unknown> = {}) {
  return {
    id: makeId("loan"),
    user_id: USER_A_ID,
    counterparty: "Friend Ravi",
    kind: "lent",
    amount: 5000,
    settled: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makePushSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: makeId("push"),
    user_id: USER_A_ID,
    subscription: {
      endpoint: "https://fcm.googleapis.com/send/endpoint",
      keys: { p256dh: "key", auth: "auth" },
    },
    prefs: {
      dailyReminders: true,
      budgetAlerts: true,
      cardReminders: true,
      savingsNotifications: true,
    },
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeAuditLog(overrides: Record<string, unknown> = {}) {
  return {
    id: makeId("audit"),
    actor_id: ADMIN_ID,
    actor_email: "admin@finsight.app",
    action: "user.update",
    result: "success",
    details: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}
