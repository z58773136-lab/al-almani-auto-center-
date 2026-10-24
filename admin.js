import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const cfg = window.SUPABASE_CONFIG;
const db = createClient(cfg.url, cfg.publishableKey);
const $ = (id) => document.getElementById(id);
const roleLabels = { admin: "مدير النظام", manager: "مدير المركز", accountant: "الحسابات", technician: "الفني" };
const roles = ["admin", "manager", "accountant", "technician"];
const statusLabels = { open: "مفتوح", diagnosing: "قيد الفحص", waiting_parts: "بانتظار قطع غيار", in_progress: "قيد التنفيذ", ready: "جاهز للتسليم", closed: "مكتمل", cancelled: "ملغي" };
const bookingStatuses = ["تم استلام طلبك", "تم التواصل", "تم تأكيد الحجز", "تم تحويل الحجز لأمر شغل", "قيد التنفيذ", "مكتمل", "ملغي"];
const bookingStatusLabel = (status) => status === "تم استلام طلبك" ? "تم استلام الطلب" : status;
const currency = (value) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(Number(value || 0)) + " ج.م";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const normalizePhone = (value) => String(value || "").replace(/[^\d+]/g, "");
const showMessage = (message, type = "success") => { const el = $("appMessage"); el.textContent = message; el.className = "app-message show " + type; window.scrollTo({ top: 0, behavior: "smooth" }); };
const dateText = (value) => value ? new Date(value).toLocaleDateString("ar-EG") : "—";
let session = null;
let currentRole = "";
let customers = [];
let bookings = [];
let orders = [];
let transactions = [];

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginMessage").textContent = "جار تسجيل الدخول...";
  const { data, error } = await db.auth.signInWithPassword({ email: $("loginEmail").value.trim(), password: $("loginPassword").value });
  if (error) {
    const message = error.message || "تعذر تسجيل الدخول.";
    $("loginMessage").textContent = /invalid login credentials/i.test(message)
      ? "البريد أو كلمة المرور غير صحيحة. استخدم «نسيت كلمة المرور؟» لإنشاء كلمة جديدة."
      : /email not confirmed/i.test(message)
        ? "يجب تأكيد البريد من رسالة Supabase قبل تسجيل الدخول."
        : "تعذر تسجيل الدخول: " + message;
    return;
  }
  await openSession(data.session);
});

$("forgotPasswordButton").addEventListener("click", () => {
  $("resetEmail").value = $("loginEmail").value.trim();
  $("loginForm").hidden = true;
  $("loginMessage").textContent = "";
  $("resetRequestPanel").hidden = false;
});

function showPasswordResetPanel() {
  sessionStorage.setItem("adminPasswordResetPending", "1");
  $("loginScreen").hidden = false;
  $("adminApp").hidden = true;
  $("loginForm").hidden = true;
  $("resetRequestPanel").hidden = true;
  $("verifyResetCodePanel").hidden = true;
  $("changePasswordPanel").hidden = false;
  history.replaceState(null, "", window.location.pathname + window.location.search + "#reset-password");
}

async function sendResetCode() {
  const email = $("resetEmail").value.trim();
  return db.auth.resetPasswordForEmail(email);
}

$("backToLoginButton").addEventListener("click", () => {
  $("resetRequestPanel").hidden = true;
  $("loginForm").hidden = false;
  $("resetRequestMessage").textContent = "";
});

$("resetRequestForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("resetRequestMessage").textContent = "جار إرسال رمز التحقق...";
  const { error } = await sendResetCode();
  button.disabled = false;
  if (error) {
    $("resetRequestMessage").textContent = error.message || "تعذر إرسال رمز التحقق.";
    return;
  }
  $("resetRequestPanel").hidden = true;
  $("verifyResetCodePanel").hidden = false;
  $("verifyResetCodeMessage").textContent = "إذا كان البريد مسجلًا، سيصلك رمز تحقق. افحص صندوق الوارد والرسائل غير المرغوب فيها.";
  $("resetCode").focus();
});

$("verifyResetCodeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("verifyResetCodeMessage").textContent = "جار التحقق من الرمز...";
  const { data, error } = await db.auth.verifyOtp({
    email: $("resetEmail").value.trim(),
    token: $("resetCode").value.trim(),
    type: "recovery",
  });
  button.disabled = false;
  if (error || !data.session) {
    $("verifyResetCodeMessage").textContent = error?.message || "الرمز غير صحيح أو منتهي الصلاحية. أعد إرساله وحاول مرة أخرى.";
    return;
  }
  session = data.session;
  showPasswordResetPanel();
});

