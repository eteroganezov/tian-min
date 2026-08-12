const crypto = require("node:crypto");

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
      CREATE UNIQUE INDEX IF NOT EXISTS tian_min_one_active_attempt_idx ON tian_min_payment_attempts(order_id)
        WHERE provider_status NOT IN ('failed','expired');
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
    `);
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
      const saved = await client.query(
        "UPDATE tian_min_orders SET record=$2::jsonb,updated_at=NOW() WHERE order_id=$1 RETURNING record",
        [order.orderId, JSON.stringify(order)],
      );
      if (!saved.rows[0]) throw configurationError("Заказ для payment attempt не найден.");
      await client.query("COMMIT");
      return clone(saved.rows[0].record);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
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

  async saveAnomaly(record) {
    await this.ready;
    const anomaly = { anomalyId: record.anomalyId || `anomaly_${crypto.randomBytes(16).toString("hex")}`, createdAt: record.createdAt || new Date().toISOString(), ...record };
    await this.pool.query(
      "INSERT INTO tian_min_payment_anomalies(anomaly_id,order_id,anomaly_type,record) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(anomaly_id) DO NOTHING",
      [anomaly.anomalyId, anomaly.orderId || null, anomaly.type, JSON.stringify(anomaly)],
    );
    return anomaly;
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
  async load(id) { await this.paymentStore.ready; return recordOrNull(await this.paymentStore.pool.query("SELECT record FROM tian_min_reports WHERE report_id=$1", [String(id)])); }
}

function createPool(connectionString) { const { Pool } = require("pg"); return new Pool({ connectionString, max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 }); }
function recordOrNull(result) { return result.rows[0] ? clone(result.rows[0].record) : null; }
function clone(value) { return value == null ? null : structuredClone(value); }
function configurationError(message) { const error = new Error(message); error.code = "PAYMENT_CONFIGURATION_ERROR"; return error; }

module.exports = { PostgresPaymentStore, PostgresReportStore };
