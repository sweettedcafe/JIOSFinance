import { useState, useEffect, useCallback } from "react";

// ─── SUPABASE CONFIG ─────────────────────────────────────────────────────────
const SUPABASE_URL = "https://pwixzaejussrgxanxeyf.supabase.co";
const SUPABASE_KEY = "sb_publishable__iRNnva4zkjLSTcJuHH62A_MV2XZvCl";
const LOGO_URL    = "https://pwixzaejussrgxanxeyf.supabase.co/storage/v1/object/public/Logo/logoo.jpg";

// ─── GOOGLE SHEETS SYNC CONFIG ───────────────────────────────────────────────
// Paste your Google Apps Script Web App URL here after deploying (see Settings tab)
// The Apps Script acts as a secure relay — no OAuth needed in the browser
const GSHEETS_WEBHOOK = ""; // e.g. https://script.google.com/macros/s/AKfy.../exec

// Pushes one completed transaction row to Google Sheets via Apps Script webhook
async function syncTransactionToSheets(tx) {
  const webhookUrl = GSHEETS_WEBHOOK ||
    (await dbGet("app_settings", "select=value&key=eq.google_sheets_url"))
      ?.[0]?.value || "";
  if (!webhookUrl) return { ok: false, reason: "No webhook URL configured" };

  const row = {
    transaction_no:    tx.transaction_no,
    date:              new Date(tx.created_at).toLocaleString("en-PH"),
    cashier:           tx.cashier_name  || "",
    customer:          tx.customer_name || "Walk-in",
    items_summary:     (tx.items || []).map(i => `${i.menu_item_name}${i.size_label ? ` (${i.size_label})` : ""} x${i.quantity}`).join(", "),
    subtotal:          tx.subtotal,
    discount_name:     tx.discount_name  || "",
    discount_amount:   tx.discount_amount || 0,
    tax_amount:        tx.tax_amount      || 0,
    total_amount:      tx.total_amount,
    payment_method:    tx.payment_method || "",
    points_earned:     tx.points_earned  || 0,
    special_instruction: tx.special_instruction || "",
    remark:            tx.remark         || "",
    status:            tx.status,
    category:          tx.category       || "",
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "appendTransaction", row }),
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const json = await res.json().catch(() => ({}));
    return { ok: json.result === "success", reason: json.error || "" };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Retry syncing all unsynced transactions (called from Settings)
async function syncAllUnsynced() {
  const unsynced = await dbGet("transactions",
    "select=id,transaction_no,created_at,subtotal,discount_amount,tax_amount,total_amount,points_earned,special_instruction,remark,status,discount_id,cashier_id,customer_id,transaction_items(menu_item_name,size_label,quantity),transaction_payments(amount,payment_methods(name)),employees(full_name),customers(full_name),discounts(name)&synced_to_sheets=eq.false&status=eq.completed&order=created_at.asc&limit=200"
  );
  let synced = 0, failed = 0;
  for (const tx of (unsynced || [])) {
    const payload = {
      ...tx,
      cashier_name:   tx.employees?.full_name,
      customer_name:  tx.customers?.full_name,
      discount_name:  tx.discounts?.name,
      payment_method: tx.transaction_payments?.map(p => p.payment_methods?.name).join(" + "),
      items:          tx.transaction_items,
    };
    const result = await syncTransactionToSheets(payload);
    if (result.ok) {
      await dbPatch("transactions", `id=eq.${tx.id}`, { synced_to_sheets: true });
      synced++;
    } else {
      failed++;
    }
  }
  return { synced, failed };
}

// ─── SUPABASE CLIENT ─────────────────────────────────────────────────────────
// Generic REST helper — method, table/path, optional query params, optional body
async function sb(method, table, { query = "", body = null } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(method === "POST" || method === "PATCH"
        ? { Prefer: "return=representation" }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    console.error(`[Supabase ${method} ${table}]`, err);
    return null;
  }
  return res.json().catch(() => null);
}

// Shorthand helpers
const dbGet    = (table, query)       => sb("GET",    table, { query });
const dbPost   = (table, body)        => sb("POST",   table, { body });
const dbPatch  = (table, query, body) => sb("PATCH",  table, { query, body });
const dbDelete = (table, query)       => sb("DELETE", table, { query });

// ─── LOADING / ERROR HOOKS ───────────────────────────────────────────────────
function useSupabase(fetcher, deps = []) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

// ─── DESIGN TOKENS ──────────────────────────────────────────────────────────
const C = {
  bg:          "#0f0d0b",
  bgCard:      "#1a1714",
  bgMuted:     "#232018",
  border:      "#2e2a24",
  borderLight: "#3d3830",
  accent:      "#c8a96e",
  accentDark:  "#a8893e",
  accentLight: "#e8c98e",
  text:        "#f5f0e8",
  textMuted:   "#8a8070",
  textLight:   "#b8b0a0",
  success:     "#4a9e6a",
  danger:      "#c05050",
  warning:     "#c8943e",
  info:        "#4a8ab0",
};

const css = {
  app: {
    display: "flex", height: "100vh", background: C.bg, color: C.text,
    fontFamily: "'Georgia', serif", overflow: "hidden",
  },
  sidebar: {
    width: 220, background: C.bgCard, borderRight: `1px solid ${C.border}`,
    display: "flex", flexDirection: "column", flexShrink: 0,
  },
  logoWrap: {
    padding: "16px", borderBottom: `1px solid ${C.border}`,
    display: "flex", alignItems: "center", gap: 10,
  },
  logoImg: {
    width: 40, height: 40, borderRadius: 10, objectFit: "cover",
    background: C.bgMuted, flexShrink: 0,
  },
  logoText:  { fontSize: 14, fontWeight: "bold", color: C.accent, letterSpacing: 1 },
  logoSub:   { fontSize: 10, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" },
  nav:       { flex: 1, padding: "8px 0", overflowY: "auto" },
  navItem: (active) => ({
    display: "flex", alignItems: "center", gap: 10, padding: "9px 16px",
    cursor: "pointer", fontSize: 13, color: active ? C.accent : C.textLight,
    background: active ? `${C.accent}18` : "transparent",
    borderLeft: `2px solid ${active ? C.accent : "transparent"}`,
    transition: "all .15s",
  }),
  userBar: {
    padding: "12px 16px", borderTop: `1px solid ${C.border}`,
    display: "flex", alignItems: "center", gap: 8,
  },
  avatar: (role) => ({
    width: 30, height: 30, borderRadius: "50%", fontSize: 11,
    display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold",
    background: role === "developer" ? C.info : role === "admin" ? C.success : C.accent,
    color: C.bg, flexShrink: 0,
  }),
  main:    { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  topbar:  {
    padding: "12px 24px", background: C.bgCard, borderBottom: `1px solid ${C.border}`,
    display: "flex", alignItems: "center", justifyContent: "space-between",
  },
  content: { flex: 1, overflowY: "auto", padding: 24 },
  card: {
    background: C.bgCard, border: `1px solid ${C.border}`,
    borderRadius: 10, padding: 20, marginBottom: 16,
  },
  btn: (variant = "default", sm) => ({
    padding:    sm ? "5px 12px" : "8px 16px",
    borderRadius: 6, cursor: "pointer",
    fontSize:   sm ? 12 : 13, fontWeight: "bold",
    border: "none", transition: "all .15s",
    background: variant === "primary" ? C.accent
               : variant === "danger"  ? C.danger
               : variant === "success" ? C.success
               : C.bgMuted,
    color: variant === "primary" ? C.bg : C.text,
  }),
  badge: (color) => ({
    padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: "bold",
    background: color === "green"  ? `${C.success}25`
              : color === "red"    ? `${C.danger}25`
              : color === "amber"  ? `${C.warning}25`
              : `${C.info}25`,
    color: color === "green" ? C.success
         : color === "red"   ? C.danger
         : color === "amber" ? C.warning
         : C.info,
  }),
  input: {
    background: C.bgMuted, border: `1px solid ${C.border}`,
    borderRadius: 6, color: C.text, padding: "8px 12px",
    fontSize: 13, width: "100%", boxSizing: "border-box",
  },
  grid: (cols) => ({
    display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16,
  }),
  th: {
    padding: "8px 12px", fontSize: 11, color: C.textMuted, textAlign: "left",
    borderBottom: `1px solid ${C.border}`, textTransform: "uppercase", letterSpacing: 1,
  },
  td: {
    padding: "10px 12px", fontSize: 13, color: C.textLight,
    borderBottom: `1px solid ${C.border}`,
  },
};

// ─── SMALL SHARED COMPONENTS ─────────────────────────────────────────────────
function Loader() {
  return (
    <div style={{ textAlign: "center", padding: 40, color: C.textMuted, fontSize: 13 }}>
      <i className="ti ti-loader-2" style={{ fontSize: 24, display: "block", marginBottom: 8 }} />
      Loading from Supabase…
    </div>
  );
}

function DbError({ msg, onRetry }) {
  return (
    <div style={{ textAlign: "center", padding: 30, color: C.danger, fontSize: 13 }}>
      <i className="ti ti-alert-circle" style={{ fontSize: 24, display: "block", marginBottom: 8 }} />
      {msg || "Failed to load data"}
      <br />
      <button onClick={onRetry} style={{ ...css.btn("default", true), marginTop: 10 }}>Retry</button>
    </div>
  );
}

function StatCard({ label, value, icon, color, loading }) {
  return (
    <div style={{ ...css.card, padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 24, fontWeight: "bold", color: color || C.accent }}>
            {loading ? "—" : value}
          </div>
        </div>
        <i className={`ti ${icon}`} style={{ fontSize: 22, color: color || C.accent, opacity: 0.7 }} />
      </div>
    </div>
  );
}

function ProgressBar({ item }) {
  const pct   = item.total_capacity > 0 ? Math.round((item.current_stock / item.total_capacity) * 100) : 0;
  const color = pct > 50 ? C.success : pct > 25 ? C.warning : C.danger;
  const packLabel = `${item.pack_quantity} pack${item.pack_quantity !== 1 ? "s" : ""} × ${item.stock_per_pack}${item.unit}`;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: C.text }}>{item.name}</span>
        <span style={{ fontSize: 12, color: C.textMuted }}>{packLabel}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, height: 8, background: C.bgMuted, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width .5s" }} />
        </div>
        <span style={{ fontSize: 12, color, fontWeight: "bold", minWidth: 60, textAlign: "right" }}>
          {item.current_stock}{item.unit} / {item.total_capacity}{item.unit}
        </span>
      </div>
      {item.current_stock <= item.low_stock_threshold && (
        <div style={{ fontSize: 11, color: C.danger, marginTop: 3 }}>⚠ Low stock — reorder needed</div>
      )}
    </div>
  );
}

// ─── NAV CONFIG ──────────────────────────────────────────────────────────────
const NAV = [
  { key: "pos",       label: "POS",       icon: "ti-device-desktop", roles: ["admin","barista","developer"] },
  { key: "menu",      label: "Menu",      icon: "ti-menu-2",         roles: ["admin","developer"] },
  { key: "inventory", label: "Inventory", icon: "ti-package",        roles: ["admin","developer"] },
  { key: "customers", label: "Customers", icon: "ti-users",          roles: ["admin","developer"] },
  { key: "employees", label: "Employees", icon: "ti-id-badge",       roles: ["admin","developer"] },
  { key: "discounts", label: "Discounts", icon: "ti-tag",            roles: ["admin","developer"] },
  { key: "reports",   label: "Reports",   icon: "ti-chart-bar",      roles: ["admin","developer"] },
  { key: "payroll",   label: "Payroll",   icon: "ti-cash",           roles: ["admin","developer"] },
  { key: "settings",  label: "Settings",  icon: "ti-settings",       roles: ["admin","developer"] },
];

const MODULE_TITLES = {
  pos: "Point of Sale", menu: "Menu Management", inventory: "Inventory",
  customers: "Customer Management", employees: "Employee Management",
  discounts: "Discount Management", reports: "Reports & Analytics",
  payroll: "Payroll", settings: "Settings",
};