$("resendResetCodeButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  $("verifyResetCodeMessage").textContent = "جار إعادة إرسال الرمز...";
  const { error } = await sendResetCode();
  button.disabled = false;
  $("verifyResetCodeMessage").textContent = error
    ? (error.message || "تعذر إرسال الرمز. انتظر قليلًا ثم حاول مرة أخرى.")
    : "إذا كان البريد مسجلًا، أُعيد إرسال رمز التحقق.";
});

$("editResetEmailButton").addEventListener("click", () => {
  $("verifyResetCodePanel").hidden = true;
  $("resetRequestPanel").hidden = false;
  $("verifyResetCodeMessage").textContent = "";
});

$("changePasswordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("changePasswordMessage");
  if ($("newPassword").value !== $("confirmPassword").value) {
    message.textContent = "كلمتا المرور غير متطابقتين.";
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  message.textContent = "جار حفظ كلمة المرور...";
  const { error } = await db.auth.updateUser({ password: $("newPassword").value });
  button.disabled = false;
  if (error) {
    message.textContent = error.message || "تعذر تحديث كلمة المرور.";
    return;
  }
  sessionStorage.removeItem("adminPasswordResetPending");
  history.replaceState(null, "", window.location.pathname + window.location.search);
  await db.auth.signOut();
  $("changePasswordPanel").hidden = true;
  $("loginForm").hidden = false;
  $("loginScreen").hidden = false;
  $("loginMessage").textContent = "تم تحديث كلمة المرور. سجّل الدخول بها الآن.";
  $("newPassword").value = "";
  $("confirmPassword").value = "";
});

async function openSession(activeSession) {
  session = activeSession;
  currentRole = activeSession?.user?.app_metadata?.role || "";
  if (!roles.includes(currentRole)) {
    await db.auth.signOut();
    session = null;
    $("loginMessage").textContent = "هذا الحساب لا يملك صلاحية دخول لوحة المركز. راجع إعداد App Metadata.";
    $("loginScreen").hidden = false;
    $("adminApp").hidden = true;
    return;
  }
  $("loginMessage").textContent = "";
  $("loginScreen").hidden = true;
  $("adminApp").hidden = false;
  $("roleBadge").textContent = roleLabels[currentRole];
  $("accountsNav").hidden = !["admin", "accountant"].includes(currentRole);
  $("financeStat").hidden = !["admin", "accountant"].includes(currentRole);
  await loadAll();
}

db.auth.onAuthStateChange((event, activeSession) => {
  if (event === "PASSWORD_RECOVERY") showPasswordResetPanel();
  if (event === "SIGNED_OUT") {
    session = null;
    currentRole = "";
    $("adminApp").hidden = true;
    $("loginScreen").hidden = false;
  }
});

$("logoutButton").addEventListener("click", () => db.auth.signOut());
$("refreshButton").addEventListener("click", () => loadAll());
$("sideNav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) switchView(button.dataset.view);
});
document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.go)));
function switchView(name) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === "view-" + name));
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  const labels = { dashboard: "نظرة عامة", bookings: "حجوزات الموقع", customers: "العملاء", workorders: "أوامر الشغل", accounts: "الحسابات" };
  $("viewTitle").textContent = labels[name] || "لوحة التحكم";
  $("appMessage").className = "app-message";
  if (name === "bookings") loadBookings();
  if (name === "customers") loadCustomers();
  if (name === "workorders") { loadCustomers().then(loadOrders); }
  if (name === "accounts" && ["admin", "accountant"].includes(currentRole)) loadTransactions();
}

async function loadAll() {
  $("refreshButton").disabled = true;
  try {
    await loadCustomers();
    await Promise.all([loadBookings(), loadOrders()]);
    if (["admin", "accountant"].includes(currentRole)) await loadTransactions();
    updateStats();
  } catch (error) {
    showMessage(error.message || "تعذر تحميل البيانات.", "error");
  } finally {
    $("refreshButton").disabled = false;
  }
}

