-- ============================================================
-- FLEXXO SALES OS — AUDIT TRIGGERS
-- Run after prisma migrate dev: psql $DATABASE_URL -f prisma/migrations/audit_triggers.sql
-- ============================================================

CREATE OR REPLACE FUNCTION flexxo_audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
  actor_id TEXT;
  col_name TEXT;
  old_val TEXT;
  new_val TEXT;
BEGIN
  actor_id := coalesce(current_setting('app.current_user_id', true), null);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (id, table_name, record_id, action, actor_id, occurred_at)
    VALUES (gen_random_uuid()::TEXT, TG_TABLE_NAME, NEW.id, 'INSERT', actor_id, NOW());

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (id, table_name, record_id, action, actor_id, occurred_at)
    VALUES (gen_random_uuid()::TEXT, TG_TABLE_NAME, OLD.id, 'DELETE', actor_id, NOW());

  ELSIF TG_OP = 'UPDATE' THEN
    FOREACH col_name IN ARRAY TG_ARGV LOOP
      EXECUTE format('SELECT ($1).%I::TEXT', col_name) INTO old_val USING OLD;
      EXECUTE format('SELECT ($1).%I::TEXT', col_name) INTO new_val USING NEW;
      IF old_val IS DISTINCT FROM new_val THEN
        INSERT INTO audit_log
          (id, table_name, record_id, action, field_name, old_value, new_value, actor_id, occurred_at)
        VALUES
          (gen_random_uuid()::TEXT, TG_TABLE_NAME, NEW.id, 'UPDATE', col_name, old_val, new_val, actor_id, NOW());
      END IF;
    END LOOP;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_companies
  AFTER INSERT OR UPDATE OR DELETE ON companies
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'name','status','qne_customer_code','is_duplicate_suspect','merged_into_id'
  );

CREATE TRIGGER audit_contacts
  AFTER INSERT OR UPDATE OR DELETE ON contacts
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'name','email','phone','is_decision_maker','is_active'
  );

CREATE TRIGGER audit_supplier_price_versions
  AFTER INSERT OR UPDATE OR DELETE ON supplier_price_versions
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'cost_price','is_current','approved_by','approved_at'
  );

CREATE TRIGGER audit_quotations
  AFTER INSERT OR UPDATE OR DELETE ON quotations
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'status','total_amount','approved_by','sent_at'
  );

CREATE TRIGGER audit_quotation_items
  AFTER INSERT OR UPDATE OR DELETE ON quotation_items
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'unit_price','unit_cost','qty','line_total'
  );

CREATE TRIGGER audit_orders
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'status','total_amount','qne_invoice_ref','delivered_at'
  );

CREATE TRIGGER audit_approval_requests
  AFTER INSERT OR UPDATE OR DELETE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'status','reviewer_notes','reviewed_at'
  );
