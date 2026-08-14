const crypto = require("node:crypto");
const { initialPromoRecords, normalizePromoCode, promoAvailability, promoError } = require("./promo-config.cjs");

class PostgresPaymentStore {
  constructor(options = {}) {
    const connectionString = String(options.connectionString || options.env?.DATABASE_URL || process.env.DATABASE_URL || "").trim();
    if (!connectionString && !options.pool) throw configurationError("DATABASE_URL обязателен для production persistence.");
    this.pool = options.pool || createPool(connectionString);
    this.ready = this.initialize();
  }

  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tian_min_orders (
        order_id TEXT PRIMARY KEY,
        checkout_key_hash TEXT UNIQUE NOT NULL,
        record JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS tian_min_payment_attempts (
        attempt_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        external_order_id TEXT UNIQUE NOT NULL,
        idempotency_key TEXT UNIQUE NOT NULL,
        payment_public_id TEXT UNIQUE,
        provider_status TEXT NOT NULL,
        request_body_hash TEXT NOT NULL,
        record JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS tian_min_attempts_order_idx ON tian_min_payment_attempts(order_id, updated_at);
      DROP INDEX IF EXISTS tian_min_one_active_attempt_idx;
      CREATE UNIQUE INDEX IF NOT EXISTS tian_min_one_active_user_session_idx ON tian_min_payment_attempts(order_id)
        WHERE record->>'userSessionStatus'='active';
      CREATE TABLE IF NOT EXISTS tian_min_consent_records (
        consent_reference TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL UNIQUE,
        payer_email TEXT NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS tian_min_webhook_inbox (
        event_id TEXT PRIMARY KEY,
        payload_hash TEXT NOT NULL,
        record JSONB NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS tian_min_payment_anomalies (
        anomaly_id TEXT PRIMARY KEY,
        order_id TEXT,
        anomaly_type TEXT NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS tian_min_reports (
        report_id TEXT PRIMARY KEY,
        record JSONB NOT NULL,
        saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS tian_min_orders_report_access_idx ON tian_min_orders((record->>'reportAccessTokenHash')) WHERE record->>'reportAccessTokenHash' IS NOT NULL;
      CREATE TABLE IF NOT EXISTS tian_min_promos (
        normalized_code TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        discount_type TEXT NOT NULL,
        discount_value INTEGER NOT NULL,
        target_final_amount INTEGER NOT NULL,
        active BOOLEAN NOT NULL,
        starts_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        max_redemptions INTEGER,
        redemption_count INTEGER NOT NULL DEFAULT 0,
        per_order_limit INTEGER,
        campaign TEXT,
        source TEXT,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS tian_min_promo_redemptions (
        redemption_id TEXT PRIMARY KEY,
        promo_code TEXT NOT NULL REFERENCES tian_min_promos(normalized_code),
        order_id TEXT NOT NULL UNIQUE,
        report_id TEXT NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS tian_min_promo_events (
        event_id TEXT PRIMARY KEY,
        promo_code TEXT NOT NULL REFERENCES tian_min_promos(normalized_code),
        event_type TEXT NOT NULL,
        order_id TEXT NOT NULL,
        report_id TEXT NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(promo_code,event_type,order_id)
      );
    `);
    for (const promo of initialPromoRecords()) {
      await this.pool.query(
        `INSERT INTO tian_min_promos(normalized_code,code,discount_type,discount_value,target_final_amount,active,starts_at,expires_at,max_redemptions,redemption_count,per_order_limit,campaign,source,record,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
         ON CONFLICT(normalized_code) DO UPDATE SET
         code=EXCLUDED.code,discount_type=EXCLUDED.discount_type,discount_value=EXCLUDED.discount_value,
         target_final_amount=EXCLUDED.target_final_amount,active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,
         expires_at=EXCLUDED.expires_at,max_redemptions=EXCLUDED.max_redemptions,per_order_limit=EXCLUDED.per_order_limit,
         campaign=EXCLUDED.campaign,source=EXCLUDED.source,
         record=EXCLUDED.record || jsonb_build_object('redemptionCount',tian_min_promos.redemption_count,'createdAt',tian_min_promos.created_at,'updatedAt',NOW()),
         updated_at=NOW()`,
        [promo.normalizedCode, promo.code, promo.discountType, promo.discountValue, promo.targetFinalAmount, promo.active, promo.startsAt, promo.expiresAt, promo.maxRedemptions, promo.redemptionCount, promo.perOrderLimit, promo.campaign, promo.source, JSON.stringify(promo), promo.createdAt, promo.updatedAt],
      );
    }
  }

  async save(order) {
    await this.ready;
    try {
      const result = await this.pool.query(
        `INSERT INTO tian_min_orders(order_id, checkout_key_hash, record, updated_at)
         VALUES($1,$2,$3::jsonb,NOW()) ON CONFLICT(order_id) DO UPDATE
         SET checkout_key_hash=EXCLUDED.checkout_key_hash, record=EXCLUDED.record, updated_at=NOW()
         RETURNING record`,
        [order.orderId, order.checkoutKeyHash, JSON.stringify(order)],
      );
      return clone(result.rows[0].record);
    } catch (error) {
      if (error?.code !== "23505") throw error;
      const existing = await this.findByCheckoutKey(order.checkoutKeyHash);
      if (existing) return existing;
      throw error;
    }
  }

  async load(orderId) { await this.ready; return recordOrNull(await this.pool.query("SELECT record FROM tian_min_orders WHERE order_id=$1", [String(orderId)])); }
  async findByCheckoutKey(hash) { await this.ready; return recordOrNull(await this.pool.query("SELECT record FROM tian_min_orders WHERE checkout_key_hash=$1", [String(hash)])); }
  async findByReportAccessTokenHash(hash) { await this.ready; return recordOrNull(await this.pool.query("SELECT record FROM tian_min_orders WHERE record->>'reportAccessTokenHash'=$1", [String(hash)])); }
  async claimReportGeneration({ orderId, now, leaseUntil, runId }) {
    await this.ready;
    const changes = { status:"REPORT_GENERATING", reportGenerationStartedAt:now, reportGenerationCompletedAt:null,
      reportGenerationLeaseUntil:leaseUntil,reportGenerationRunId:runId };
    const result = await this.pool.query(
      `UPDATE tian_min_orders SET record=record || $2::jsonb || jsonb_build_object('reportGenerationAttempt',COALESCE((record->>'reportGenerationAttempt')::int,0)+1,'updatedAt',$3::text),updated_at=NOW()
       WHERE order_id=$1 AND (
         record->>'status' IN ('PAID','REPORT_FAILED')
         OR (record->>'accessReason'='complimentary_promo' AND record->>'status' IN ('CHECKOUT_STARTED','REPORT_FAILED'))
         OR (record->>'status'='REPORT_GENERATING' AND COALESCE((record->>'reportGenerationLeaseUntil')::timestamptz,'epoch'::timestamptz) <= $3::timestamptz)
       ) RETURNING record`,
      [String(orderId), JSON.stringify(changes), now],
    );
    if (result.rows[0]) return { claimed:true, order:clone(result.rows[0].record) };
    return { claimed:false, order:await this.load(orderId) };
  }

  async saveAttempt(attempt) {
    await this.ready;
    const result = await this.pool.query(
      `INSERT INTO tian_min_payment_attempts(attempt_id,order_id,external_order_id,idempotency_key,payment_public_id,provider_status,request_body_hash,record,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW()) ON CONFLICT(attempt_id) DO UPDATE SET
       payment_public_id=EXCLUDED.payment_public_id,provider_status=EXCLUDED.provider_status,record=EXCLUDED.record,updated_at=NOW()
       WHERE tian_min_payment_attempts.request_body_hash=EXCLUDED.request_body_hash
       RETURNING record`,
      [attempt.attemptId, attempt.orderId, attempt.externalOrderId, attempt.idempotencyKey, attempt.paymentPublicId || null, attempt.providerStatus, attempt.requestBodyHash, JSON.stringify(attempt)],
    );
    if (!result.rows[0]) throw configurationError("Immutable payment attempt body нельзя изменить.");
    return clone(result.rows[0].record);
  }
  async loadAttempt(attemptId) { await this.ready; return recordOrNull(await this.pool.query("SELECT record FROM tian_min_payment_attempts WHERE attempt_id=$1", [String(attemptId)])); }
  async findAttemptByPaymentId(paymentId) { await this.ready; return recordOrNull(await this.pool.query("SELECT record FROM tian_min_payment_attempts WHERE payment_public_id=$1", [String(paymentId)])); }
  async listAttemptsByOrder(orderId) { await this.ready; const result = await this.pool.query("SELECT record FROM tian_min_payment_attempts WHERE order_id=$1 ORDER BY updated_at", [String(orderId)]); return result.rows.map(row => clone(row.record)); }

  async saveConsent(record) {
    await this.ready;
    await this.pool.query(
      `INSERT INTO tian_min_consent_records(consent_reference,order_id,attempt_id,payer_email,record)
       VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(consent_reference) DO NOTHING`,
      [record.externalConsentReference, record.orderId, record.attemptId, record.payerEmail, JSON.stringify(record)],
    );
    return clone(record);
  }

  async beginPaymentAttempt({ order, attempt, consent }) {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query("SELECT record FROM tian_min_orders WHERE order_id=$1 FOR UPDATE", [order.orderId]);
      const current = locked.rows[0]?.record;
      if (!current) throw configurationError("Заказ для payment attempt не найден.");
      if (current.currentAttemptId || current.status !== "CHECKOUT_STARTED") throw paymentSessionConflict();
      await client.query(
        `INSERT INTO tian_min_payment_attempts(attempt_id,order_id,external_order_id,idempotency_key,payment_public_id,provider_status,request_body_hash,record,updated_at)
         VALUES($1,$2,$3,$4,NULL,$5,$6,$7::jsonb,NOW())`,
        [attempt.attemptId, attempt.orderId, attempt.externalOrderId, attempt.idempotencyKey, attempt.providerStatus, attempt.requestBodyHash, JSON.stringify(attempt)],
      );
      await client.query(
        `INSERT INTO tian_min_consent_records(consent_reference,order_id,attempt_id,payer_email,record)
         VALUES($1,$2,$3,$4,$5::jsonb)`,
        [consent.externalConsentReference, consent.orderId, consent.attemptId, consent.payerEmail, JSON.stringify(consent)],
      );
      const nextOrder = { ...clone(current), ...paymentSessionFields(order) };
      const saved = await client.query(
        "UPDATE tian_min_orders SET record=$2::jsonb,updated_at=NOW() WHERE order_id=$1 RETURNING record",
        [order.orderId, JSON.stringify(nextOrder)],
      );
      if (!saved.rows[0]) throw configurationError("Заказ для payment attempt не найден.");
      await client.query("COMMIT");
      return clone(saved.rows[0].record);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async endPaymentSession({ orderId, attemptId, reason, now }) {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query("SELECT record FROM tian_min_orders WHERE order_id=$1 FOR UPDATE", [String(orderId)]);
      const order = locked.rows[0]?.record;
      if (!order) { await client.query("ROLLBACK"); return null; }
      if (["PAID", "REPORT_GENERATING", "REPORT_READY", "REPORT_FAILED"].includes(order.status) || order.currentAttemptId !== attemptId) { await client.query("COMMIT"); return clone(order); }
      const attemptResult = await client.query("SELECT record FROM tian_min_payment_attempts WHERE attempt_id=$1 FOR UPDATE", [String(attemptId)]);
      const attempt = attemptResult.rows[0]?.record;
      if (attempt) {
        const endedAttempt = { ...clone(attempt), userSessionStatus: reason === "cancelled" ? "cancelled" : "expired", userSessionEndReason: reason, userSessionEndedAt: now, updatedAt: now };
        await client.query("UPDATE tian_min_payment_attempts SET record=$2::jsonb,updated_at=NOW() WHERE attempt_id=$1", [String(attemptId), JSON.stringify(endedAttempt)]);
      }
      const updated = { ...clone(order), status: "CHECKOUT_STARTED", lastAttemptId: attemptId, currentAttemptId: null, paymentId: null, providerStatus: null, paymentMethod: null, nextPollAt: null, paymentFailureReason: null, paymentSessionStatus: null, paymentSessionExpiresAt: null, paymentSessionEndReason: reason, updatedAt: now };
      const saved = await client.query("UPDATE tian_min_orders SET record=$2::jsonb,updated_at=NOW() WHERE order_id=$1 RETURNING record", [String(orderId), JSON.stringify(updated)]);
      await client.query("COMMIT");
      return clone(saved.rows[0].record);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async saveCurrentPaymentSession({ orderId, attemptId, changes }) {
    await this.ready;
    const result = await this.pool.query(
      `UPDATE tian_min_orders SET record=record || $3::jsonb,updated_at=NOW()
       WHERE order_id=$1 AND record->>'status'='PAYMENT_PENDING' AND record->>'currentAttemptId'=$2
       RETURNING record`,
      [String(orderId), String(attemptId), JSON.stringify(changes)],
    );
    return result.rows[0] ? clone(result.rows[0].record) : this.load(orderId);
  }

  async recordWebhook(event) {
    await this.ready;
    const inserted = await this.pool.query(
      `INSERT INTO tian_min_webhook_inbox(event_id,payload_hash,record) VALUES($1,$2,$3::jsonb)
       ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
      [event.eventId, event.payloadHash, JSON.stringify(event)],
    );
    if (inserted.rowCount === 1) return { status: "stored" };
    const existing = await this.pool.query("SELECT payload_hash FROM tian_min_webhook_inbox WHERE event_id=$1", [event.eventId]);
    return existing.rows[0]?.payload_hash === event.payloadHash ? { status: "duplicate" } : { status: "conflict" };
  }

  async loadWebhook(eventId) { await this.ready; return recordOrNull(await this.pool.query("SELECT record FROM tian_min_webhook_inbox WHERE event_id=$1", [String(eventId)])); }
  async listPendingWebhooks(limit = 50) {
    await this.ready;
    const result = await this.pool.query(
      `SELECT record FROM tian_min_webhook_inbox
       WHERE (record->>'processingStatus' IN ('pending','retry') AND (record->>'nextProcessingAt' IS NULL OR (record->>'nextProcessingAt')::timestamptz <= NOW()))
          OR (record->>'processingStatus'='processing' AND (record->>'processingLeaseUntil')::timestamptz <= NOW())
       ORDER BY received_at LIMIT $1`,
      [Math.max(1, Math.min(100, Number(limit) || 50))],
    );
    return result.rows.map(row => clone(row.record));
  }
  async updateWebhook(eventId, changes) {
    await this.ready;
    const result = await this.pool.query(
      `UPDATE tian_min_webhook_inbox SET record=record || $2::jsonb WHERE event_id=$1 RETURNING record`,
      [String(eventId), JSON.stringify(changes)],
    );
    return result.rows[0] ? clone(result.rows[0].record) : null;
  }

  async saveAnomaly(record) {
    await this.ready;
    const anomaly = { anomalyId: record.anomalyId || `anomaly_${crypto.randomBytes(16).toString("hex")}`, createdAt: record.createdAt || new Date().toISOString(), ...record };
    await this.pool.query(
      "INSERT INTO tian_min_payment_anomalies(anomaly_id,order_id,anomaly_type,record) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(anomaly_id) DO NOTHING",
      [anomaly.anomalyId, anomaly.orderId || null, anomaly.type, JSON.stringify(anomaly)],
    );
    return anomaly;
  }

  async getPromo(code, client = this.pool) {
    await this.ready;
    const result = await client.query("SELECT record || jsonb_build_object('redemptionCount',redemption_count,'active',active,'updatedAt',updated_at) AS record FROM tian_min_promos WHERE normalized_code=$1", [normalizePromoCode(code)]);
    return result.rows[0] ? clone(result.rows[0].record) : null;
  }

  async applyPromoToOrder({ orderId, code, now }) {
    await this.ready;
    const normalizedCode = normalizePromoCode(code);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const promoResult = await client.query("SELECT record || jsonb_build_object('redemptionCount',redemption_count,'active',active,'updatedAt',updated_at) AS record FROM tian_min_promos WHERE normalized_code=$1 FOR UPDATE", [normalizedCode]);
      const promo = promoResult.rows[0]?.record || null;
      const availability = promoAvailability(promo, new Date(now));
      if (!availability.ok) throw promoError(availability);
      const orderResult = await client.query("SELECT record FROM tian_min_orders WHERE order_id=$1 FOR UPDATE", [String(orderId)]);
      const order = orderResult.rows[0]?.record;
      const terminalPayment = ["failed", "expired"].includes(order?.providerStatus);
      if (!order || order.status !== "CHECKOUT_STARTED" || order.accessReason || ((!terminalPayment) && (order.currentAttemptId || order.paymentId))) throw promoError({ code: "PROMO_INVALID", message: "Этот промокод нельзя применить" });
      const updated = { ...order, status: "CHECKOUT_STARTED", baseAmount: order.baseAmount || order.amount, amount: promo.targetFinalAmount, promoCode: promo.normalizedCode, promoCampaign: promo.campaign, promoAppliedAt: now, currentAttemptId: null, paymentId: null, providerStatus: null, paymentMethod: null, nextPollAt: null, paymentFailureReason: null, updatedAt: now };
      await client.query("UPDATE tian_min_orders SET record=$2::jsonb,updated_at=NOW() WHERE order_id=$1", [order.orderId, JSON.stringify(updated)]);
      await insertPromoEvent(client, { promoCode: normalizedCode, eventType: "promo_applied", orderId: order.orderId, reportId: order.reportId, createdAt: now });
      await insertPromoEvent(client, { promoCode: normalizedCode, eventType: "checkout_created", orderId: order.orderId, reportId: order.reportId, createdAt: now });
      await client.query("COMMIT");
      return { order: clone(updated), promo: clone(promo) };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async redeemComplimentaryPromo({ orderId, code, now }) {
    await this.ready;
    const normalizedCode = normalizePromoCode(code);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT record FROM tian_min_promo_redemptions WHERE order_id=$1 FOR UPDATE", [String(orderId)]);
      if (existing.rows[0]) {
        const redemption = existing.rows[0].record;
        if (redemption.promoCode !== normalizedCode) throw promoError({ code: "PROMO_INVALID", message: "Этот промокод нельзя применить" });
        const saved = await client.query("SELECT record FROM tian_min_orders WHERE order_id=$1", [String(orderId)]);
        await client.query("COMMIT");
        return { order: clone(saved.rows[0].record), redemption: clone(redemption), duplicate: true };
      }
      const promoResult = await client.query("SELECT record || jsonb_build_object('redemptionCount',redemption_count,'active',active,'updatedAt',updated_at) AS record FROM tian_min_promos WHERE normalized_code=$1 FOR UPDATE", [normalizedCode]);
      const promo = promoResult.rows[0]?.record || null;
      const availability = promoAvailability(promo, new Date(now));
      if (!availability.ok) throw promoError(availability);
      const orderResult = await client.query("SELECT record FROM tian_min_orders WHERE order_id=$1 FOR UPDATE", [String(orderId)]);
      const order = orderResult.rows[0]?.record;
      if (!order || order.promoCode !== normalizedCode || promo.targetFinalAmount !== 0 || !order.reportId || order.accessReason) throw promoError({ code: "PROMO_INVALID", message: "Этот промокод нельзя применить" });
      const redemption = { redemptionId: `promo_redemption_${crypto.randomBytes(16).toString("hex")}`, promoCode: normalizedCode, orderId: order.orderId, reportId: order.reportId, finalAmount: 0, accessReason: "complimentary_promo", createdAt: now };
      const updated = { ...order, amount: 0, accessReason: "complimentary_promo", premiumEntitledAt: now, promoRedeemedAt: now, updatedAt: now };
      await client.query("INSERT INTO tian_min_promo_redemptions(redemption_id,promo_code,order_id,report_id,record,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)", [redemption.redemptionId, normalizedCode, order.orderId, order.reportId, JSON.stringify(redemption), now]);
      await client.query("UPDATE tian_min_promos SET redemption_count=redemption_count+1,record=record || jsonb_build_object('redemptionCount',redemption_count+1,'updatedAt',$2::text),updated_at=NOW() WHERE normalized_code=$1", [normalizedCode, now]);
      await client.query("UPDATE tian_min_orders SET record=$2::jsonb,updated_at=NOW() WHERE order_id=$1", [order.orderId, JSON.stringify(updated)]);
      await insertPromoEvent(client, { promoCode: normalizedCode, eventType: "complimentary_entitlement_created", orderId: order.orderId, reportId: order.reportId, createdAt: now });
      await client.query("COMMIT");
      return { order: clone(updated), redemption: clone(redemption), duplicate: false };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async recordPromoEvent(event) {
    if (!event?.promoCode) return null;
    await this.ready;
    return insertPromoEvent(this.pool, event);
  }
}

class PostgresReportStore {
  constructor(paymentStore) { this.paymentStore = paymentStore; }
  async save(envelope) {
    await this.paymentStore.ready;
    const id = envelope.reportId;
    const stored = { ...envelope, id, savedAt: new Date().toISOString() };
    await this.paymentStore.pool.query(
      "INSERT INTO tian_min_reports(report_id,record,saved_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(report_id) DO UPDATE SET record=EXCLUDED.record,saved_at=NOW()",
      [id, JSON.stringify(stored)],
    );
    return { id };
  }
  async saveImmutable(envelope) {
    await this.paymentStore.ready;
    const id=envelope.reportId;
    const stored={ ...envelope,id,savedAt:envelope.savedAt || new Date().toISOString() };
    const result=await this.paymentStore.pool.query(
      "INSERT INTO tian_min_reports(report_id,record,saved_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(report_id) DO NOTHING RETURNING report_id",
      [id,JSON.stringify(stored)],
    );
    return { id,existing:result.rowCount===0 };
  }
  async load(id) { await this.paymentStore.ready; return recordOrNull(await this.paymentStore.pool.query("SELECT record FROM tian_min_reports WHERE report_id=$1", [String(id)])); }
}

function createPool(connectionString) { const { Pool } = require("pg"); return new Pool({ connectionString, max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 }); }
function recordOrNull(result) { return result.rows[0] ? clone(result.rows[0].record) : null; }
function clone(value) { return value == null ? null : structuredClone(value); }
function configurationError(message) { const error = new Error(message); error.code = "PAYMENT_CONFIGURATION_ERROR"; return error; }
function paymentSessionConflict() { const error = new Error("Платёжная сессия уже существует."); error.code = "PAYMENT_SESSION_CONFLICT"; return error; }
function paymentSessionFields(order) { return { status: order.status, currentAttemptId: order.currentAttemptId, paymentId: order.paymentId, providerStatus: order.providerStatus, paymentMethod: order.paymentMethod, nextPollAt: order.nextPollAt, paymentFailureReason: order.paymentFailureReason, paymentSessionStatus: order.paymentSessionStatus, paymentSessionExpiresAt: order.paymentSessionExpiresAt, paymentSessionEndReason: order.paymentSessionEndReason, updatedAt: order.updatedAt }; }
async function insertPromoEvent(client, event) {
  const record = { eventId: `promo_event_${crypto.randomBytes(16).toString("hex")}`, ...event };
  await client.query(
    `INSERT INTO tian_min_promo_events(event_id,promo_code,event_type,order_id,report_id,record,created_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(promo_code,event_type,order_id) DO NOTHING`,
    [record.eventId, record.promoCode, record.eventType, record.orderId, record.reportId, JSON.stringify(record), record.createdAt],
  );
  return record;
}

module.exports = { PostgresPaymentStore, PostgresReportStore };