async function loadCustomers() {
  const { data, error } = await db.from("customers").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  customers = data || [];
  $("customerCount").textContent = customers.length + " عميل";
  drawCustomers($("customerSearch").value);
  const select = $("orderCustomer");
  const chosen = select.value;
  select.innerHTML = '<option value="">اختر العميل</option>' + customers.map(c => '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.full_name) + ' — ' + escapeHtml(c.phone) + '</option>').join("");
  if (customers.some(c => c.id === chosen)) select.value = chosen;
}

function drawCustomers(filter = "") {
  const term = filter.trim().toLocaleLowerCase("ar");
  const rows = customers.filter(c => !term || (c.full_name + " " + c.phone).toLocaleLowerCase("ar").includes(term));
  $("customersTable").innerHTML = rows.length ? rows.map(c => '<tr><td>' + escapeHtml(c.full_name) + '</td><td dir="ltr">' + escapeHtml(c.phone) + '</td><td>' + escapeHtml(c.email || "—") + '</td><td>' + dateText(c.created_at) + '</td><td><button class="table-action edit-customer" data-id="' + escapeHtml(c.id) + '">تعديل</button></td></tr>').join("") : '<tr><td colspan="5" class="empty">لا يوجد عملاء مطابقون.</td></tr>';
}
$("customerSearch").addEventListener("input", () => drawCustomers($("customerSearch").value));
$("customersTable").addEventListener("click", event => {
  const button = event.target.closest(".edit-customer");
  if (!button) return;
  const customer = customers.find(item => item.id === button.dataset.id);
  if (!customer) return;
  $("customerId").value = customer.id;
  $("customerName").value = customer.full_name;
  $("customerPhone").value = customer.phone;
  $("customerEmail").value = customer.email || "";
  $("customerNotes").value = customer.notes || "";
  $("customerFormTitle").textContent = "تعديل بيانات عميل";
  $("saveCustomer").textContent = "حفظ التعديل";
  $("cancelCustomerEdit").hidden = false;
  $("customerForm").scrollIntoView({ behavior: "smooth", block: "center" });
});
$("cancelCustomerEdit").addEventListener("click", resetCustomerForm);
function resetCustomerForm() {
  $("customerForm").reset(); $("customerId").value = "";
  $("customerFormTitle").textContent = "إضافة عميل"; $("saveCustomer").textContent = "حفظ العميل";
  $("cancelCustomerEdit").hidden = true;
}
$("customerForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("customerId").value;
  const record = { full_name: $("customerName").value.trim(), phone: normalizePhone($("customerPhone").value), email: $("customerEmail").value.trim() || null, notes: $("customerNotes").value.trim() || null, updated_at: new Date().toISOString() };
  const query = id ? db.from("customers").update(record).eq("id", id) : db.from("customers").insert(record);
  const { error } = await query;
  if (error) { showMessage("تعذر حفظ العميل: " + error.message, "error"); return; }
  resetCustomerForm(); await loadCustomers(); showMessage(id ? "تم تحديث بيانات العميل." : "تمت إضافة العميل.");
});

