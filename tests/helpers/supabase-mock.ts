/**
 * A faithful-enough mock of the supabase-js PostgREST client for handler tests.
 * Supports the chain surface the admin handlers use:
 *   select/eq/neq/in/or/gte/lt/order/range/limit,
 *   insert/update/upsert/delete (with .select() chaining),
 *   maybeSingle/single, count modes, and auth.getUser + rpc.
 */

export type AuthOverride = {
  resetPasswordForEmail?: (email: string, options?: unknown) => { data: unknown; error: unknown };
  verifyOtp?: (params: unknown) => { data: unknown; error: unknown };
  updateUser?: (attrs: unknown) => { data: unknown; error: unknown };
  signInWithPassword?: (creds: unknown) => { data: unknown; error: unknown };
};

export type MockQueryOptions = {
  user?: { id: string; email: string } | null;
  getUserError?: unknown;
  auth?: AuthOverride;
  rpc?: Record<string, (args?: unknown) => { data: unknown; error: unknown }>;
  tables?: Record<string, unknown[]>;
  writes?: WriteRecord[];
};

export type AuthCall = { method: string; args: unknown };

export type WriteRecord = {
  table: string;
  kind: "insert" | "update" | "upsert" | "delete";
  payload: unknown;
  filters: { col: string; op: string; val: unknown }[];
};

let idCounter = 0;
function genId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
}

function matchesFilter(f: { col: string; op: string; val: unknown }, row: Record<string, unknown>): boolean {
  switch (f.op) {
    case "eq":
      return row[f.col] === f.val;
    case "neq":
      return row[f.col] !== f.val;
    case "in":
      return (f.val as unknown[]).includes(row[f.col]);
    case "is":
      if (f.val === null) return row[f.col] === null || row[f.col] === undefined;
      return row[f.col] === f.val;
    case "gte": {
      const a = row[f.col];
      const b = f.val;
      if (typeof a === "number" && typeof b === "number") return a >= b;
      return String(a ?? "") >= String(b);
    }
    case "gt": {
      const a = row[f.col];
      const b = f.val;
      if (typeof a === "number" && typeof b === "number") return a > b;
      return String(a ?? "") > String(b);
    }
    case "lt": {
      const a = row[f.col];
      const b = f.val;
      if (typeof a === "number" && typeof b === "number") return a < b;
      return String(a ?? "") < String(b);
    }
    case "lte": {
      const a = row[f.col];
      const b = f.val;
      if (typeof a === "number" && typeof b === "number") return a <= b;
      return String(a ?? "") <= String(b);
    }
    case "isnot":
      return row[f.col] !== null && row[f.col] !== undefined;
    case "not": {
      const { op, val } = f.val as { op: string; val: unknown };
      return !matchesFilter({ col: f.col, op, val }, row);
    }
    case "or": {
      // supabase-js passes ilike wildcards (%) through literally; only decode
      // when the expression actually contains percent-encoding.
      let expr = f.val as string;
      if (expr.includes("%")) {
        try {
          expr = decodeURIComponent(expr);
        } catch {
          // keep the raw expression: bare % wildcards are not escapes
        }
      }
      return expr.split(",").some((part) => {
        const m = /^(\w+)\.ilike\.%(.*)%$/.exec(part.trim());
        if (!m) return false;
        return String(row[m[1]] ?? "").toLowerCase().includes(m[2].toLowerCase());
      });
    }
    default:
      return true;
  }
}

export class MockQuery {
  filters: { col: string; op: string; val: unknown }[] = [];
  orders: { col: string; asc: boolean }[] = [];
  rng: [number, number] | null = null;
  op: { kind: "insert" | "update" | "upsert" | "delete"; payload: unknown } | null = null;
  selectCols: string[] | null = null;
  countMode: string | null = null;
  head = false;
  selected = false;

  constructor(
    private table: string,
    private opts: MockQueryOptions
  ) {}

