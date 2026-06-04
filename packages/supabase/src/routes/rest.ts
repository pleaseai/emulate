import type { Context, RouteContext } from "@emulators/core";
import { getSupabaseStore } from "../store.js";
import type { SupabaseRow } from "../entities.js";
import { pgError, requireApiKey } from "../helpers.js";

// RLS is NOT emulated: anon and service_role keys have identical full access to
// every table. There is no row-level filtering by auth role.

type RowData = Record<string, unknown>;

const RESERVED_QUERY_KEYS = new Set(["select", "order", "limit", "offset"]);

/** Coerce a string query value to match the type of the row's stored value. */
function coerce(rowValue: unknown, raw: string): unknown {
  if (typeof rowValue === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (typeof rowValue === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
  }
  return raw;
}

function likeToRegex(pattern: string, caseInsensitive: boolean): RegExp {
  // % => .*, _ => . ; escape regex specials.
  let out = "";
  for (const ch of pattern) {
    if (ch === "%") out += ".*";
    else if (ch === "_") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, caseInsensitive ? "i" : "");
}

/** Build a predicate for a single `<col>=<op>.<value>` filter. */
function makeFilter(col: string, expr: string): (row: RowData) => boolean {
  const dot = expr.indexOf(".");
  const op = dot >= 0 ? expr.slice(0, dot) : expr;
  const valueRaw = dot >= 0 ? expr.slice(dot + 1) : "";

  return (row) => {
    const cell = row[col];
    switch (op) {
      case "eq":
        return cell === coerce(cell, valueRaw);
      case "neq":
        return cell !== coerce(cell, valueRaw);
      case "gt":
        return (cell as number) > (coerce(cell, valueRaw) as number);
      case "gte":
        return (cell as number) >= (coerce(cell, valueRaw) as number);
      case "lt":
        return (cell as number) < (coerce(cell, valueRaw) as number);
      case "lte":
        return (cell as number) <= (coerce(cell, valueRaw) as number);
      case "like":
        return typeof cell === "string" && likeToRegex(valueRaw, false).test(cell);
      case "ilike":
        return typeof cell === "string" && likeToRegex(valueRaw, true).test(cell);
      case "is":
        if (valueRaw === "null") return cell === null || cell === undefined;
        if (valueRaw === "true") return cell === true;
        if (valueRaw === "false") return cell === false;
        return false;
      case "in": {
        const inner = valueRaw.replace(/^\(/, "").replace(/\)$/, "");
        const parts = inner.length ? inner.split(",").map((s) => s.trim().replace(/^"|"$/g, "")) : [];
        return parts.some((p) => cell === coerce(cell, p));
      }
      default:
        return false;
    }
  };
}

/** Collect all `<col>=<op>.<value>` filters from the query string into one AND predicate. */
function buildFilters(c: Context): (row: RowData) => boolean {
  const url = new URL(c.req.url);
  const preds: Array<(row: RowData) => boolean> = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (RESERVED_QUERY_KEYS.has(key)) continue;
    preds.push(makeFilter(key, value));
  }
  return (row) => preds.every((p) => p(row));
}

function applyOrder(rows: RowData[], orderParam: string | undefined): RowData[] {
  if (!orderParam) return rows;
  // Support a single column for simplicity: "col.asc" / "col.desc" with optional nulls modifier.
  const [col, ...mods] = orderParam.split(".");
  const desc = mods.includes("desc");
  return [...rows].sort((a, b) => {
    const av = a[col];
    const bv = b[col];
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av) < String(bv) ? -1 : 1;
    return desc ? -cmp : cmp;
  });
}

function applySelect(row: RowData, select: string | undefined): RowData {
  if (!select || select === "*") return row;
  const cols = select.split(",").map((s) => s.trim()).filter(Boolean);
  if (cols.includes("*")) return row;
  const out: RowData = {};
  for (const col of cols) out[col] = row[col];
  return out;
}

function tableExists(rows: { table: string }[], table: string): boolean {
  return rows.some((r) => r.table === table);
}

function notFoundTable(c: Context, table: string): Response {
  return pgError(c, 404, {
    code: "42P01",
    details: null,
    hint: null,
    message: `relation "public.${table}" does not exist`,
  });
}

function prefer(c: Context): string {
  return c.req.header("Prefer") ?? c.req.header("prefer") ?? "";
}