async function loadBookings() {
  const { data, error } = await db.from("booking_requests").select("id,reference,booking_type,owner_name,phone,car_make_model,car_year,plate_number,message,status,created_at").order("created_at", { ascending: false }).limit(300);
  if (error) throw error;
  bookings = data || [];
  $("bookingsTable").innerHTML = bookings.length ? bookings.map(b => {
    const options = bookingStatuses.map(status => '<option value="' + escapeHtml(status) + '"' + (b.status === status ? " selected" : "") + '>' + escapeHtml(bookingStatusLabel(status)) + "</option>").join("");
    const statusControl = currentRole === "accountant" ? escapeHtml(bookingStatusLabel(b.status)) : '<select class="status-select booking-status" data-id="' + escapeHtml(b.id) + '">' + options + '</select>';
    const orderAction = ["admin", "manager", "technician"].includes(currentRole) ? '<button class="table-action make-order" data-id="' + escapeHtml(b.id) + '">أمر شغل</button>' : "—";
    return '<tr><td><b>' + escapeHtml(b.reference) + '</b></td><td>' + escapeHtml(b.owner_name) + '</td><td dir="ltr">' + escapeHtml(b.phone) + '</td><td>' + escapeHtml(b.car_make_model) + '<br><small>' + escapeHtml(b.booking_type) + '</small></td><td>' + dateText(b.created_at) + '</td><td>' + statusControl + '</td><td>' + orderAction + '</td></tr>';
  }).join("") : '<tr><td colspan="7" class="empty">لا توجد حجوزات حتى الآن.</td></tr>';
}
$("bookingsTable").addEventListener("change", async event => {
  const select = event.target.closest(".booking-status");
  if (!select) return;
  const { error } = await db.from("booking_requests").update({ status: select.value }).eq("id", select.dataset.id);
  if (error) showMessage("تعذر تحديث حالة الحجز.", "error"); else { showMessage("تم تحديث حالة الحجز."); await loadBookings(); }
});
$("bookingsTable").addEventListener("click", async event => {
  const button = event.target.closest(".make-order");
  if (!button) return;
  const booking = bookings.find(item => item.id === button.dataset.id);
  if (!booking) return;
  try {
    const { data: existing } = await db.from("work_orders").select("order_number").eq("booking_request_id", booking.id).maybeSingle();
    if (existing) { showMessage("تم إنشاء أمر شغل لهذا الحجز بالفعل: " + existing.order_number); return; }
    let customer = customers.find(item => item.phone === normalizePhone(booking.phone));
    if (!customer) {
      const { data, error } = await db.from("customers").insert({ full_name: booking.owner_name, phone: normalizePhone(booking.phone), source: "website" }).select().single();
      if (error) throw error;
      customer = data;
      customers.unshift(customer);
    }
    const { error } = await db.from("work_orders").insert({
      customer_id: customer.id, booking_request_id: booking.id,
      car_make_model: booking.car_make_model, plate_number: booking.plate_number,
      service_type: booking.booking_type, issue_description: booking.message || booking.booking_type,
      created_by: session.user.id
    });
    if (error) throw error;
    await db.from("booking_requests").update({ status: "تم تحويل الحجز لأمر شغل" }).eq("id", booking.id);
    await loadAll(); switchView("workorders"); showMessage("تم إنشاء أمر الشغل وربطه بالعميل والحجز.");
  } catch (error) { showMessage("تعذر إنشاء أمر الشغل: " + error.message, "error"); }
});

$("orderForm").addEventListener("submit", async event => {
  event.preventDefault();
  const record = {
    customer_id: $("orderCustomer").value, service_type: $("orderService").value.trim(),
    car_make_model: $("orderCar").value.trim(), plate_number: $("orderPlate").value.trim() || null,
    status: $("orderStatus").value, promised_at: $("orderPromise").value || null,
    labor_cost: Number($("orderLabor").value || 0), parts_cost: Number($("orderParts").value || 0),
    issue_description: $("orderDescription").value.trim(), created_by: session.user.id
  };
  const { error } = await db.from("work_orders").insert(record);
  if (error) { showMessage("تعذر إنشاء أمر الشغل: " + error.message, "error"); return; }
  $("orderForm").reset(); $("orderLabor").value = "0"; $("orderParts").value = "0";
  await Promise.all([loadOrders(), loadAll()]); showMessage("تم إنشاء أمر الشغل.");
});