// ═══════════════════════════════════════════════════════════════════════════════
// POS MODULE — real menu_items, menu_item_sizes, discounts, customers
// ═══════════════════════════════════════════════════════════════════════════════
function POSModule({ currentUser }) {
  const [category,    setCategory]    = useState("all");
  const [cart,        setCart]        = useState([]);
  const [heldOrders,  setHeldOrders]  = useState([]);
  const [customer,    setCustomer]    = useState(null);
  const [discount,    setDiscount]    = useState(null);
  const [payMethod,   setPayMethod]   = useState("Cash");
  const [splitPay,    setSplitPay]    = useState(false);
  const [split1Amt,   setSplit1Amt]   = useState("");
  const [cashIn,      setCashIn]      = useState("");
  const [specialInstr,setSpecialInstr]= useState("");
  const [remark,      setRemark]      = useState("");
  const [selectedSize,setSelectedSize]= useState({});
  const [placing,     setPlacing]     = useState(false);
  const [orderDone,   setOrderDone]   = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [xReadOpen,   setXReadOpen]   = useState(false);
  const [custSearch,  setCustSearch]  = useState("");

  // ── Fetch menu items with their category name
  const { data: menuRaw, loading: menuLoading } = useSupabase(() =>
    dbGet("menu_items", "select=id,name,base_price,image_url,loyalty_points,is_active,sort_order,menu_categories(name)&is_active=eq.true&order=sort_order.asc")
  );

  // ── Fetch sizes per item
  const { data: sizesRaw } = useSupabase(() =>
    dbGet("menu_item_sizes", "select=id,menu_item_id,size_label,price_modifier,loyalty_points&order=size_label.asc")
  );

  // ── Fetch active discounts
  const { data: discountsRaw, loading: discLoading } = useSupabase(() =>
    dbGet("discounts", "select=id,name,type,value,scope,is_active&is_active=eq.true&order=name.asc")
  );

  // ── Fetch payment methods
  const { data: payMethods } = useSupabase(() =>
    dbGet("payment_methods", "select=id,name,fee_percent&is_active=eq.true&order=name.asc")
  );

  // ── Fetch transactions for history
  const { data: txHistory, reload: reloadHistory } = useSupabase(() =>
    dbGet(
      "transactions",
      "select=transaction_no,created_at,status,total_amount,employees(full_name),customers(full_name)&order=created_at.desc&limit=50"
    )
  );

  // ── Customer search
  const [custResults, setCustResults] = useState([]);
  async function searchCustomer(q) {
    if (q.length < 2) { setCustResults([]); return; }
    const res = await dbGet("customers",
      `select=id,customer_no,full_name,loyalty_points&or=(full_name.ilike.*${q}*,customer_no.ilike.*${q}*,barcode.eq.${q})&limit=5`
    );
    setCustResults(res || []);
  }

  // Normalise menu items
  const menu = (menuRaw || []).map(item => ({
    ...item,
    category: item.menu_categories?.name || "other",
    price:    item.base_price,
    sizes:    (sizesRaw || []).filter(s => s.menu_item_id === item.id),
    image:    item.image_url || "☕",
  })).filter(i => category === "all" || i.category === category);

  const categories = ["all", ...new Set((menuRaw || []).map(i => i.menu_categories?.name).filter(Boolean))];

  // Cart helpers
  const subtotal    = cart.reduce((s, i) => s + i.linePrice * i.qty, 0);
  const discountAmt = discount ? Math.round(subtotal * (discount.value / 100)) : 0;
  const total       = subtotal - discountAmt;
  const change      = cashIn ? Math.max(0, parseFloat(cashIn) - total) : 0;

  function addItem(item, size) {
    const sizeLabel = size?.size_label || "";
    const price     = item.base_price + (size?.price_modifier || 0);
    const key       = `${item.id}-${sizeLabel}`;
    setCart(prev => {
      const idx = prev.findIndex(c => c.key === key);
      if (idx >= 0) {
        const n = [...prev]; n[idx] = { ...n[idx], qty: n[idx].qty + 1 }; return n;
      }
      return [...prev, { ...item, key, sizeLabel, linePrice: price, qty: 1, pts: size?.loyalty_points || item.loyalty_points }];
    });
  }

  function removeItem(key)  { setCart(c => c.filter(i => i.key !== key)); }
  function updateQty(key, d) {
    setCart(c => c.map(i => i.key === key ? { ...i, qty: Math.max(0, i.qty + d) } : i).filter(i => i.qty > 0));
  }

  function holdOrder() {
    if (!cart.length) return;
    setHeldOrders(h => [...h, { id: Date.now(), items: cart, customer }]);
    setCart([]); setCustomer(null);
  }
  function resumeHeld(h) {
    setCart(h.items); setCustomer(h.customer);
    setHeldOrders(list => list.filter(o => o.id !== h.id));
  }

  async function placeOrder() {
    if (!cart.length || placing) return;
    setPlacing(true);

    const txNo = `TXN-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Math.floor(Math.random()*9000)+1000}`;
    const ptsEarned = cart.reduce((s, i) => s + (i.pts || 0) * i.qty, 0);

    const txBody = {
      transaction_no: txNo,
      cashier_id:     currentUser.id,
      customer_id:    customer?.id || null,
      status:         "completed",
      subtotal,
      discount_id:    discount?.id || null,
      discount_amount: discountAmt,
      tax_amount:     Math.round(total * 0.12),
      total_amount:   total,
      points_earned:  ptsEarned,
      special_instruction: specialInstr || null,
      remark:         remark || null,
      synced_to_sheets: false,
    };

    const txRes = await dbPost("transactions", txBody);
    if (!txRes?.[0]?.id) { setPlacing(false); alert("Transaction failed. Check Supabase connection."); return; }

    const txId = txRes[0].id;

    // Insert line items
    const lineItems = cart.map(i => ({
      transaction_id:  txId,
      menu_item_id:    i.id,
      menu_item_name:  i.name,
      size_label:      i.sizeLabel || null,
      quantity:        i.qty,
      unit_price:      i.linePrice,
      line_total:      i.linePrice * i.qty,
      points_earned:   (i.pts || 0) * i.qty,
      special_instruction: specialInstr || null,
    }));
    await dbPost("transaction_items", lineItems);

    // Insert payment
    const pmId = (payMethods || []).find(p => p.name === payMethod)?.id;
    await dbPost("transaction_payments", [{
      transaction_id:    txId,
      payment_method_id: pmId || null,
      amount:            splitPay ? parseFloat(split1Amt) || total : total,
      cash_received:     payMethod === "Cash" ? parseFloat(cashIn) || null : null,
      change_given:      payMethod === "Cash" ? change : null,
    }]);

    // Deduct inventory via recipes
    for (const item of cart) {
      const recipes = await dbGet("recipes",
        `select=inventory_id,quantity,unit&menu_item_id=eq.${item.id}${item.sizeLabel ? `&or=(size_label.eq.${item.sizeLabel},size_label.is.null)` : "&size_label=is.null"}`
      );
      for (const recipe of (recipes || [])) {
        const deduction = recipe.quantity * item.qty;
        const inv = await dbGet("inventory_items", `select=id,current_stock&id=eq.${recipe.inventory_id}`);
        if (inv?.[0]) {
          const before = inv[0].current_stock;
          const after  = Math.max(0, before - deduction);
          await dbPatch("inventory_items", `id=eq.${recipe.inventory_id}`, { current_stock: after });
          await dbPost("inventory_history", [{
            inventory_id:    recipe.inventory_id,
            action:          "deduct",
            quantity_change: -deduction,
            quantity_before: before,
            quantity_after:  after,
            reference_id:    txId,
            performed_by:    currentUser.id,
            notes:           `Sale: ${txNo}`,
          }]);
        }
      }
    }

    // Update customer points
    if (customer?.id) {
      const newPts = (customer.loyalty_points || 0) + ptsEarned;
      await dbPatch("customers", `id=eq.${customer.id}`, { loyalty_points: newPts, total_visits: (customer.total_visits || 0) + 1 });
      await dbPost("customer_points_history", [{
        customer_id: customer.id, transaction_id: txId,
        action: "earn", points: ptsEarned, balance_after: newPts,
        notes: `Earned from ${txNo}`,
      }]);
    }

    // Audit log
    await dbPost("audit_logs", [{
      performed_by: currentUser.id, action: "CREATE_TRANSACTION",
      table_name: "transactions", record_id: txId,
      new_value: txBody,
    }]);

    // ── Sync to Google Sheets ──────────────────────────────────────────────
    const sheetsPayload = {
      transaction_no:    txNo,
      created_at:        new Date().toISOString(),
      cashier_name:      currentUser.full_name,
      customer_name:     customer?.full_name || null,
      subtotal,
      discount_name:     discount?.name || null,
      discount_amount:   discountAmt,
      tax_amount:        Math.round(total * 0.12),
      total_amount:      total,
      payment_method:    payMethod,
      points_earned:     ptsEarned,
      special_instruction: specialInstr || null,
      remark:            remark || null,
      status:            "completed",
      items:             lineItems,
      category:          cart[0]?.menu_categories?.name || "",
    };
    const syncResult = await syncTransactionToSheets(sheetsPayload);
    if (syncResult.ok) {
      await dbPatch("transactions", `id=eq.${txId}`, { synced_to_sheets: true });
    }
    // If sync fails, synced_to_sheets stays false — retry from Settings later

    setCart([]); setCustomer(null); setDiscount(null);
    setCashIn(""); setSplitPay(false); setSplit1Amt("");
    setSpecialInstr(""); setRemark("");
    setOrderDone(true); setTimeout(() => setOrderDone(false), 2500);
    setPlacing(false);
    reloadHistory();

    // ── Auto-print receipt (receipt printer) + labels (label printer) ─────────
    const printPayload = {
      ...sheetsPayload,
      items:        lineItems,
      cash_received: payMethod === "Cash" ? parseFloat(cashIn) || null : null,
      change_given:  payMethod === "Cash" ? change : null,
    };
    printReceipt(printPayload);
    printLabels(printPayload);
  }

  return (
    <div style={{ display: "flex", height: "100%", gap: 16 }}>
      {/* ── LEFT: Menu ── */}
      <div style={{ flex: 1.4, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Top bar */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {categories.map(c => (
            <button key={c} onClick={() => setCategory(c)} style={{ ...css.btn(category === c ? "primary" : "default", true), textTransform: "capitalize" }}>{c}</button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={() => { setHistoryOpen(true); reloadHistory(); }} style={css.btn("default", true)}>
            <i className="ti ti-history" /> History
          </button>
          <button onClick={() => setXReadOpen(true)} style={css.btn("default", true)}>
            <i className="ti ti-report-analytics" /> X-Reading
          </button>
        </div>

        {/* Customer search bar */}
        <div style={{ background: C.bgMuted, borderRadius: 8, padding: "8px 12px", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-qrcode" style={{ color: C.accent }} />
            {customer ? (
              <span style={{ fontSize: 13, flex: 1 }}>
                <strong style={{ color: C.accent }}>{customer.full_name}</strong>
                <span style={{ color: C.textMuted, marginLeft: 8 }}>{customer.loyalty_points} pts</span>
                <span style={{ color: C.textMuted, marginLeft: 8, fontSize: 11 }}>{customer.customer_no}</span>
              </span>
            ) : (
              <input
                style={{ ...css.input, flex: 1, background: "transparent", border: "none", padding: "0" }}
                placeholder="Search customer name / ID / scan barcode…"
                value={custSearch}
                onChange={e => { setCustSearch(e.target.value); searchCustomer(e.target.value); }}
              />
            )}
            {customer && (
              <button onClick={() => { setCustomer(null); setCustSearch(""); }} style={{ ...css.btn("default", true), padding: "3px 8px" }}>✕</button>
            )}
          </div>
          {custResults.length > 0 && !customer && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, zIndex: 50, marginTop: 4 }}>
              {custResults.map(c => (
                <div key={c.id} onClick={() => { setCustomer(c); setCustResults([]); setCustSearch(""); }}
                  style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: `1px solid ${C.border}` }}>
                  <strong style={{ color: C.accent }}>{c.full_name}</strong>
                  <span style={{ color: C.textMuted, marginLeft: 8, fontSize: 11 }}>{c.customer_no} · {c.loyalty_points} pts</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Menu grid */}
        {menuLoading ? <Loader /> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, overflowY: "auto", flex: 1 }}>
            {menu.map(item => (
              <div key={item.id} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px", cursor: "pointer" }}>
                <div style={{ fontSize: 26, textAlign: "center", marginBottom: 6 }}>
                  {item.image_url
                    ? <img src={item.image_url} alt={item.name} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />
                    : "☕"}
                </div>
                <div style={{ fontSize: 12, fontWeight: "bold", color: C.text, textAlign: "center", marginBottom: 4 }}>{item.name}</div>
                <div style={{ fontSize: 12, color: C.accent, fontWeight: "bold", textAlign: "center" }}>₱{item.base_price}</div>
                <div style={{ fontSize: 10, color: C.textMuted, textAlign: "center", marginBottom: 6 }}>{item.loyalty_points} pts</div>
                {item.sizes.length > 0 ? (
                  <div style={{ display: "flex", justifyContent: "center", gap: 4, flexWrap: "wrap" }}>
                    {item.sizes.map(s => (
                      <button key={s.id} onClick={() => addItem(item, s)}
                        style={{ ...css.btn("default", true), padding: "3px 8px", fontSize: 11 }}>
                        {s.size_label} {s.price_modifier > 0 ? `+₱${s.price_modifier}` : ""}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button onClick={() => addItem(item, null)} style={{ ...css.btn("primary", true), width: "100%", fontSize: 11 }}>Add</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Held orders */}
        {heldOrders.length > 0 && (
          <div style={{ background: C.bgMuted, borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 11, color: C.warning, marginBottom: 6 }}>⏸ HELD ORDERS</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {heldOrders.map(h => (
                <button key={h.id} onClick={() => resumeHeld(h)} style={css.btn("default", true)}>
                  Order #{String(h.id).slice(-4)} ({h.items.length} items)
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT: Cart ── */}
      <div style={{ width: 320, display: "flex", flexDirection: "column", background: C.bgCard, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, fontWeight: "bold", color: C.accent, fontSize: 14 }}>
          Current Order
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: "center", color: C.textMuted, padding: 30, fontSize: 13 }}>
              <i className="ti ti-shopping-cart-off" style={{ fontSize: 32, display: "block", marginBottom: 8 }} />
              No items yet
            </div>
          ) : cart.map(item => (
            <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: C.text }}>
                  {item.name}
                  {item.sizeLabel && <span style={{ color: C.textMuted, fontSize: 11 }}> ({item.sizeLabel})</span>}
                </div>
                <div style={{ fontSize: 12, color: C.accent }}>₱{(item.linePrice * item.qty).toFixed(2)}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button onClick={() => updateQty(item.key, -1)} style={{ ...css.btn("default", true), padding: "2px 7px" }}>−</button>
                <span style={{ fontSize: 13, minWidth: 18, textAlign: "center" }}>{item.qty}</span>
                <button onClick={() => updateQty(item.key,  1)} style={{ ...css.btn("default", true), padding: "2px 7px" }}>+</button>
                <button onClick={() => removeItem(item.key)}    style={{ ...css.btn("danger",  true), padding: "2px 7px" }}>×</button>
              </div>
            </div>
          ))}
        </div>

        {/* Special instruction + remark */}
        <div style={{ padding: "8px 16px", borderTop: `1px solid ${C.border}` }}>
          <input style={{ ...css.input, marginBottom: 6, fontSize: 12 }} placeholder="Special instruction (e.g. less ice, one shot)" value={specialInstr} onChange={e => setSpecialInstr(e.target.value)} />
          <input style={{ ...css.input, fontSize: 12 }} placeholder="Remark (e.g. spilled — re-made)" value={remark} onChange={e => setRemark(e.target.value)} />
        </div>

        {/* Discounts */}
        <div style={{ padding: "8px 16px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>DISCOUNT</div>
          {discLoading ? <span style={{ fontSize: 11, color: C.textMuted }}>Loading…</span> : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {(discountsRaw || []).map(d => (
                <button key={d.id} onClick={() => setDiscount(discount?.id === d.id ? null : d)}
                  style={{ ...css.btn(discount?.id === d.id ? "primary" : "default", true), fontSize: 11 }}>
                  {d.name} {d.value}{d.type === "percent" ? "%" : "₱"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Payment */}
        <div style={{ padding: "8px 16px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>PAYMENT METHOD</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {(payMethods || [{ name: "Cash" }, { name: "Card" }, { name: "GCash" }, { name: "Maya" }]).map(pm => (
              <button key={pm.name} onClick={() => setPayMethod(pm.name)}
                style={{ ...css.btn(payMethod === pm.name ? "primary" : "default", true), fontSize: 11 }}>
                {pm.name}
              </button>
            ))}
          </div>
          <label style={{ fontSize: 12, color: C.textMuted, display: "flex", alignItems: "center", gap: 6, marginBottom: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={splitPay} onChange={e => setSplitPay(e.target.checked)} />
            Split payment
          </label>
          {splitPay && (
            <input style={{ ...css.input, fontSize: 12, marginBottom: 6 }} type="number"
              placeholder={`Amount via ${payMethod}`} value={split1Amt} onChange={e => setSplit1Amt(e.target.value)} />
          )}
          {payMethod === "Cash" && !splitPay && (
            <input style={{ ...css.input, fontSize: 12 }} type="number"
              placeholder="Cash received" value={cashIn} onChange={e => setCashIn(e.target.value)} />
          )}
        </div>

        {/* Totals + actions */}
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}`, background: C.bgMuted }}>
          {[["Subtotal", `₱${subtotal.toFixed(2)}`], ...(discount ? [[discount.name, `−₱${discountAmt.toFixed(2)}`]] : [])].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: l.includes(discount?.name) ? C.danger : C.textMuted, marginBottom: 4 }}>
              <span>{l}</span><span>{v}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, fontWeight: "bold", color: C.accent, marginBottom: 6 }}>
            <span>TOTAL</span><span>₱{total.toFixed(2)}</span>
          </div>
          {payMethod === "Cash" && cashIn && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.success, marginBottom: 8 }}>
              <span>Change</span><span>₱{change.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={holdOrder} style={{ ...css.btn(), flex: 1 }}>⏸ Hold</button>
            <button onClick={placeOrder} disabled={placing || !cart.length}
              style={{ ...css.btn("primary"), flex: 2, opacity: placing ? 0.7 : 1 }}>
              {orderDone ? "✓ Placed!" : placing ? "Saving…" : "Place Order"}
            </button>
          </div>
        </div>
      </div>

      {/* ── History Modal ── */}
      {historyOpen && (
        <div style={{ position: "fixed", inset: 0, background: "#000b", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ ...css.card, width: 680, maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontWeight: "bold", color: C.accent }}>Order History</span>
              <button onClick={() => setHistoryOpen(false)} style={css.btn("default", true)}>✕</button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["TXN No.","Date","Cashier","Customer","Total","Status",""].map(h => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
              <tbody>
                {(txHistory || []).map(t => (
                  <tr key={t.transaction_no}>
                    <td style={{ ...css.td, color: C.accent }}>{t.transaction_no}</td>
                    <td style={css.td}>{new Date(t.created_at).toLocaleString("en-PH")}</td>
                    <td style={css.td}>{t.employees?.full_name || "—"}</td>
                    <td style={css.td}>{t.customers?.full_name || "Walk-in"}</td>
                    <td style={{ ...css.td, fontWeight: "bold" }}>₱{parseFloat(t.total_amount).toFixed(2)}</td>
                    <td style={css.td}><span style={css.badge(t.status === "completed" ? "green" : "red")}>{t.status}</span></td>
                    <td style={css.td}>
                      <button onClick={async () => {
                        const items = await dbGet("transaction_items", `select=menu_item_name,size_label,quantity,unit_price,special_instruction,points_earned&transaction_id=eq.${t.id || ""}`);
                        const pmts  = await dbGet("transaction_payments", `select=amount,cash_received,change_given,payment_methods(name)&transaction_id=eq.${t.id || ""}`);
                        printReceipt({
                          transaction_no:  t.transaction_no,
                          created_at:      t.created_at,
                          cashier_name:    t.employees?.full_name,
                          customer_name:   t.customers?.full_name,
                          subtotal:        t.subtotal,
                          discount_amount: t.discount_amount,
                          tax_amount:      t.tax_amount,
                          total_amount:    t.total_amount,
                          points_earned:   t.points_earned,
                          payment_method:  pmts?.[0]?.payment_methods?.name,
                          cash_received:   pmts?.[0]?.cash_received,
                          change_given:    pmts?.[0]?.change_given,
                          items:           items || [],
                        });
                      }} style={css.btn("default", true)}>&#128424; Reprint</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── X-Reading Modal ── */}
      {xReadOpen && <XReadingModal cashier={currentUser} onClose={() => setXReadOpen(false)} />}
    </div>
  );
}

function XReadingModal({ cashier, onClose }) {
  const { data: summary, loading } = useSupabase(() =>
    dbGet("transactions",
      `select=total_amount,discount_amount,tax_amount,status,transaction_payments(amount,payment_methods(name))&cashier_id=eq.${cashier.id}&created_at=gte.${new Date().toISOString().slice(0,10)}&status=eq.completed`
    )
  );

  const orders    = (summary || []).length;
  const gross     = (summary || []).reduce((s, t) => s + parseFloat(t.total_amount || 0) + parseFloat(t.discount_amount || 0), 0);
  const discounts = (summary || []).reduce((s, t) => s + parseFloat(t.discount_amount || 0), 0);
  const net       = (summary || []).reduce((s, t) => s + parseFloat(t.total_amount || 0), 0);
  const tax       = (summary || []).reduce((s, t) => s + parseFloat(t.tax_amount || 0), 0);

  const tenderMap = {};
  (summary || []).forEach(t => {
    (t.transaction_payments || []).forEach(p => {
      const name = p.payment_methods?.name || "Other";
      tenderMap[name] = (tenderMap[name] || 0) + parseFloat(p.amount || 0);
    });
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000b", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ ...css.card, width: 400 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontWeight: "bold", color: C.accent }}>X-Reading (Mid-Shift)</span>
          <button onClick={onClose} style={css.btn("default", true)}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>
          Cashier: <strong style={{ color: C.text }}>{cashier.full_name}</strong> &nbsp;|&nbsp; {new Date().toLocaleString("en-PH")}
        </div>
        {loading ? <Loader /> : <>
          {[["Order Count", orders], ["Gross Sales", `₱${gross.toFixed(2)}`], ["Discounts", `₱${discounts.toFixed(2)}`], ["Net Sales", `₱${net.toFixed(2)}`], ["Tax (12%)", `₱${tax.toFixed(2)}`]].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
              <span style={{ color: C.textMuted }}>{l}</span><span style={{ color: C.text, fontWeight: "bold" }}>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: 10, fontSize: 11, color: C.textMuted, fontWeight: "bold", marginBottom: 4 }}>TENDER BREAKDOWN</div>
          {Object.entries(tenderMap).map(([pm, amt]) => (
            <div key={pm} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13 }}>
              <span style={{ color: C.textMuted }}>{pm}</span><span style={{ color: C.accent }}>₱{amt.toFixed(2)}</span>
            </div>
          ))}
          <button onClick={() => printXReading({ cashier: cashier.full_name, orders, gross, discounts, net, tax, tender: tenderMap })}
            style={{ ...css.btn("primary"), width: "100%", marginTop: 14 }}>&#128424; Print X-Reading</button>
        </>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVENTORY MODULE — real inventory_items + inventory_history
// ═══════════════════════════════════════════════════════════════════════════════
function InventoryModule({ currentUser }) {
  const [tab,       setTab]       = useState("overview");
  const [showAdd,   setShowAdd]   = useState(false);
  const [addTarget, setAddTarget] = useState(null);
  const [addQty,    setAddQty]    = useState("");
  const [saving,    setSaving]    = useState(false);

  const { data: items, loading, error, reload } = useSupabase(() =>
    dbGet("inventory_items",
      "select=id,name,unit,stock_per_pack,pack_quantity,current_stock,total_capacity,low_stock_threshold,is_active,inventory_categories(name)&is_active=eq.true&order=name.asc"
    )
  );

  const { data: history, loading: histLoading, reload: reloadHistory } = useSupabase(() =>
    dbGet("inventory_history",
      "select=created_at,action,quantity_change,quantity_before,quantity_after,notes,inventory_items(name),employees(full_name)&order=created_at.desc&limit=80"
    )
  );

  const lowStock = (items || []).filter(i => i.current_stock <= i.low_stock_threshold);

  async function addStock() {
    if (!addTarget || !addQty || saving) return;
    setSaving(true);
    const qty    = parseFloat(addQty);
    const before = addTarget.current_stock;
    const after  = Math.min(addTarget.total_capacity, before + qty);
    await dbPatch("inventory_items", `id=eq.${addTarget.id}`, { current_stock: after });
    await dbPost("inventory_history", [{
      inventory_id: addTarget.id, action: "restock",
      quantity_change: qty, quantity_before: before, quantity_after: after,
      performed_by: currentUser.id, notes: `Manual restock by ${currentUser.full_name}`,
    }]);
    setShowAdd(false); setAddTarget(null); setAddQty("");
    setSaving(false); reload(); reloadHistory();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {["overview", "low-stock", "history"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ ...css.btn(tab === t ? "primary" : "default", true), textTransform: "capitalize" }}>
              {t.replace("-", " ")}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={css.btn("default", true)}><i className="ti ti-upload" /> Import CSV</button>
          <button style={css.btn("primary", true)}><i className="ti ti-plus" /> Add Item</button>
        </div>
      </div>

      {lowStock.length > 0 && (
        <div style={{ background: `${C.danger}15`, border: `1px solid ${C.danger}40`, borderRadius: 8, padding: "10px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: C.danger, fontWeight: "bold", marginBottom: 6 }}>⚠ NEEDS RESTOCKING ({lowStock.length} items)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {lowStock.map(i => <span key={i.id} style={css.badge("red")}>{i.name}</span>)}
          </div>
        </div>
      )}

      {tab === "overview" && (
        <div style={css.card}>
          {loading ? <Loader /> : error ? <DbError msg={error} onRetry={reload} /> : (
            (items || []).map(item => (
              <div key={item.id} style={{ marginBottom: 20 }}>
                <ProgressBar item={item} />
                <div style={{ display: "flex", gap: 6, marginTop: -8 }}>
                  <button onClick={() => { setAddTarget(item); setShowAdd(true); }} style={css.btn("success", true)}>+ Add Stock</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "low-stock" && (
        <div style={css.card}>
          {loading ? <Loader /> : lowStock.length === 0 ? (
            <div style={{ textAlign: "center", color: C.success, padding: 30 }}>✓ All items sufficiently stocked</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Item","Category","Current","Threshold","Action"].map(h => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
              <tbody>
                {lowStock.map(i => (
                  <tr key={i.id}>
                    <td style={css.td}><span style={{ color: C.danger }}>⚠</span> {i.name}</td>
                    <td style={css.td}><span style={css.badge("amber")}>{i.inventory_categories?.name || "—"}</span></td>
                    <td style={{ ...css.td, color: C.danger }}>{i.current_stock}{i.unit}</td>
                    <td style={css.td}>{i.low_stock_threshold}{i.unit}</td>
                    <td style={css.td}><button onClick={() => { setAddTarget(i); setShowAdd(true); }} style={css.btn("primary", true)}>Restock</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "history" && (
        <div style={css.card}>
          {histLoading ? <Loader /> : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Date","Item","Action","Change","Before","After","By"].map(h => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
              <tbody>
                {(history || []).map((r, i) => (
                  <tr key={i}>
                    <td style={css.td}>{new Date(r.created_at).toLocaleString("en-PH")}</td>
                    <td style={css.td}>{r.inventory_items?.name || "—"}</td>
                    <td style={css.td}><span style={css.badge(r.action === "restock" ? "green" : "amber")}>{r.action}</span></td>
                    <td style={{ ...css.td, color: r.quantity_change >= 0 ? C.success : C.warning }}>
                      {r.quantity_change >= 0 ? "+" : ""}{r.quantity_change}
                    </td>
                    <td style={css.td}>{r.quantity_before}</td>
                    <td style={css.td}>{r.quantity_after}</td>
                    <td style={css.td}>{r.employees?.full_name || "System"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showAdd && addTarget && (
        <div style={{ position: "fixed", inset: 0, background: "#000b", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ ...css.card, width: 360 }}>
            <div style={{ fontWeight: "bold", color: C.accent, marginBottom: 10 }}>Add Stock: {addTarget.name}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
              Current: {addTarget.current_stock}{addTarget.unit} / {addTarget.total_capacity}{addTarget.unit}
            </div>
            <input style={{ ...css.input, marginBottom: 12 }} type="number"
              placeholder={`Quantity to add (${addTarget.unit})`} value={addQty} onChange={e => setAddQty(e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowAdd(false)} style={{ ...css.btn(), flex: 1 }}>Cancel</button>
              <button onClick={addStock} disabled={saving} style={{ ...css.btn("success"), flex: 1 }}>
                {saving ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MENU MODULE — real menu_items, menu_categories, menu_item_sizes
// ═══════════════════════════════════════════════════════════════════════════════
function MenuModule({ currentUser }) {
  const [category, setCategory] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [saving,   setSaving]   = useState(false);

  const { data: items,      loading, error, reload } = useSupabase(() =>
    dbGet("menu_items",
      "select=id,name,base_price,image_url,loyalty_points,is_active,sort_order,menu_categories(id,name),menu_item_sizes(id,size_label,price_modifier)&order=sort_order.asc"
    )
  );
  const { data: categories } = useSupabase(() =>
    dbGet("menu_categories", "select=id,name&order=sort_order.asc")
  );
  const { data: invItems } = useSupabase(() =>
    dbGet("inventory_items", "select=id,name,unit&is_active=eq.true&order=name.asc")
  );

  const filtered = (items || []).filter(i => category === "all" || i.menu_categories?.name === category);

  async function toggleActive(item) {
    await dbPatch("menu_items", `id=eq.${item.id}`, { is_active: !item.is_active });
    await dbPost("audit_logs", [{ performed_by: currentUser.id, action: item.is_active ? "DEACTIVATE_MENU_ITEM" : "ACTIVATE_MENU_ITEM", table_name: "menu_items", record_id: item.id }]);
    reload();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {["all", ...(categories || []).map(c => c.name)].map(c => (
            <button key={c} onClick={() => setCategory(c)} style={{ ...css.btn(category === c ? "primary" : "default", true), textTransform: "capitalize" }}>{c}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={css.btn("default", true)}><i className="ti ti-upload" /> Import CSV</button>
          <button onClick={() => { setEditItem(null); setShowForm(true); }} style={css.btn("primary", true)}><i className="ti ti-plus" /> Add Item</button>
        </div>
      </div>

      {loading ? <Loader /> : error ? <DbError msg={error} onRetry={reload} /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {filtered.map(item => (
            <div key={item.id} style={{ ...css.card, opacity: item.is_active ? 1 : 0.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontSize: 24 }}>
                  {item.image_url
                    ? <img src={item.image_url} alt={item.name} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
                    : "☕"}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => { setEditItem(item); setShowForm(true); }} style={css.btn("default", true)}>✎</button>
                  <button onClick={() => toggleActive(item)} style={css.btn(item.is_active ? "default" : "success", true)}>
                    {item.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: "bold", color: C.text, marginTop: 8 }}>{item.name}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <span style={css.badge(item.menu_categories?.name === "coffee" ? "amber" : "green")}>{item.menu_categories?.name || "—"}</span>
                {!item.is_active && <span style={css.badge("red")}>inactive</span>}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
                <span style={{ color: C.accent, fontWeight: "bold" }}>₱{item.base_price}</span>
                <span style={{ color: C.textMuted }}>{item.loyalty_points} pts</span>
              </div>
              {(item.menu_item_sizes || []).length > 0 && (
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                  Sizes: {item.menu_item_sizes.map(s => s.size_label).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <MenuItemForm
          item={editItem} categories={categories || []} invItems={invItems || []}
          currentUser={currentUser}
          onClose={() => { setShowForm(false); reload(); }}
        />
      )}
    </div>
  );
}

function MenuItemForm({ item, categories, invItems, currentUser, onClose }) {
  const [name,     setName]     = useState(item?.name || "");
  const [price,    setPrice]    = useState(item?.base_price || "");
  const [pts,      setPts]      = useState(item?.loyalty_points || 0);
  const [catId,    setCatId]    = useState(item?.menu_categories?.id || categories[0]?.id || "");
  const [saving,   setSaving]   = useState(false);

  async function save() {
    if (!name || !price) return;
    setSaving(true);
    const payload = { name, base_price: parseFloat(price), loyalty_points: parseInt(pts), category_id: catId || null };
    if (item?.id) {
      await dbPatch("menu_items", `id=eq.${item.id}`, payload);
      await dbPost("audit_logs", [{ performed_by: currentUser.id, action: "UPDATE_MENU_ITEM", table_name: "menu_items", record_id: item.id, new_value: payload }]);
    } else {
      await dbPost("menu_items", { ...payload, is_active: true, sort_order: 99 });
    }
    setSaving(false); onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000b", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ ...css.card, width: 500, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontWeight: "bold", color: C.accent }}>{item ? "Edit Item" : "Add Menu Item"}</span>
          <button onClick={onClose} style={css.btn("default", true)}>✕</button>
        </div>
        {[["Item Name", name, setName, "text"], ["Base Price (₱)", price, setPrice, "number"], ["Loyalty Points", pts, setPts, "number"]].map(([label, val, setter, type]) => (
          <div key={label} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>{label}</div>
            <input style={css.input} type={type} value={val} onChange={e => setter(e.target.value)} />
          </div>
        ))}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Category</div>
          <select style={css.input} value={catId} onChange={e => setCatId(e.target.value)}>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>Ingredients (from Inventory)</div>
          {invItems.slice(0, 6).map(inv => (
            <label key={inv.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" />
              <span style={{ flex: 1, color: C.text }}>{inv.name}</span>
              <input style={{ ...css.input, width: 70 }} placeholder="Qty" type="number" />
              <select style={{ ...css.input, width: 80 }}>
                {["g","ml","pcs","kg","L","tsp","tbsp"].map(u => <option key={u}>{u}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ ...css.btn(), flex: 1 }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...css.btn("primary"), flex: 1 }}>
            {saving ? "Saving…" : "Save Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── QR CODE GENERATOR (pure JS, no library needed) ─────────────────────────
// Generates a QR code as an SVG string using the qrcode-svg approach via canvas
// We use the free QR API at api.qrserver.com (no key needed)
function QRCode({ value, size = 160, label = "" }) {
  if (!value) return null;
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=1a1714&color=c8a96e&format=svg&qzone=1`;
  return (
    <div style={{ textAlign: "center" }}>
      <img src={url} alt={`QR: ${value}`} width={size} height={size}
        style={{ borderRadius: 10, border: `1px solid ${C.border}`, display: "block", margin: "0 auto" }} />
      {label && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>{label}</div>}
    </div>
  );
}

// Barcode renderer using the barcode API
function Barcode({ value, width = 240, height = 60 }) {
  if (!value) return null;
  const url = `https://barcodeapi.org/api/auto/${encodeURIComponent(value)}`;
  return (
    <div style={{ textAlign: "center" }}>
      <img src={url} alt={`Barcode: ${value}`} style={{ width, height, objectFit: "contain", filter: "invert(1) sepia(1) saturate(2) hue-rotate(10deg)" }} />
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, letterSpacing: 2 }}>{value}</div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// PRINT ENGINE — Receipt + Label Printer (wireless thermal, browser iframe method)
// ═══════════════════════════════════════════════════════════════════════════════

function buildReceiptHTML(tx) {
  const items = (tx.items || []).map(i =>
    `<tr>
      <td style="padding:2px 0">${i.menu_item_name}${i.size_label ? ` (${i.size_label})` : ""}${i.special_instruction ? `<br/><small style="color:#888">${i.special_instruction}</small>` : ""}</td>
      <td style="text-align:center;padding:2px 4px">${i.quantity}</td>
      <td style="text-align:right;padding:2px 0">&#8369;${(i.unit_price * i.quantity).toFixed(2)}</td>
    </tr>`
  ).join("");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Courier New',monospace;font-size:12px;width:80mm;padding:8px;color:#000}
  .center{text-align:center}.bold{font-weight:bold}
  .divider{border-top:1px dashed #000;margin:6px 0}
  table{width:100%;border-collapse:collapse}
  .total-row td{font-weight:bold;font-size:13px;padding-top:4px}
  .footer{font-size:10px;color:#555;text-align:center;margin-top:8px}
  @media print{@page{margin:0;size:80mm auto}}
</style></head><body>
  <div class="center"><div class="bold" style="font-size:18px;letter-spacing:2px">BEVI &amp; GO</div>
  <div style="font-size:10px;color:#555;margin-bottom:4px">Official Receipt</div></div>
  <div class="divider"></div>
  <div style="font-size:10px;margin-bottom:4px">
    <div>TXN: <strong>${tx.transaction_no}</strong></div>
    <div>Date: ${new Date(tx.created_at || Date.now()).toLocaleString("en-PH")}</div>
    <div>Cashier: ${tx.cashier_name || ""}</div>
    ${tx.customer_name ? `<div>Customer: ${tx.customer_name}</div>` : ""}
  </div>
  <div class="divider"></div>
  <table><thead><tr>
    <th style="text-align:left">Item</th>
    <th style="text-align:center">Qty</th>
    <th style="text-align:right">Amt</th>
  </tr></thead><tbody>${items}</tbody></table>
  <div class="divider"></div>
  <table>
    <tr><td>Subtotal</td><td style="text-align:right">&#8369;${parseFloat(tx.subtotal||0).toFixed(2)}</td></tr>
    ${tx.discount_amount > 0 ? `<tr><td>${tx.discount_name||"Discount"}</td><td style="text-align:right">-&#8369;${parseFloat(tx.discount_amount||0).toFixed(2)}</td></tr>` : ""}
    <tr><td>Tax (12%)</td><td style="text-align:right">&#8369;${parseFloat(tx.tax_amount||0).toFixed(2)}</td></tr>
    <tr class="total-row"><td>TOTAL</td><td style="text-align:right">&#8369;${parseFloat(tx.total_amount||0).toFixed(2)}</td></tr>
    <tr><td>Payment</td><td style="text-align:right">${tx.payment_method||""}</td></tr>
    ${tx.cash_received ? `<tr><td>Cash</td><td style="text-align:right">&#8369;${parseFloat(tx.cash_received).toFixed(2)}</td></tr>` : ""}
    ${tx.change_given  ? `<tr><td>Change</td><td style="text-align:right">&#8369;${parseFloat(tx.change_given).toFixed(2)}</td></tr>`  : ""}
  </table>
  ${tx.points_earned > 0 ? `<div class="divider"></div><div style="font-size:10px;text-align:center">Points earned: <strong>+${tx.points_earned} pts</strong></div>` : ""}
  ${tx.special_instruction ? `<div style="font-size:10px;margin-top:4px">Note: ${tx.special_instruction}</div>` : ""}
  <div class="divider"></div>
  <div class="footer"><div>Thank you for visiting Bevi &amp; Go!</div><div>Please come again &#9749;</div></div>
</body></html>`;
}

function buildLabelHTML(item, txNo, customerName) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;width:62mm;height:29mm;padding:4px 6px;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
  .name{font-size:13px;font-weight:bold}
  .order{font-size:11px;color:#333;margin:2px 0}
  .note{font-size:9px;color:#666;font-style:italic}
  .txn{font-size:8px;color:#999;margin-top:2px}
  @media print{@page{margin:0;size:62mm 29mm}}
</style></head><body>
  <div class="name">${customerName || "Walk-in"}</div>
  <div class="order">${item.menu_item_name}${item.size_label ? " \u00b7 " + item.size_label : ""}${item.quantity > 1 ? " x" + item.quantity : ""}</div>
  ${item.special_instruction ? `<div class="note">${item.special_instruction}</div>` : ""}
  <div class="txn">${txNo}</div>
</body></html>`;
}

function printInIframe(html, delay) {
  setTimeout(() => {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;";
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
    iframe.contentWindow.focus();
    setTimeout(() => {
      iframe.contentWindow.print();
      setTimeout(() => { try { document.body.removeChild(iframe); } catch(e) {} }, 3000);
    }, 400);
  }, delay || 0);
}

function printReceipt(tx)  { printInIframe(buildReceiptHTML(tx), 0); }

function printLabels(tx) {
  (tx.items || []).forEach((item, idx) => {
    for (let i = 0; i < (item.quantity || 1); i++) {
      printInIframe(buildLabelHTML(item, tx.transaction_no, tx.customer_name), (idx + i) * 800);
    }
  });
}

function printXReading(data) {
  const tenderRows = Object.entries(data.tender || {}).map(([pm, amt]) =>
    `<tr><td>${pm}</td><td style="text-align:right">&#8369;${amt.toFixed(2)}</td></tr>`
  ).join("");
  printInIframe(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{margin:0;padding:0}body{font-family:'Courier New',monospace;font-size:12px;width:80mm;padding:8px}.center{text-align:center}.bold{font-weight:bold}.d{border-top:1px dashed #000;margin:5px 0}table{width:100%}td{padding:2px 0}@media print{@page{margin:0;size:80mm auto}}</style></head><body>
  <div class="center bold" style="font-size:15px">BEVI &amp; GO</div>
  <div class="center" style="font-size:10px">X-Reading (Mid-Shift)</div>
  <div class="d"></div>
  <div style="font-size:10px">Cashier: ${data.cashier||""}</div>
  <div style="font-size:10px">Date: ${new Date().toLocaleString("en-PH")}</div>
  <div class="d"></div>
  <table>
    <tr><td>Order Count</td><td style="text-align:right">${data.orders||0}</td></tr>
    <tr><td>Gross Sales</td><td style="text-align:right">&#8369;${(data.gross||0).toFixed(2)}</td></tr>
    <tr><td>Discounts</td><td style="text-align:right">-&#8369;${(data.discounts||0).toFixed(2)}</td></tr>
    <tr class="bold"><td>Net Sales</td><td style="text-align:right">&#8369;${(data.net||0).toFixed(2)}</td></tr>
    <tr><td>Tax (12%)</td><td style="text-align:right">&#8369;${(data.tax||0).toFixed(2)}</td></tr>
  </table>
  <div class="d"></div>
  <div class="bold" style="font-size:10px;margin-bottom:3px">TENDER</div>
  <table>${tenderRows}</table>
  <div class="d"></div>
  <div class="center" style="font-size:10px">*** Not an official receipt ***</div>
</body></html>`);
}

function printZReading(data) {
  const tenderRows  = Object.entries(data.tender || {}).map(([pm, amt]) =>
    `<tr><td>${pm}</td><td style="text-align:right">&#8369;${amt.toFixed(2)}</td></tr>`
  ).join("");
  const expenseRows = (data.expenses || []).map(e =>
    `<tr><td>${e.description}</td><td style="text-align:right">-&#8369;${parseFloat(e.amount).toFixed(2)}</td></tr>`
  ).join("");
  printInIframe(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{margin:0;padding:0}body{font-family:'Courier New',monospace;font-size:12px;width:80mm;padding:8px}.center{text-align:center}.bold{font-weight:bold}.d{border-top:1px dashed #000;margin:5px 0}table{width:100%}td{padding:2px 0}@media print{@page{margin:0;size:80mm auto}}</style></head><body>
  <div class="center bold" style="font-size:15px">BEVI &amp; GO</div>
  <div class="center" style="font-size:10px">Z-Reading &mdash; End of Day</div>
  <div class="d"></div>
  <div style="font-size:10px">Date: ${data.date||new Date().toLocaleDateString("en-PH")}</div>
  <div style="font-size:10px">Generated: ${new Date().toLocaleTimeString("en-PH")}</div>
  <div class="d"></div>
  <table>
    <tr><td>Total Orders</td><td style="text-align:right">${data.orders||0}</td></tr>
    <tr><td>Gross Sales</td><td style="text-align:right">&#8369;${(data.gross||0).toFixed(2)}</td></tr>
    <tr><td>Discounts</td><td style="text-align:right">-&#8369;${(data.discounts||0).toFixed(2)}</td></tr>
    <tr class="bold"><td>Net Sales</td><td style="text-align:right">&#8369;${(data.net||0).toFixed(2)}</td></tr>
    <tr><td>Tax (12%)</td><td style="text-align:right">&#8369;${(data.tax||0).toFixed(2)}</td></tr>
  </table>
  <div class="d"></div>
  <div class="bold" style="font-size:10px;margin-bottom:3px">TENDER</div>
  <table>${tenderRows}</table>
  ${expenseRows ? `<div class="d"></div><div class="bold" style="font-size:10px;margin-bottom:3px">EXPENSES</div><table>${expenseRows}</table><tr class="bold"><td>Net After Expenses</td><td style="text-align:right">&#8369;${(data.netAfterExp||0).toFixed(2)}</td></tr>` : ""}
  <div class="d"></div>
  <div class="center" style="font-size:10px">*** End of Day Report ***</div>
</body></html>`);
}

// ═══════════════════════════════════════════════════════════════════════════════
function CustomerModule() {
  const [tab,        setTab]        = useState("list");
  const [search,     setSearch]     = useState("");
  const [selected,   setSelected]   = useState(null);
  const [showAdd,    setShowAdd]    = useState(false);
  const [newForm,    setNewForm]    = useState({ full_name: "", email: "", phone: "", is_senior: false, is_pwd: false });
  const [saving,     setSaving]     = useState(false);
  const [printCust,  setPrintCust]  = useState(null);

  const { data: customers, loading, error, reload } = useSupabase(() =>
    dbGet("customers", "select=id,customer_no,full_name,email,phone,loyalty_points,total_visits,created_at,is_senior,is_pwd,qr_code,barcode&order=full_name.asc")
  );

  const filtered = (customers || []).filter(c =>
    !search ||
    c.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.customer_no?.includes(search) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  );
  const totalPts = (customers || []).reduce((s, c) => s + (c.loyalty_points || 0), 0);

  // Generate unique customer ID and QR/barcode tokens
  function genCustomerNo(existing) {
    const next = (existing || []).length + 1;
    return "CUS-" + String(next).padStart(4, "0");
  }
  function genToken() {
    return "BG-" + Math.random().toString(36).slice(2, 10).toUpperCase();
  }

  async function addCustomer() {
    if (!newForm.full_name) return;
    setSaving(true);
    const custNo = genCustomerNo(customers);
    const token  = genToken();
    await dbPost("customers", {
      ...newForm,
      customer_no:    custNo,
      qr_code:        token,
      barcode:        token,
      loyalty_points: 0,
      total_visits:   0,
    });
    setSaving(false);
    setShowAdd(false);
    setNewForm({ full_name: "", email: "", phone: "", is_senior: false, is_pwd: false });
    reload();
  }

  const tierOf = (pts) => pts >= 1000 ? "🥇 Gold" : pts >= 500 ? "🥈 Silver" : "🥉 Bronze";
  const tierColor = (pts) => pts >= 1000 ? "#ffd700" : pts >= 500 ? "#aaaaaa" : "#cd7f32";

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        {["list","register","rewards"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...css.btn(tab === t ? "primary" : "default", true), textTransform: "capitalize" }}>{t}</button>
        ))}
        <div style={{ flex: 1 }} />
        {tab === "list" && (
          <button onClick={() => setShowAdd(true)} style={css.btn("primary", true)}>
            <i className="ti ti-plus" /> Add Customer
          </button>
        )}
      </div>

      {/* ── LIST TAB ── */}
      {tab === "list" && (
        <>
          <div style={{ marginBottom: 12 }}>
            <input style={css.input} placeholder="Search by name, ID or email…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div style={css.card}>
            {loading ? <Loader /> : error ? <DbError msg={error} onRetry={reload} /> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["ID","Name","Email","Tier","Points","Visits","Joined","Tags",""].map(h => <th key={h} style={css.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filtered.map(c => (
                    <tr key={c.id}>
                      <td style={{ ...css.td, color: C.accent, fontSize: 12 }}>{c.customer_no}</td>
                      <td style={css.td}>{c.full_name}</td>
                      <td style={{ ...css.td, fontSize: 12 }}>{c.email || "—"}</td>
                      <td style={css.td}>
                        <span style={{ color: tierColor(c.loyalty_points), fontSize: 12 }}>{tierOf(c.loyalty_points)}</span>
                      </td>
                      <td style={{ ...css.td, color: C.success, fontWeight: "bold" }}>{c.loyalty_points}</td>
                      <td style={css.td}>{c.total_visits}</td>
                      <td style={{ ...css.td, fontSize: 11 }}>{c.created_at ? new Date(c.created_at).toLocaleDateString("en-PH") : "—"}</td>
                      <td style={css.td}>
                        {c.is_senior && <span style={{ ...css.badge("blue"), marginRight: 4, fontSize: 10 }}>Senior</span>}
                        {c.is_pwd    && <span style={{ ...css.badge("amber"), fontSize: 10 }}>PWD</span>}
                      </td>
                      <td style={css.td}>
                        <button onClick={() => setSelected(c)} style={css.btn("default", true)}>
                          <i className="ti ti-qrcode" /> View Card
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── REGISTER TAB ── */}
      {tab === "register" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Left — shop QR for walk-in registration */}
          <div style={{ ...css.card, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: "bold", color: C.accent, marginBottom: 4 }}>
              Walk-in Registration QR
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 16 }}>
              Print this and place it at the counter. Customers scan to self-register.
            </div>
            <QRCode value="https://bevigo.ph/register" size={180} label="bevigo.ph/register" />
            <button style={{ ...css.btn("default", true), marginTop: 16 }} onClick={() => window.print()}>
              <i className="ti ti-printer" /> Print QR Poster
            </button>
          </div>

          {/* Right — manual registration form */}
          <div style={css.card}>
            <div style={{ fontSize: 14, fontWeight: "bold", color: C.accent, marginBottom: 14 }}>
              Register Customer Manually
            </div>
            {[["Full Name","full_name","text"],["Email","email","email"],["Phone","phone","tel"]].map(([label, key, type]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>{label}</div>
                <input style={css.input} type={type} value={newForm[key]}
                  onChange={e => setNewForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={newForm.is_senior}
                  onChange={e => setNewForm(f => ({ ...f, is_senior: e.target.checked }))} />
                <span style={{ color: C.text }}>Senior Citizen</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={newForm.is_pwd}
                  onChange={e => setNewForm(f => ({ ...f, is_pwd: e.target.checked }))} />
                <span style={{ color: C.text }}>PWD</span>
              </label>
            </div>
            <button onClick={addCustomer} disabled={saving || !newForm.full_name}
              style={{ ...css.btn("primary"), width: "100%" }}>
              {saving ? "Registering…" : "Register & Generate Card"}
            </button>
          </div>
        </div>
      )}

      {/* ── REWARDS TAB ── */}
      {tab === "rewards" && (
        <>
          <div style={css.grid(3)}>
            <StatCard label="Total Members"         value={loading ? "—" : (customers||[]).length}                                          icon="ti-users" />
            <StatCard label="Total Points Issued"   value={loading ? "—" : totalPts.toLocaleString()}                                       icon="ti-star"  color={C.success} />
            <StatCard label="Senior / PWD Members"  value={loading ? "—" : (customers||[]).filter(c=>c.is_senior||c.is_pwd).length}         icon="ti-heart" color={C.info} />
          </div>
          <div style={css.grid(3)}>
            <StatCard label="Bronze Members"        value={loading ? "—" : (customers||[]).filter(c=>c.loyalty_points < 500).length}        icon="ti-medal"  color="#cd7f32" />
            <StatCard label="Silver Members"        value={loading ? "—" : (customers||[]).filter(c=>c.loyalty_points >= 500 && c.loyalty_points < 1000).length} icon="ti-medal-2" color="#aaaaaa" />
            <StatCard label="Gold Members"          value={loading ? "—" : (customers||[]).filter(c=>c.loyalty_points >= 1000).length}      icon="ti-crown"  color="#ffd700" />
          </div>
          <div style={css.card}>
            <div style={{ fontSize: 13, fontWeight: "bold", color: C.accent, marginBottom: 14 }}>Top Loyalty Members</div>
            {loading ? <Loader /> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Rank","Customer","Points","Tier","Visits"].map(h=><th key={h} style={css.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {[...(customers||[])].sort((a,b)=>(b.loyalty_points||0)-(a.loyalty_points||0)).slice(0,10).map((c,i)=>(
                    <tr key={c.id}>
                      <td style={{ ...css.td, fontWeight: "bold", color: C.accent }}>#{i+1}</td>
                      <td style={css.td}>{c.full_name}</td>
                      <td style={{ ...css.td, fontWeight: "bold", color: C.success }}>{c.loyalty_points}</td>
                      <td style={css.td}><span style={{ color: tierColor(c.loyalty_points) }}>{tierOf(c.loyalty_points)}</span></td>
                      <td style={css.td}>{c.total_visits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── CUSTOMER CARD MODAL (QR + Barcode) ── */}
      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "#000c", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ ...css.card, width: 420, textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontWeight: "bold", color: C.accent }}>Loyalty Card — {selected.customer_no}</span>
              <button onClick={() => setSelected(null)} style={css.btn("default", true)}>✕</button>
            </div>

            {/* Card face */}
            <div style={{ background: "linear-gradient(135deg, #1a1714 0%, #2e2520 100%)", border: `1px solid ${C.accent}40`, borderRadius: 14, padding: "20px 24px", marginBottom: 16, textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>Bevi &amp; Go</div>
                  <div style={{ fontSize: 17, fontWeight: "bold", color: C.text, marginTop: 2 }}>{selected.full_name}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>{selected.email || selected.phone || ""}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: C.textMuted }}>Points</div>
                  <div style={{ fontSize: 22, fontWeight: "bold", color: tierColor(selected.loyalty_points) }}>{selected.loyalty_points}</div>
                  <div style={{ fontSize: 11, color: tierColor(selected.loyalty_points) }}>{tierOf(selected.loyalty_points)}</div>
                </div>
              </div>

              {/* QR code */}
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <QRCode value={selected.qr_code || selected.customer_no} size={90} />
                <div style={{ flex: 1 }}>
                  <Barcode value={selected.barcode || selected.customer_no} width={180} height={50} />
                </div>
              </div>

              {/* Tags */}
              <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                {selected.is_senior && <span style={{ ...css.badge("blue"), fontSize: 10 }}>Senior Citizen</span>}
                {selected.is_pwd    && <span style={{ ...css.badge("amber"), fontSize: 10 }}>PWD</span>}
                <span style={{ ...css.badge("green"), fontSize: 10 }}>{selected.total_visits} visits</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => window.print()} style={{ ...css.btn("default"), flex: 1 }}>
                <i className="ti ti-printer" /> Print Card
              </button>
              <button onClick={() => setSelected(null)} style={{ ...css.btn("primary"), flex: 1 }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD CUSTOMER MODAL ── */}
      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "#000c", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ ...css.card, width: 400 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontWeight: "bold", color: C.accent }}>Add New Customer</span>
              <button onClick={() => setShowAdd(false)} style={css.btn("default", true)}>✕</button>
            </div>
            {[["Full Name","full_name","text"],["Email","email","email"],["Phone","phone","tel"]].map(([label, key, type]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>{label}</div>
                <input style={css.input} type={type} value={newForm[key]}
                  onChange={e => setNewForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={newForm.is_senior}
                  onChange={e => setNewForm(f => ({ ...f, is_senior: e.target.checked }))} />
                <span style={{ color: C.text }}>Senior Citizen</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={newForm.is_pwd}
                  onChange={e => setNewForm(f => ({ ...f, is_pwd: e.target.checked }))} />
                <span style={{ color: C.text }}>PWD</span>
              </label>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowAdd(false)} style={{ ...css.btn(), flex: 1 }}>Cancel</button>
              <button onClick={addCustomer} disabled={saving || !newForm.full_name}
                style={{ ...css.btn("primary"), flex: 1 }}>
                {saving ? "Saving…" : "Register"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEES MODULE — real employees table
// ═══════════════════════════════════════════════════════════════════════════════
function EmployeesModule({ currentUser }) {
  const [showForm, setShowForm] = useState(false);
  const [editEmp,  setEditEmp]  = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [form,     setForm]     = useState({ full_name: "", email: "", phone: "", role: "barista", status: "active" });

  const { data: employees, loading, error, reload } = useSupabase(() =>
    dbGet("employees", "select=id,employee_no,full_name,email,phone,role,status&order=full_name.asc")
  );

  function openEdit(emp) {
    setEditEmp(emp);
    setForm({ full_name: emp.full_name, email: emp.email, phone: emp.phone || "", role: emp.role, status: emp.status });
    setShowForm(true);
  }
  function openAdd() {
    setEditEmp(null);
    setForm({ full_name: "", email: "", phone: "", role: "barista", status: "active" });
    setShowForm(true);
  }

  async function save() {
    if (!form.full_name || !form.email) return;
    setSaving(true);
    if (editEmp?.id) {
      await dbPatch("employees", `id=eq.${editEmp.id}`, form);
      await dbPost("audit_logs", [{ performed_by: currentUser.id, action: "UPDATE_EMPLOYEE", table_name: "employees", record_id: editEmp.id, new_value: form }]);
    } else {
      const empNo = `EMP-${String((employees || []).length + 1).padStart(3, "0")}`;
      await dbPost("employees", { ...form, employee_no: empNo });
    }
    setSaving(false); setShowForm(false); reload();
  }

  async function deleteEmp(emp) {
    if (!window.confirm(`Delete ${emp.full_name}? This cannot be undone.`)) return;
    await dbPatch("employees", `id=eq.${emp.id}`, { status: "inactive" }); // soft delete
    await dbPost("audit_logs", [{ performed_by: currentUser.id, action: "DEACTIVATE_EMPLOYEE", table_name: "employees", record_id: emp.id }]);
    reload();
  }

  const roleColor = { admin: "green", barista: "amber", developer: "blue" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button onClick={openAdd} style={css.btn("primary", true)}><i className="ti ti-plus" /> Add Employee</button>
      </div>
      <div style={css.card}>
        {loading ? <Loader /> : error ? <DbError msg={error} onRetry={reload} /> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["#","Name","Role","Email","Phone","Status","Actions"].map(h => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
            <tbody>
              {(employees || []).map(emp => (
                <tr key={emp.id}>
                  <td style={{ ...css.td, color: C.textMuted, fontSize: 11 }}>{emp.employee_no}</td>
                  <td style={css.td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={css.avatar(emp.role)}>{emp.full_name.split(" ").map(n => n[0]).join("").slice(0,2)}</div>
                      {emp.full_name}
                    </div>
                  </td>
                  <td style={css.td}><span style={css.badge(roleColor[emp.role] || "blue")}>{emp.role}</span></td>
                  <td style={css.td}>{emp.email}</td>
                  <td style={css.td}>{emp.phone || "—"}</td>
                  <td style={css.td}><span style={css.badge(emp.status === "active" ? "green" : "red")}>{emp.status}</span></td>
                  <td style={css.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => openEdit(emp)} style={css.btn("default", true)}>Edit</button>
                      {emp.id !== currentUser.id && (
                        <button onClick={() => deleteEmp(emp)} style={css.btn("danger", true)}>Deactivate</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "#000b", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ ...css.card, width: 420 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontWeight: "bold", color: C.accent }}>{editEmp ? "Edit Employee" : "Add Employee"}</span>
              <button onClick={() => setShowForm(false)} style={css.btn("default", true)}>✕</button>
            </div>
            {[["Full Name","full_name","text"],["Email","email","email"],["Phone","phone","tel"]].map(([label, key, type]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>{label}</div>
                <input style={css.input} type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Role</div>
              <select style={css.input} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="barista">Barista</option>
                <option value="admin">Admin</option>
                <option value="developer">Developer</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setShowForm(false)} style={{ ...css.btn(), flex: 1 }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ ...css.btn("primary"), flex: 1 }}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCOUNTS MODULE — real discounts table
// ═══════════════════════════════════════════════════════════════════════════════
function DiscountsModule({ currentUser }) {
  const { data: discounts, loading, error, reload } = useSupabase(() =>
    dbGet("discounts", "select=id,name,type,value,scope,is_active,is_senior_pwd&order=name.asc")
  );

  async function toggle(d) {
    await dbPatch("discounts", `id=eq.${d.id}`, { is_active: !d.is_active });
    await dbPost("audit_logs", [{ performed_by: currentUser.id, action: d.is_active ? "DISABLE_DISCOUNT" : "ENABLE_DISCOUNT", table_name: "discounts", record_id: d.id }]);
    reload();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button style={css.btn("primary", true)}><i className="ti ti-plus" /> Add Discount</button>
      </div>
      <div style={css.card}>
        {loading ? <Loader /> : error ? <DbError msg={error} onRetry={reload} /> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Name","Type","Value","Scope","Gov't Mandated","Status","Actions"].map(h => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
            <tbody>
              {(discounts || []).map(d => (
                <tr key={d.id}>
                  <td style={css.td}>{d.name}</td>
                  <td style={css.td}><span style={css.badge("blue")}>{d.type}</span></td>
                  <td style={{ ...css.td, color: C.accent, fontWeight: "bold" }}>{d.type === "percent" ? `${d.value}%` : `₱${d.value}`}</td>
                  <td style={css.td}><span style={css.badge("amber")}>{d.scope}</span></td>
                  <td style={css.td}>{d.is_senior_pwd ? <span style={css.badge("green")}>Yes</span> : "—"}</td>
                  <td style={css.td}><span style={css.badge(d.is_active ? "green" : "red")}>{d.is_active ? "Active" : "Inactive"}</span></td>
                  <td style={css.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => toggle(d)} style={css.btn(d.is_active ? "default" : "success", true)}>
                        {d.is_active ? "Disable" : "Enable"}
                      </button>
                      <button style={css.btn("default", true)}>Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS MODULE — real views: v_daily_sales, v_hourly_volume, v_sales_ledger
// ═══════════════════════════════════════════════════════════════════════════════
function ReportsModule() {
  const [tab,            setTab]           = useState("daily");
  const [filterCashier,  setFilterCashier] = useState("");
  const [dateFrom,       setDateFrom]      = useState(new Date().toISOString().slice(0, 10));
  const [dateTo,         setDateTo]        = useState(new Date().toISOString().slice(0, 10));

  const { data: dailySales,   loading: dsLoading }  = useSupabase(() => dbGet("v_daily_sales",   "select=*&order=sale_date.desc&limit=30"), [tab]);
  const { data: hourlyData,   loading: hvLoading }  = useSupabase(() => dbGet("v_hourly_volume", `select=*&sale_date=eq.${dateFrom}&order=hour.asc`), [dateFrom]);
  const { data: ledger,       loading: ledLoading } = useSupabase(() => {
    let q = `select=*&order=created_at.desc&limit=100&created_at=gte.${dateFrom}T00:00:00&created_at=lte.${dateTo}T23:59:59`;
    if (filterCashier) q += `&cashier=eq.${filterCashier}`;
    return dbGet("v_sales_ledger", q);
  }, [tab, dateFrom, dateTo, filterCashier]);
  const { data: employees }                          = useSupabase(() => dbGet("employees", "select=id,full_name&role=in.(barista,admin)&order=full_name.asc"));

  const today = (dailySales || []).find(d => d.sale_date === new Date().toISOString().slice(0, 10)) || {};

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["daily","ledger","hourly","z-reading"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...css.btn(tab === t ? "primary" : "default", true), textTransform: "capitalize" }}>{t.replace("-", " ")}</button>
        ))}
        <div style={{ flex: 1 }} />
        <input style={{ ...css.input, width: 140 }} type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span style={{ color: C.textMuted, fontSize: 12 }}>to</span>
        <input style={{ ...css.input, width: 140 }} type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <select style={{ ...css.input, width: 160 }} value={filterCashier} onChange={e => setFilterCashier(e.target.value)}>
          <option value="">All Cashiers</option>
          {(employees || []).map(e => <option key={e.id} value={e.full_name}>{e.full_name}</option>)}
        </select>
        <button style={css.btn("default", true)}><i className="ti ti-download" /> Export</button>
      </div>

      <div style={css.grid(4)}>
        <StatCard label="Net Sales Today"  value={dsLoading ? "—" : `₱${parseFloat(today.net_sales || 0).toLocaleString()}`} icon="ti-cash" loading={dsLoading} />
        <StatCard label="Orders Today"     value={dsLoading ? "—" : today.order_count || 0}   icon="ti-receipt"   color={C.info}    loading={dsLoading} />
        <StatCard label="Discounts Today"  value={dsLoading ? "—" : `₱${parseFloat(today.total_discounts || 0).toFixed(2)}`} icon="ti-tag" color={C.warning} loading={dsLoading} />
        <StatCard label="Refunds Today"    value={dsLoading ? "—" : today.refund_count || 0}  icon="ti-arrow-back-up" color={C.danger} loading={dsLoading} />
      </div>

      {tab === "daily" && (
        <div style={css.card}>
          <div style={{ fontSize: 13, fontWeight: "bold", color: C.accent, marginBottom: 12 }}>Daily Sales Summary</div>
          {dsLoading ? <Loader /> : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Date","Orders","Gross","Discounts","Tax","Net Sales","Refunds"].map(h => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
              <tbody>
                {(dailySales || []).map((d, i) => (
                  <tr key={i}>
                    <td style={css.td}>{d.sale_date}</td>
                    <td style={css.td}>{d.order_count}</td>
                    <td style={css.td}>₱{parseFloat(d.gross_sales || 0).toFixed(2)}</td>
                    <td style={{ ...css.td, color: C.danger }}>₱{parseFloat(d.total_discounts || 0).toFixed(2)}</td>
                    <td style={css.td}>₱{parseFloat(d.total_tax || 0).toFixed(2)}</td>
                    <td style={{ ...css.td, color: C.success, fontWeight: "bold" }}>₱{parseFloat(d.net_sales || 0).toFixed(2)}</td>
                    <td style={css.td}>{d.refund_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "hourly" && (
        <div style={css.card}>
          <div style={{ fontSize: 13, fontWeight: "bold", color: C.accent, marginBottom: 12 }}>Hourly Volume — {dateFrom}</div>
          {hvLoading ? <Loader /> : (hourlyData || []).length === 0 ? (
            <div style={{ color: C.textMuted, textAlign: "center", padding: 20 }}>No data for this date</div>
          ) : (
            (hourlyData || []).map(h => {
              const maxOrders = Math.max(...(hourlyData || []).map(x => x.order_count), 1);
              return (
                <div key={h.hour} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: C.textMuted, minWidth: 70 }}>{String(h.hour).padStart(2,"0")}:00</span>
                  <div style={{ flex: 1, height: 20, background: C.bgMuted, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${(h.order_count / maxOrders) * 100}%`, height: "100%", background: C.accent, borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 12, color: C.text, minWidth: 30, textAlign: "right" }}>{h.order_count}</span>
                  <span style={{ fontSize: 12, color: C.accent, minWidth: 80, textAlign: "right" }}>₱{parseFloat(h.total_sales || 0).toFixed(2)}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === "ledger" && (
        <div style={css.card}>
          <div style={{ fontSize: 13, fontWeight: "bold", color: C.accent, marginBottom: 12 }}>Sales Ledger</div>
          {ledLoading ? <Loader /> : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["TXN No.","Date","Cashier","Customer","Subtotal","Discount","Tax","Total","Payment","Status"].map(h => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
              <tbody>
                {(ledger || []).map((t, i) => (
                  <tr key={i}>
                    <td style={{ ...css.td, color: C.accent }}>{t.transaction_no}</td>
                    <td style={css.td}>{new Date(t.created_at).toLocaleString("en-PH")}</td>
                    <td style={css.td}>{t.cashier || "—"}</td>
                    <td style={css.td}>{t.customer || "Walk-in"}</td>
                    <td style={css.td}>₱{parseFloat(t.subtotal || 0).toFixed(2)}</td>
                    <td style={{ ...css.td, color: C.danger }}>₱{parseFloat(t.discount_amount || 0).toFixed(2)}</td>
                    <td style={css.td}>₱{parseFloat(t.tax_amount || 0).toFixed(2)}</td>
                    <td style={{ ...css.td, color: C.success, fontWeight: "bold" }}>₱{parseFloat(t.total_amount || 0).toFixed(2)}</td>
                    <td style={css.td}>{t.payment_methods || "—"}</td>
                    <td style={css.td}><span style={css.badge(t.status === "completed" ? "green" : "red")}>{t.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "z-reading" && <ZReadingPanel />}
    </div>
  );
}

function ZReadingPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: summary, loading } = useSupabase(() =>
    dbGet("transactions",
      `select=total_amount,discount_amount,tax_amount,status,transaction_payments(amount,payment_methods(name))&created_at=gte.${today}T00:00:00&created_at=lte.${today}T23:59:59&status=in.(completed,refunded)`
    )
  );
  const { data: expenses, loading: expLoading } = useSupabase(() =>
    dbGet("expenses", `select=description,amount&expense_date=eq.${today}`)
  );

  const completed = (summary || []).filter(t => t.status === "completed");
  const net     = completed.reduce((s, t) => s + parseFloat(t.total_amount || 0), 0);
  const gross   = net + completed.reduce((s, t) => s + parseFloat(t.discount_amount || 0), 0);
  const disc    = completed.reduce((s, t) => s + parseFloat(t.discount_amount || 0), 0);
  const tax     = completed.reduce((s, t) => s + parseFloat(t.tax_amount || 0), 0);
  const totalExp = (expenses || []).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const tenderMap = {};
  completed.forEach(t => (t.transaction_payments || []).forEach(p => {
    const n = p.payment_methods?.name || "Other";
    tenderMap[n] = (tenderMap[n] || 0) + parseFloat(p.amount || 0);
  }));

  return (
    <div style={{ maxWidth: 500 }}>
      <div style={css.card}>
        <div style={{ fontSize: 14, fontWeight: "bold", color: C.accent, marginBottom: 4 }}>Z-Reading — End of Day</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 14 }}>
          {today} | Generated: {new Date().toLocaleTimeString("en-PH")}
        </div>
        {loading ? <Loader /> : <>
          {[["Total Orders", completed.length], ["Gross Sales", `₱${gross.toFixed(2)}`], ["Discounts", `₱${disc.toFixed(2)}`], ["Net Sales", `₱${net.toFixed(2)}`], ["Tax (12%)", `₱${tax.toFixed(2)}`]].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
              <span style={{ color: C.textMuted }}>{l}</span><span style={{ color: C.text, fontWeight: "bold" }}>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: 10, fontSize: 11, color: C.textMuted, fontWeight: "bold", marginBottom: 4 }}>TENDER</div>
          {Object.entries(tenderMap).map(([pm, amt]) => (
            <div key={pm} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13 }}>
              <span style={{ color: C.textMuted }}>{pm}</span><span style={{ color: C.accent }}>₱{amt.toFixed(2)}</span>
            </div>
          ))}
          <div style={{ marginTop: 10, fontSize: 11, color: C.textMuted, fontWeight: "bold", marginBottom: 4 }}>EXPENSES</div>
          {expLoading ? <span style={{ fontSize: 12, color: C.textMuted }}>Loading…</span> : (expenses || []).map((e, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13 }}>
              <span style={{ color: C.textMuted }}>{e.description}</span><span style={{ color: C.danger }}>₱{parseFloat(e.amount).toFixed(2)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: `1px solid ${C.border}`, fontSize: 14, fontWeight: "bold", marginTop: 6 }}>
            <span style={{ color: C.text }}>Net After Expenses</span>
            <span style={{ color: C.success }}>₱{(net - totalExp).toFixed(2)}</span>
          </div>
          <button onClick={() => printZReading({ date: today, orders: completed.length, gross, discounts: disc, net, tax, tender: tenderMap, expenses: expenses||[], netAfterExp: net - totalExp })}
            style={{ ...css.btn("primary"), width: "100%", marginTop: 14 }}>&#128424; Print Z-Reading</button>
        </>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYROLL MODULE — real payslips + payroll_periods
// ═══════════════════════════════════════════════════════════════════════════════
function PayrollModule() {
  const { data: periods, loading: pLoading } = useSupabase(() =>
    dbGet("payroll_periods", "select=id,period_start,period_end,status&order=period_start.desc&limit=10")
  );
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const { data: payslips, loading: slipLoading } = useSupabase(() =>
    selectedPeriod
      ? dbGet("payslips", `select=id,days_worked,hours_worked,basic_pay,overtime_pay,sss_deduction,philhealth,pagibig,tax_withheld,net_pay,employees(full_name,role)&period_id=eq.${selectedPeriod}&order=employees(full_name).asc`)
      : Promise.resolve([]),
    [selectedPeriod]
  );

  useEffect(() => { if (periods?.[0]) setSelectedPeriod(periods[0].id); }, [periods]);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: C.textMuted }}>Period:</div>
        <select style={{ ...css.input, width: 220 }} value={selectedPeriod || ""} onChange={e => setSelectedPeriod(e.target.value)}>
          {(periods || []).map(p => (
            <option key={p.id} value={p.id}>{p.period_start} – {p.period_end} ({p.status})</option>
          ))}
        </select>
        {pLoading && <span style={{ fontSize: 12, color: C.textMuted }}>Loading periods…</span>}
      </div>
      <div style={css.card}>
        {slipLoading ? <Loader /> : (payslips || []).length === 0 ? (
          <div style={{ color: C.textMuted, textAlign: "center", padding: 30, fontSize: 13 }}>
            No payslips for this period. Generate payroll to create them.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Employee","Role","Days","Hours","Basic","OT","SSS","PhilHealth","Pag-IBIG","Tax","Net Pay",""].map(h => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
            <tbody>
              {(payslips || []).map(s => (
                <tr key={s.id}>
                  <td style={css.td}>{s.employees?.full_name}</td>
                  <td style={css.td}><span style={css.badge("amber")}>{s.employees?.role}</span></td>
                  <td style={css.td}>{s.days_worked}</td>
                  <td style={css.td}>{s.hours_worked}h</td>
                  <td style={css.td}>₱{parseFloat(s.basic_pay).toLocaleString()}</td>
                  <td style={css.td}>₱{parseFloat(s.overtime_pay || 0).toFixed(2)}</td>
                  <td style={{ ...css.td, color: C.danger }}>₱{parseFloat(s.sss_deduction || 0).toFixed(2)}</td>
                  <td style={{ ...css.td, color: C.danger }}>₱{parseFloat(s.philhealth || 0).toFixed(2)}</td>
                  <td style={{ ...css.td, color: C.danger }}>₱{parseFloat(s.pagibig || 0).toFixed(2)}</td>
                  <td style={{ ...css.td, color: C.danger }}>₱{parseFloat(s.tax_withheld || 0).toFixed(2)}</td>
                  <td style={{ ...css.td, color: C.success, fontWeight: "bold" }}>₱{parseFloat(s.net_pay).toLocaleString()}</td>
                  <td style={css.td}><button style={css.btn("primary", true)}>View Payslip</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS MODULE — real app_settings + payment_methods
// ═══════════════════════════════════════════════════════════════════════════════
function SettingsModule({ currentUser }) {
  const { data: settings, loading: sLoading, reload: reloadSettings } = useSupabase(() =>
    dbGet("app_settings", "select=key,value&order=key.asc")
  );
  const { data: payMethods, loading: pmLoading, reload: reloadPM } = useSupabase(() =>
    dbGet("payment_methods", "select=id,name,fee_percent,is_active&order=name.asc")
  );

  const settingsMap = Object.fromEntries((settings || []).map(s => [s.key, s.value]));
  const [localSettings, setLocalSettings] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { setLocalSettings(settingsMap); }, [settings]);

  async function saveSettings() {
    setSaving(true);
    for (const [key, value] of Object.entries(localSettings)) {
      await dbPatch("app_settings", `key=eq.${key}`, { value, updated_at: new Date().toISOString() });
    }
    await dbPost("audit_logs", [{ performed_by: currentUser.id, action: "UPDATE_APP_SETTINGS", table_name: "app_settings", new_value: localSettings }]);
    setSaving(false); reloadSettings();
  }

  async function updatePMFee(id, fee) {
    await dbPatch("payment_methods", `id=eq.${id}`, { fee_percent: parseFloat(fee) });
    reloadPM();
  }

  return (
    <div>
      <div style={css.grid(2)}>
        <div style={css.card}>
          <div style={{ fontSize: 13, fontWeight: "bold", color: C.accent, marginBottom: 14 }}>Payment Method Fees</div>
          {pmLoading ? <Loader /> : (payMethods || []).map(pm => (
            <div key={pm.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 13, color: C.text }}>{pm.name}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input style={{ ...css.input, width: 70 }} type="number" defaultValue={pm.fee_percent}
                  onBlur={e => updatePMFee(pm.id, e.target.value)} step="0.1" />
                <span style={{ fontSize: 12, color: C.textMuted }}>%</span>
              </div>
            </div>
          ))}
        </div>

        <div style={css.card}>
          <div style={{ fontSize: 13, fontWeight: "bold", color: C.accent, marginBottom: 14 }}>Shop Settings</div>
          {sLoading ? <Loader /> : [
            ["shop_name",         "Shop Name"],
            ["shop_address",      "Address"],
            ["shop_phone",        "Phone"],
            ["tax_rate",          "Tax Rate (e.g. 0.12)"],
            ["google_sheets_url", "Google Sheets URL"],
            ["receipt_printer",   "Receipt Printer"],
            ["label_printer",     "Label Printer"],
            ["loyalty_conversion","₱ per Loyalty Point"],
            ["loyalty_redemption","Points per ₱1 Discount"],
          ].map(([key, label]) => (
            <div key={key} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>{label}</div>
              <input style={css.input} value={localSettings[key] || ""} onChange={e => setLocalSettings(s => ({ ...s, [key]: e.target.value }))} />
            </div>
          ))}
          <button onClick={saveSettings} disabled={saving} style={{ ...css.btn("primary"), marginTop: 8 }}>
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </div>

      <div style={css.card}>
        <div style={{ fontSize: 13, fontWeight: "bold", color: C.accent, marginBottom: 6 }}>Database Connection</div>
        <div style={{ fontSize: 12, color: C.success }}>✓ Connected — {SUPABASE_URL}</div>
      </div>

      {/* ── Google Sheets Sync Panel ── */}
      <GoogleSheetsSyncPanel currentUser={currentUser} />
    </div>
  );
}

// ─── APPS SCRIPT CODE (module-level to avoid JSX parse issues) ─────────────────
const APPS_SCRIPT = "// Bevi & Go - Google Apps Script Webhook\n// 1. Open Google Sheets -> Extensions -> Apps Script\n// 2. Paste this entire script, replacing any existing code\n// 3. Click Deploy -> New Deployment -> Web App\n//    Execute as: Me | Who has access: Anyone\n// 4. Copy the Web App URL and paste in Settings -> Google Sheets URL\n\nconst SHEET_NAME_TRANSACTIONS = \"Transactions\";\nconst SHEET_NAME_DAILY        = \"Daily Summary\";\n\nfunction doPost(e) {\n  try {\n    const payload = JSON.parse(e.postData.contents);\n    if (payload.action === \"appendTransaction\") {\n      appendTransactionRow(payload.row);\n      updateDailySummary(payload.row);\n      return ContentService\n        .createTextOutput(JSON.stringify({ result: \"success\" }))\n        .setMimeType(ContentService.MimeType.JSON);\n    }\n    return ContentService\n      .createTextOutput(JSON.stringify({ result: \"unknown_action\" }))\n      .setMimeType(ContentService.MimeType.JSON);\n  } catch (err) {\n    return ContentService\n      .createTextOutput(JSON.stringify({ result: \"error\", error: err.message }))\n      .setMimeType(ContentService.MimeType.JSON);\n  }\n}\n\nfunction appendTransactionRow(row) {\n  const ss   = SpreadsheetApp.getActiveSpreadsheet();\n  let sheet  = ss.getSheetByName(SHEET_NAME_TRANSACTIONS);\n  if (!sheet) {\n    sheet = ss.insertSheet(SHEET_NAME_TRANSACTIONS);\n    const headers = [\n      \"Transaction No\",\"Date\",\"Cashier\",\"Customer\",\"Items\",\n      \"Subtotal\",\"Discount Name\",\"Discount Amount\",\"Tax\",\"Total\",\n      \"Payment Method\",\"Points Earned\",\"Special Instruction\",\"Remark\",\"Status\",\"Category\"\n    ];\n    sheet.appendRow(headers);\n    sheet.getRange(1,1,1,headers.length).setFontWeight(\"bold\")\n      .setBackground(\"#1a1714\").setFontColor(\"#c8a96e\");\n    sheet.setFrozenRows(1);\n  }\n  sheet.appendRow([\n    row.transaction_no, row.date, row.cashier, row.customer,\n    row.items_summary, row.subtotal, row.discount_name, row.discount_amount,\n    row.tax_amount, row.total_amount, row.payment_method, row.points_earned,\n    row.special_instruction, row.remark, row.status, row.category\n  ]);\n}\n\nfunction updateDailySummary(row) {\n  const ss   = SpreadsheetApp.getActiveSpreadsheet();\n  let sheet  = ss.getSheetByName(SHEET_NAME_DAILY);\n  if (!sheet) {\n    sheet = ss.insertSheet(SHEET_NAME_DAILY);\n    sheet.appendRow([\"Date\",\"Order Count\",\"Gross Sales\",\"Discounts\",\"Tax\",\"Net Sales\"]);\n    sheet.getRange(1,1,1,6).setFontWeight(\"bold\")\n      .setBackground(\"#1a1714\").setFontColor(\"#c8a96e\");\n    sheet.setFrozenRows(1);\n  }\n  const today    = new Date(row.date).toLocaleDateString(\"en-PH\");\n  const data     = sheet.getDataRange().getValues();\n  let rowIndex   = -1;\n  for (let i = 1; i < data.length; i++) {\n    if (new Date(data[i][0]).toLocaleDateString(\"en-PH\") === today) {\n      rowIndex = i + 1; break;\n    }\n  }\n  const total = parseFloat(row.total_amount)    || 0;\n  const disc  = parseFloat(row.discount_amount) || 0;\n  const tax   = parseFloat(row.tax_amount)      || 0;\n  const gross = total + disc;\n  if (rowIndex > 0) {\n    sheet.getRange(rowIndex,2).setValue(sheet.getRange(rowIndex,2).getValue() + 1);\n    sheet.getRange(rowIndex,3).setValue(sheet.getRange(rowIndex,3).getValue() + gross);\n    sheet.getRange(rowIndex,4).setValue(sheet.getRange(rowIndex,4).getValue() + disc);\n    sheet.getRange(rowIndex,5).setValue(sheet.getRange(rowIndex,5).getValue() + tax);\n    sheet.getRange(rowIndex,6).setValue(sheet.getRange(rowIndex,6).getValue() + total);\n  } else {\n    sheet.appendRow([today, 1, gross, disc, tax, total]);\n  }\n}";

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE SHEETS SYNC PANEL (inside Settings)
// ═══════════════════════════════════════════════════════════════════════════════
function GoogleSheetsSyncPanel({ currentUser }) {
  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [showGuide,  setShowGuide]  = useState(false);

  const { data: unsyncedCount } = useSupabase(() =>
    dbGet("transactions", "select=id&synced_to_sheets=eq.false&status=eq.completed")
  );

  async function runSync() {
    setSyncing(true); setSyncResult(null);
    const result = await syncAllUnsynced();
    setSyncResult(result);
    setSyncing(false);
  }


  return (
    <div style={css.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: "bold", color: C.accent }}>Google Sheets Sync</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
            Automatically saves every completed transaction to your Google Sheet
          </div>
        </div>
        <button onClick={() => setShowGuide(g => !g)} style={css.btn("default", true)}>
          {showGuide ? "Hide" : "Setup Guide"}
        </button>
      </div>

      {/* Status row */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", padding: "10px 14px", background: C.bgMuted, borderRadius: 8, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: C.textMuted }}>PENDING SYNC</div>
          <div style={{ fontSize: 20, fontWeight: "bold", color: (unsyncedCount || []).length > 0 ? C.warning : C.success }}>
            {(unsyncedCount || []).length}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {syncResult && (
            <div style={{ fontSize: 12, color: syncResult.failed > 0 ? C.warning : C.success }}>
              {syncResult.synced > 0 && `✓ ${syncResult.synced} transaction${syncResult.synced > 1 ? "s" : ""} synced`}
              {syncResult.failed > 0 && ` ✕ ${syncResult.failed} failed (check webhook URL)`}
              {syncResult.synced === 0 && syncResult.failed === 0 && "Nothing to sync"}
            </div>
          )}
        </div>
        <button onClick={runSync} disabled={syncing} style={{ ...css.btn("primary", true), minWidth: 120 }}>
          {syncing ? "Syncing…" : "↑ Sync Now"}
        </button>
      </div>

      {/* How it works */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: showGuide ? 14 : 0 }}>
        {[
          ["1. Every Sale",    "ti-shopping-cart",  "When a barista places an order, the transaction is saved to Supabase and flagged for sync."],
          ["2. Auto Push",     "ti-cloud-upload",   "The app immediately sends the row to your Google Sheet via the Apps Script webhook."],
          ["3. Manual Retry",  "ti-refresh",        "If the push fails (offline), click Sync Now to push all pending transactions at once."],
        ].map(([title, icon, desc]) => (
          <div key={title} style={{ background: C.bgMuted, borderRadius: 8, padding: "12px 14px" }}>
            <i className={`ti ${icon}`} style={{ fontSize: 18, color: C.accent, display: "block", marginBottom: 6 }} />
            <div style={{ fontSize: 12, fontWeight: "bold", color: C.text, marginBottom: 4 }}>{title}</div>
            <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* Setup guide */}
      {showGuide && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: "bold", color: C.text, marginBottom: 10 }}>
            Setup Instructions — Google Apps Script Webhook
          </div>
          {[
            ["Step 1", "Create your Google Sheet", "Go to sheets.google.com → create a new spreadsheet named "Bevi & Go Sales". The script will auto-create the Transactions and Daily Summary tabs."],
            ["Step 2", "Open Apps Script editor", "In your sheet: Extensions → Apps Script. Delete any existing code."],
            ["Step 3", "Paste the script below", "Copy the entire script and paste it into the editor. Click Save (Ctrl+S)."],
            ["Step 4", "Deploy as Web App", "Click Deploy → New Deployment → Type: Web App. Set Execute as: Me, Who has access: Anyone. Click Deploy and authorize."],
            ["Step 5", "Copy the Web App URL", "After deploying, copy the URL that looks like: https://script.google.com/macros/s/AKfy.../exec"],
            ["Step 6", "Paste URL in Settings", "Paste the URL into the Google Sheets URL field above and click Save Settings. That's it!"],
          ].map(([label, title, desc]) => (
            <div key={label} style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              <div style={{ ...css.badge("amber"), alignSelf: "flex-start", whiteSpace: "nowrap", marginTop: 2 }}>{label}</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: "bold", color: C.text, marginBottom: 2 }}>{title}</div>
                <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.6 }}>{desc}</div>
              </div>
            </div>
          ))}

          {/* Apps Script code block */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: "bold", color: C.text }}>Apps Script Code</div>
              <button onClick={() => navigator.clipboard?.writeText(APPS_SCRIPT)} style={css.btn("default", true)}>
                <i className="ti ti-copy" /> Copy
              </button>
            </div>
            <div style={{
              background: "#0a0908", border: `1px solid ${C.border}`, borderRadius: 8,
              padding: 16, maxHeight: 280, overflowY: "auto",
              fontFamily: "monospace", fontSize: 11, color: "#b8c0a0", lineHeight: 1.7,
              whiteSpace: "pre",
            }}>
              {APPS_SCRIPT}
            </div>
          </div>

          {/* Sheet columns preview */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: "bold", color: C.text, marginBottom: 8 }}>Columns written to "Transactions" sheet</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {["Transaction No","Date","Cashier","Customer","Items","Subtotal","Discount Name","Discount Amount","Tax","Total","Payment Method","Points Earned","Special Instruction","Remark","Status","Category"].map((col, i) => (
                <span key={col} style={{ ...css.badge("blue"), fontSize: 10 }}>
                  {String.fromCharCode(65 + i)} · {col}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [email,   setEmail]   = useState("");
  const [pass,    setPass]    = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  async function doLogin() {
    if (!email) { setError("Please enter your email."); return; }
    setLoading(true); setError("");
    const res = await dbGet("employees", `select=id,employee_no,full_name,email,role,status&email=eq.${email}&status=eq.active`);
    if (!res || res.length === 0) {
      setError("No active account found for this email."); setLoading(false); return;
    }
    onLogin(res[0]);
    setLoading(false);
  }

  return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: C.bg, fontFamily: "Georgia, serif" }}>
      <div style={{ ...css.card, width: 360, textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: 16, overflow: "hidden", margin: "0 auto 10px", background: C.bgMuted, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src={LOGO_URL} alt="Bevi & Go" style={{ width: 72, height: 72, objectFit: "cover" }}
            onError={e => { e.target.style.display = "none"; e.target.parentNode.textContent = "☕"; }} />
        </div>
        <div style={{ fontSize: 22, fontWeight: "bold", color: C.accent, letterSpacing: 2, marginBottom: 2 }}>BEVI &amp; GO</div>
        <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: 3, marginBottom: 24, textTransform: "uppercase" }}>POS System</div>

        {error && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10, padding: "6px 10px", background: `${C.danger}15`, borderRadius: 6 }}>{error}</div>}

        <div style={{ marginBottom: 12, textAlign: "left" }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Email</div>
          <input style={css.input} type="email" value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doLogin()} placeholder="your@email.com" />
        </div>
        <div style={{ marginBottom: 20, textAlign: "left" }}>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Password</div>
          <input style={css.input} type="password" value={pass} onChange={e => setPass(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doLogin()} placeholder="••••••••" />
        </div>
        <button onClick={doLogin} disabled={loading} style={{ ...css.btn("primary"), width: "100%", padding: "10px", opacity: loading ? 0.7 : 1 }}>
          {loading ? "Signing in…" : "Sign In"}
        </button>
        <div style={{ marginTop: 14, fontSize: 11, color: C.textMuted }}>
          Sign in using your employee email registered in the system.
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user,   setUser]   = useState(null);
  const [module, setModule] = useState("pos");

  if (!user) return <LoginScreen onLogin={u => { setUser(u); setModule("pos"); }} />;

  const visibleNav = NAV.filter(n => n.roles.includes(user.role));

  const moduleMap = {
    pos:       <POSModule       currentUser={user} />,
    menu:      <MenuModule      currentUser={user} />,
    inventory: <InventoryModule currentUser={user} />,
    customers: <CustomerModule />,
    employees: <EmployeesModule currentUser={user} />,
    discounts: <DiscountsModule currentUser={user} />,
    reports:   <ReportsModule />,
    payroll:   <PayrollModule />,
    settings:  <SettingsModule  currentUser={user} />,
  };

  return (
    <div style={css.app}>
      {/* Sidebar */}
      <div style={css.sidebar}>
        <div style={css.logoWrap}>
          <img src={LOGO_URL} alt="Bevi & Go" style={css.logoImg}
            onError={e => { e.target.style.display = "none"; e.target.parentNode.insertAdjacentHTML("afterbegin", '<span style="font-size:22px">☕</span>'); }} />
          <div>
            <div style={css.logoText}>BEVI &amp; GO</div>
            <div style={css.logoSub}>POS System</div>
          </div>
        </div>
        <nav style={css.nav}>
          {visibleNav.map(n => (
            <div key={n.key} style={css.navItem(module === n.key)} onClick={() => setModule(n.key)}>
              <i className={`ti ${n.icon}`} style={{ fontSize: 16 }} />
              <span>{n.label}</span>
            </div>
          ))}
        </nav>
        <div style={css.userBar}>
          <div style={css.avatar(user.role)}>{user.full_name.split(" ").map(n => n[0]).join("").slice(0, 2)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: C.text, fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.full_name}</div>
            <div style={{ fontSize: 10, color: C.textMuted, textTransform: "capitalize" }}>{user.role}</div>
          </div>
          <button onClick={() => setUser(null)} style={{ ...css.btn("default", true), padding: "4px 8px" }} title="Sign out">
            <i className="ti ti-logout" />
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={css.main}>
        <div style={css.topbar}>
          <div>
            <div style={{ fontSize: 17, fontWeight: "bold", color: C.accent }}>{MODULE_TITLES[module]}</div>
            <div style={{ fontSize: 11, color: C.textMuted }}>
              {new Date().toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={css.badge("green")}>● Live</span>
            <span style={{ fontSize: 11, color: C.textMuted }}>Supabase Connected</span>
          </div>
        </div>
        <div style={css.content}>
          {moduleMap[module]}
        </div>
      </div>
    </div>
  );
}