function wantsSingleObject(c: Context): boolean {
  const accept = c.req.header("Accept") ?? c.req.header("accept") ?? "";
  return accept.includes("application/vnd.pgrst.object+json");
}

export function restRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ss = () => getSupabaseStore(store);

  // GET /rest/v1/:table
  app.get("/rest/v1/:table", (c) => {
    const keyErr = requireApiKey(c, store);
    if (keyErr) return keyErr;

    const table = c.req.param("table");
    const all = ss().rows.findBy("table", table) as SupabaseRow[];
    if (!tableExists(ss().rows.all(), table)) return notFoundTable(c, table);

    const filterPred = buildFilters(c);
    let rows = all.map((r) => r.data).filter(filterPred);

    const totalMatched = rows.length;
    rows = applyOrder(rows, c.req.query("order"));

    const offset = c.req.query("offset");
    const limit = c.req.query("limit");
    if (offset) rows = rows.slice(Number(offset));
    if (limit) rows = rows.slice(0, Number(limit));

    const select = c.req.query("select");
    const projected = rows.map((r) => applySelect(r, select));

    const headers: Record<string, string> = {};
    if (prefer(c).includes("count=exact")) {
      const start = offset ? Number(offset) : 0;
      const end = start + projected.length - 1;
      headers["Content-Range"] = `${projected.length === 0 ? "*" : `${start}-${end}`}/${totalMatched}`;
    }

    if (wantsSingleObject(c)) {
      if (projected.length === 1) return c.json(projected[0], 200, headers);
      return pgError(c, 406, {
        code: "PGRST116",
        details: `Results contain ${projected.length} rows, application/vnd.pgrst.object+json requires 1 row`,
        hint: null,
        message: "JSON object requested, multiple (or no) rows returned",
      });
    }

    return c.json(projected, 200, headers);
  });

  // POST /rest/v1/:table
  app.post("/rest/v1/:table", async (c) => {
    const keyErr = requireApiKey(c, store);
    if (keyErr) return keyErr;

    const table = c.req.param("table");
    const raw = await c.req.json().catch(() => null);
    const inputs: RowData[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

    // Determine current max numeric id for auto-assignment.
    const existing = ss().rows.findBy("table", table) as SupabaseRow[];
    let maxId = 0;
    for (const r of existing) {
      const idv = r.data.id;
      if (typeof idv === "number" && idv > maxId) maxId = idv;
    }

    const inserted: RowData[] = [];
    for (const input of inputs) {
      const data: RowData = { ...input };
      if (data.id === undefined || data.id === null) {
        data.id = ++maxId;
      } else if (typeof data.id === "number" && data.id > maxId) {
        maxId = data.id;
      }
      ss().rows.insert({ table, data });
      inserted.push(data);
    }

    const select = c.req.query("select");
    if (prefer(c).includes("return=representation")) {
      const body = inserted.map((r) => applySelect(r, select));
      return c.json(body, 201);
    }
    return c.body(null, 201);
  });

  // PATCH /rest/v1/:table
  app.patch("/rest/v1/:table", async (c) => {
    const keyErr = requireApiKey(c, store);
    if (keyErr) return keyErr;

    const table = c.req.param("table");
    const patch = (await c.req.json().catch(() => ({}))) as RowData;
    const filterPred = buildFilters(c);

    const matching = (ss().rows.findBy("table", table) as SupabaseRow[]).filter((r) => filterPred(r.data));
    const updated: RowData[] = [];
    for (const r of matching) {
      const merged = { ...r.data, ...patch };
      ss().rows.update(r.id, { data: merged });
      updated.push(merged);
    }

    if (prefer(c).includes("return=representation")) {
      const select = c.req.query("select");
      return c.json(updated.map((r) => applySelect(r, select)), 200);
    }
    return c.body(null, 204);
  });

  // DELETE /rest/v1/:table
  app.delete("/rest/v1/:table", (c) => {
    const keyErr = requireApiKey(c, store);
    if (keyErr) return keyErr;

    const table = c.req.param("table");
    const filterPred = buildFilters(c);

    const matching = (ss().rows.findBy("table", table) as SupabaseRow[]).filter((r) => filterPred(r.data));
    const deleted: RowData[] = [];
    for (const r of matching) {
      deleted.push(r.data);
      ss().rows.delete(r.id);
    }

    if (prefer(c).includes("return=representation")) {
      const select = c.req.query("select");
      return c.json(deleted.map((r) => applySelect(r, select)), 200);
    }
    return c.body(null, 204);
  });
}