async function loadOrders() {
  let query = db.from("work_orders").select("*,customers(full_name,phone)").order("created_at", { ascending: false }).limit(300);
  const status = $("orderFilter").value;
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  orders = data || [];
  const rows = orders.map(o => {
    const options = Object.entries(statusLabels).map(([value,label]) => '<option value="' + value + '"' + (o.status === value ? " selected" : "") + '>' + label + "</option>").join("");
    return '<tr><td><b>' + escapeHtml(o.order_number) + '</b></td><td>' + escapeHtml(o.customers?.full_name || "—") + '</td><td>' + escapeHtml(o.car_make_model) + (o.plate_number ? '<br><small>' + escapeHtml(o.plate_number) + '</small>' : "") + '</td><td>' + escapeHtml(o.service_type) + '</td><td>' + currency(o.total_cost) + '</td><td><select class="status-select order-status" data-id="' + escapeHtml(o.id) + '">' + options + '</select></td></tr>';
  }).join("");
  $("ordersTable").innerHTML = rows || '<tr><td colspan="6" class="empty">لا توجد أوامر شغل.</td></tr>';
  $("recentOrders").innerHTML = orders.slice(0, 5).map(o => '<tr><td>' + escapeHtml(o.order_number) + '</td><td>' + escapeHtml(o.customers?.full_name || "—") + '</td><td>' + escapeHtml(o.car_make_model) + '</td><td>' + escapeHtml(o.service_type) + '</td><td>' + escapeHtml(statusLabels[o.status] || o.status) + '</td></tr>').join("") || '<tr><td colspan="5" class="empty">لا توجد أوامر مسجلة.</td></tr>';
  $("transactionOrder").innerHTML = '<option value="">بدون أمر شغل</option>' + orders.map(o => '<option value="' + escapeHtml(o.id) + '">' + escapeHtml(o.order_number) + ' — ' + escapeHtml(o.customers?.full_name || "") + '</option>').join("");
}
$("orderFilter").addEventListener("change", loadOrders);
$("ordersTable").addEventListener("change", async event => {
  const select = event.target.closest(".order-status");
  if (!select) return;
  const updates = { status: select.value, updated_at: new Date().toISOString() };
  if (select.value === "closed") updates.completed_at = new Date().toISOString();
  const { error } = await db.from("work_orders").update(updates).eq("id", select.dataset.id);
  if (error) showMessage("تعذر تحديث أمر الشغل.", "error"); else { showMessage("تم تحديث حالة أمر الشغل."); await Promise.all([loadOrders(), loadAll()]); }
});

async function loadTransactions() {
  const { data, error } = await db.from("financial_transactions").select("*,work_orders(order_number)").order("transaction_date", { ascending: false }).limit(500);
  if (error) throw error;
  transactions = data || [];
  const income = transactions.filter(t => t.transaction_type === "income").reduce((sum,t) => sum + Number(t.amount), 0);
  const expense = transactions.filter(t => t.transaction_type === "expense").reduce((sum,t) => sum + Number(t.amount), 0);
  $("incomeTotal").textContent = currency(income); $("expenseTotal").textContent = currency(expense); $("netTotal").textContent = currency(income - expense);
  $("transactionsTable").innerHTML = transactions.map(t => '<tr><td>' + dateText(t.transaction_date) + '</td><td>' + (t.transaction_type === "income" ? "إيراد" : "مصروف") + '</td><td>' + escapeHtml(t.category) + (t.description ? '<br><small>' + escapeHtml(t.description) + '</small>' : "") + '</td><td>' + escapeHtml(t.work_orders?.order_number || "—") + '</td><td>' + ({cash:"نقدي",bank_transfer:"تحويل بنكي",card:"بطاقة",other:"أخرى"}[t.payment_method] || "") + '</td><td class="' + (t.transaction_type === "income" ? "amount-in" : "amount-out") + '">' + currency(t.amount) + '</td></tr>').join("") || '<tr><td colspan="6" class="empty">لا توجد حركات مالية مسجلة.</td></tr>';
  $("statBalance").textContent = currency(income - expense);
}
$("transactionForm").addEventListener("submit", async event => {
  event.preventDefault();
  const record = {
    transaction_type: $("transactionType").value, amount: Number($("transactionAmount").value),
    category: $("transactionCategory").value.trim(), payment_method: $("paymentMethod").value,
    work_order_id: $("transactionOrder").value || null, transaction_date: $("transactionDate").value,
    description: $("transactionDescription").value.trim() || null, created_by: session.user.id
  };
  const { error } = await db.from("financial_transactions").insert(record);
  if (error) { showMessage("تعذر حفظ الحركة: " + error.message, "error"); return; }
  $("transactionForm").reset(); $("transactionDate").value = localDate();
  await loadTransactions(); updateStats(); showMessage("تم حفظ الحركة المالية.");
});

function updateStats() {
  $("statBookings").textContent = bookings.length.toLocaleString("ar-EG");
  $("statCustomers").textContent = customers.length.toLocaleString("ar-EG");
  $("statOrders").textContent = orders.filter(o => !["closed","cancelled"].includes(o.status)).length.toLocaleString("ar-EG");
}
function localDate() { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0,10); }
$("transactionDate").value = localDate();
$("loginScreen").hidden = false;
$("adminApp").hidden = true;
const { data: sessionData } = await db.auth.getSession();
if (sessionData.session && sessionStorage.getItem("adminPasswordResetPending")) {
  session = sessionData.session;
  showPasswordResetPanel();
} else if (sessionData.session) await openSession(sessionData.session);

