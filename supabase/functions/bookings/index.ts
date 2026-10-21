import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const normalizePhone = (value: string) => value.replace(/[^\d+]/g, "");

async function hashValue(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  const suffix = Array.from(bytes, (byte) => (byte % 36).toString(36))
    .join("").toUpperCase();
  return `AMG-${suffix}`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply({ error: "طريقة الطلب غير مدعومة." }, 405);

  try {
    const payload = await request.json();
    if (payload.website) return reply({ error: "تعذر تسجيل الطلب." }, 400); // honeypot

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return reply({ error: "الخدمة غير مهيأة بعد." }, 503);
    const db = createClient(url, key, { auth: { persistSession: false } });

    const action = payload.action;
    const phoneForLimit = normalizePhone(clean(payload.phone, 30));
    if (!["create", "lookup"].includes(action) || phoneForLimit.length < 8) {
      return reply({ error: "يرجى إدخال رقم الجوال المسجل بالحجز." }, 400);
    }
    const keyHash = await hashValue(phoneForLimit);
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: rateReadError } = await db.from("booking_rate_limits")
      .select("id", { count: "exact", head: true })
      .eq("key_hash", keyHash)
      .eq("action", action)
      .gte("created_at", cutoff);
    if (rateReadError) {
      console.error("rate limit read failed", rateReadError.code);
      return reply({ error: "تعذر التحقق من الطلب الآن. حاول مرة أخرى." }, 503);
    }
    const limit = action === "create" ? 5 : 12;
    if ((count ?? 0) >= limit) return reply({ error: "تم تجاوز عدد المحاولات المسموح مؤقتًا. حاول بعد ساعة." }, 429);
    const { error: rateWriteError } = await db.from("booking_rate_limits").insert({ key_hash: keyHash, action });
    if (rateWriteError) {
      console.error("rate limit write failed", rateWriteError.code);
      return reply({ error: "تعذر تسجيل المحاولة الآن. حاول مرة أخرى." }, 503);
    }

    if (action === "create") {
      const booking = {
        booking_type: clean(payload.bookingType, 80),
        owner_name: clean(payload.name, 120),
        phone: normalizePhone(clean(payload.phone, 30)),
        car_make_model: clean(payload.carMakeModel, 120),
        car_year: Number.isInteger(Number(payload.carYear)) && payload.carYear
          ? Number(payload.carYear)
          : null,
        plate_number: clean(payload.plateNumber, 40) || null,
        message: clean(payload.message, 1000) || null,
      };
      if (!booking.booking_type || !booking.owner_name || booking.phone.length < 8 || !booking.car_make_model) {
        return reply({ error: "يرجى مراجعة بيانات الحجز وإدخال رقم جوال صحيح." }, 400);
      }

      for (let attempt = 0; attempt < 3; attempt++) {
        const reference = makeReference();
        const { data, error } = await db.from("booking_requests")
          .insert({ ...booking, reference })
          .select("reference, status, created_at")
          .single();
        if (!error && data) return reply({ booking: data });
        if (error?.code !== "23505") {
          console.error("booking insert failed", error?.code);
          return reply({ error: "تعذر حفظ الحجز الآن. حاول مرة أخرى أو تواصل معنا عبر واتساب." }, 503);
        }
      }
      return reply({ error: "تعذر إنشاء رقم مرجعي. حاول مرة أخرى." }, 503);
    }

    if (action === "lookup") {
      const reference = clean(payload.reference, 20).toUpperCase();
      const phone = normalizePhone(clean(payload.phone, 30));
      if (!/^AMG-[A-Z0-9]{5}$/.test(reference) || phone.length < 8) {
        return reply({ error: "أدخل الرقم المرجعي ورقم الجوال المسجل بالحجز." }, 400);
      }
      const { data, error } = await db.from("booking_requests")
        .select("status, created_at")
        .eq("reference", reference)
        .eq("phone", phone)
        .maybeSingle();
      if (error) {
        console.error("booking lookup failed", error.code);
        return reply({ error: "تعذر الاستعلام الآن. حاول مرة أخرى." }, 503);
      }
      if (!data) return reply({ error: "لم نعثر على طلب مطابق للرقم المرجعي ورقم الجوال." }, 404);
      return reply({ booking: data });
    }

    return reply({ error: "الطلب غير معروف." }, 400);
  } catch {
    return reply({ error: "تعذر معالجة الطلب. تحقق من البيانات وحاول مرة أخرى." }, 400);
  }
});