  eq(col: string, val: unknown) {
    this.filters.push({ col, op: "eq", val });
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push({ col, op: "is", val });
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push({ col, op: "neq", val });
    return this;
  }
  in(col: string, val: unknown[]) {
    this.filters.push({ col, op: "in", val });
    return this;
  }
  gte(col: string, val: unknown) {
    this.filters.push({ col, op: "gte", val });
    return this;
  }
  gt(col: string, val: unknown) {
    this.filters.push({ col, op: "gt", val });
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push({ col, op: "lt", val });
    return this;
  }
  lte(col: string, val: unknown) {
    this.filters.push({ col, op: "lte", val });
    return this;
  }
  or(expr: string) {
    this.filters.push({ col: "", op: "or", val: expr });
    return this;
  }
  not(col: string, op: string, val: unknown) {
    // Only the common `.not(col, "is", null)` case is supported.
    if (op === "is" && val === null) {
      this.filters.push({ col, op: "isnot", val: null });
    } else {
      this.filters.push({ col, op: "not", val: { op, val } });
    }
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending ?? false });
    return this;
  }
  range(from: number, to: number) {
    this.rng = [from, to];
    return this;
  }
  limit(n: number) {
    this.rng = [0, n - 1];
    return this;
  }
  insert(payload: unknown) {
    this.op = { kind: "insert", payload };
    return this;
  }
  upsert(payload: unknown) {
    this.op = { kind: "upsert", payload };
    return this;
  }
  update(payload: unknown) {
    this.op = { kind: "update", payload };
    return this;
  }
  delete() {
    this.op = { kind: "delete", payload: null };
    return this;
  }

  private allMatch(row: Record<string, unknown>): boolean {
    return this.filters.every((f) => matchesFilter(f, row));
  }

  private tableRows(): Record<string, unknown>[] {
    return (this.opts.tables?.[this.table] ?? []) as Record<string, unknown>[];
  }

  private project(rows: Record<string, unknown>[], columns: string[] | null): Record<string, unknown>[] {
    if (!columns || columns.length === 0) return rows;
    return rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const c of columns) {
        // Support PostgREST embeds of the form `table(column)`, resolved via
        // the conventional `<singular>_id` foreign key (e.g. permission_id).
        const embed = /^([a-z_]+)\(([a-z_]+)\)$/.exec(c);
        if (!embed) {
          if (c in r) out[c] = r[c];
          continue;
        }
        const [, relTable, relCol] = embed;
        const fkKey = `${relTable.replace(/s$/, "")}_id`;
        const related = ((this.opts.tables?.[relTable] ?? []) as Record<string, unknown>[]).find(
          (t) => t.id === r[fkKey]
        );
        out[relTable] = related ? { [relCol]: related[relCol] } : null;
      }
      return out;
    });
  }

  execute(): { data: Record<string, unknown>[]; count: number; error: unknown } {
    const table = this.tableRows();
    const writes = this.opts as MockQueryOptions & { writes?: WriteRecord[] };
    let data: Record<string, unknown>[] = [];

    if (this.op) {
      if (this.op.kind === "insert") {
        const payloads = Array.isArray(this.op.payload)
          ? (this.op.payload as Record<string, unknown>[])
          : [this.op.payload as Record<string, unknown>];
        data = payloads.map((p) => {
          const row = { ...p, id: p.id ?? genId() };
          table.push(row);
          return row;
        });
      } else if (this.op.kind === "update") {
        data = table.filter((r) => this.allMatch(r));
        for (const row of data) Object.assign(row, this.op.payload as object);
      } else if (this.op.kind === "upsert") {
        const p = this.op.payload as Record<string, unknown>;
        const key = "key" in p ? "key" : "id";
        const existing = table.find((r) => r[key] === p[key]);
        if (existing) Object.assign(existing, p);
        else table.push({ ...p, id: p.id ?? genId() });
        data = existing ? [existing] : [table[table.length - 1]];
      } else if (this.op.kind === "delete") {
        const matched = table.filter((r) => this.allMatch(r));
        for (const row of matched) {
          const idx = table.indexOf(row);
          if (idx >= 0) table.splice(idx, 1);
        }
        data = [];
      }
      if (writes.writes) {
        writes.writes.push({
          table: this.table,
          kind: this.op.kind,
          payload: this.op.payload,
          filters: [...this.filters],
        });
      }
    }

    let result = table.filter((r) => this.allMatch(r));
    // Real Supabase `count:"exact"` reports the number of matching rows
    // regardless of any .range() window — compute it before slicing.
    const matchCount = result.length;
    for (const o of this.orders) {
      result = [...result].sort((a, b) => {
        const av = a[o.col];
        const bv = b[o.col];
        let cmp: number;
        if (typeof av === "number" && typeof bv === "number") {
          cmp = av - bv;
        } else {
          cmp = String(av ?? "").localeCompare(String(bv ?? ""));
        }
        return o.asc ? cmp : -cmp;
      });
    }
    if (this.rng) result = result.slice(this.rng[0], this.rng[1] + 1);

    if (!this.op && this.selectCols) {
      result = this.project(result, this.selectCols);
    }
    if (this.op && this.selectCols) {
      data = this.project(data, this.selectCols);
    }

    return { data: this.op ? data : result, count: this.op ? data.length : matchCount, error: null };
  }

  select(columns?: string, selOpts?: { count?: string; head?: boolean }) {
    this.selectCols = columns && columns !== "*" ? columns.split(",").map((c) => c.trim()) : null;
    this.countMode = selOpts?.count ?? null;
    this.head = selOpts?.head ?? false;
    this.selected = true;
    return this;
  }

  then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
    const { data, count, error } = this.execute();
    const value = this.selected
      ? { data: this.head ? null : data, count: this.countMode ? count : undefined, error }
      : { data, count, error };
    return Promise.resolve(value).then(res, rej);
  }

  maybeSingle() {
    const { data, count, error } = this.execute();
    return Promise.resolve({
      data: data[0] ?? null,
      count,
      error: data.length > 1 ? { message: "Multiple rows", code: "PGRST201" } : error,
    });
  }

  single() {
    const { data, count, error } = this.execute();
    return Promise.resolve({
      data: data[0] ?? null,
      count,
      error: data.length === 1 ? error : { message: "Wrong row count", code: "PGRST116" },
    });
  }
}

export type MockClient = {
  auth: {
    getUser: (token: string) => Promise<{ data: { user: unknown } | null; error: unknown }>;
    resetPasswordForEmail: (email: string, options?: unknown) => Promise<{ data: unknown; error: unknown }>;
    verifyOtp: (params: unknown) => Promise<{ data: unknown; error: unknown }>;
    updateUser: (attrs: unknown) => Promise<{ data: unknown; error: unknown }>;
    signInWithPassword: (creds: unknown) => Promise<{ data: unknown; error: unknown }>;
  };
  from: (table: string) => MockQuery;
  rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>;
  tables: Record<string, unknown[]>;
  writes: WriteRecord[];
  authCalls: AuthCall[];
};

export function createMockClient(opts: MockQueryOptions): MockClient {
  const tables = opts.tables ?? {};
  const writes: WriteRecord[] = [];
  const authCalls: AuthCall[] = [];
  const record = (method: string, args: unknown) => {
    authCalls.push({ method, args });
  };
  const currentUser = opts.user ?? null;
  return {
    auth: {
      getUser: (token: string) => {
        record("getUser", token);
        return opts.getUserError
          ? Promise.resolve({ data: null, error: opts.getUserError })
          : Promise.resolve({ data: { user: currentUser }, error: null });
      },
      resetPasswordForEmail: (email: string, options?: unknown) => {
        record("resetPasswordForEmail", { email, options });
        const override = opts.auth?.resetPasswordForEmail;
        return Promise.resolve(override ? override(email, options) : { data: {}, error: null });
      },
      verifyOtp: (params: unknown) => {
        record("verifyOtp", params);
        const override = opts.auth?.verifyOtp;
        return Promise.resolve(override ? override(params) : { data: { user: currentUser }, error: null });
      },
      updateUser: (attrs: unknown) => {
        record("updateUser", attrs);
        const override = opts.auth?.updateUser;
        return Promise.resolve(override ? override(attrs) : { data: { user: currentUser }, error: null });
      },
      signInWithPassword: (creds: unknown) => {
        record("signInWithPassword", creds);
        const override = opts.auth?.signInWithPassword;
        return Promise.resolve(override ? override(creds) : { data: { user: currentUser, session: {} }, error: null });
      },
    },
    from: (table: string) => new MockQuery(table, { ...opts, tables, writes }),
    rpc: (name: string, args?: unknown) => {
      const fn = opts.rpc?.[name];
      if (!fn) return Promise.resolve({ data: null, error: { message: `rpc ${name} not mocked`, code: "NOT_FOUND" } });
      return Promise.resolve(fn(args));
    },
    tables,
    writes,
    authCalls,
  };
}
