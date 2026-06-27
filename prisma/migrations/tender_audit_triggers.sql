-- ============================================================
-- FLEXXO SALES OS — TENDER MODULE AUDIT TRIGGERS
-- Self-contained: (re)defines flexxo_audit_trigger() then attaches
-- triggers to the tender tables. Idempotent (CREATE OR REPLACE / DROP IF EXISTS).
-- Run: npx prisma db execute --file prisma/migrations/tender_audit_triggers.sql
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

DROP TRIGGER IF EXISTS audit_tenders ON tenders;
CREATE TRIGGER audit_tenders
  AFTER INSERT OR UPDATE OR DELETE ON tenders
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'stage','status','prices_locked_at','prices_locked_by','qne_project_code',
    'gate1_approval_id','gate2_approval_id','gate3_approval_id'
  );

DROP TRIGGER IF EXISTS audit_tender_items ON tender_items;
CREATE TRIGGER audit_tender_items
  AFTER INSERT OR UPDATE OR DELETE ON tender_items
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'qty','normal_unit_price','awarded_unit_price','awarded_supplier_id'
  );

DROP TRIGGER IF EXISTS audit_tender_vendors ON tender_vendors;
CREATE TRIGGER audit_tender_vendors
  AFTER INSERT OR UPDATE OR DELETE ON tender_vendors
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'reply_status','quote_valid_until'
  );

DROP TRIGGER IF EXISTS audit_tender_vendor_quotes ON tender_vendor_quotes;
CREATE TRIGGER audit_tender_vendor_quotes
  AFTER INSERT OR UPDATE OR DELETE ON tender_vendor_quotes
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'quoted_unit_price','is_awarded','flagged_over_threshold','override_reason'
  );

DROP TRIGGER IF EXISTS audit_client_pos ON client_pos;
CREATE TRIGGER audit_client_pos
  AFTER INSERT OR UPDATE OR DELETE ON client_pos
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'po_number','value','qne_sales_order_code'
  );

DROP TRIGGER IF EXISTS audit_supplier_pos ON supplier_pos;
CREATE TRIGGER audit_supplier_pos
  AFTER INSERT OR UPDATE OR DELETE ON supplier_pos
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'status','ack_date','qne_po_code'
  );

DROP TRIGGER IF EXISTS audit_supplier_po_items ON supplier_po_items;
CREATE TRIGGER audit_supplier_po_items
  AFTER INSERT OR UPDATE OR DELETE ON supplier_po_items
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'qty','unit_price'
  );

DROP TRIGGER IF EXISTS audit_goods_receipts ON goods_receipts;
CREATE TRIGGER audit_goods_receipts
  AFTER INSERT OR UPDATE OR DELETE ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'closed','qne_grn_code'
  );

DROP TRIGGER IF EXISTS audit_grn_items ON grn_items;
CREATE TRIGGER audit_grn_items
  AFTER INSERT OR UPDATE OR DELETE ON grn_items
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'qty_received','reject_qty'
  );

DROP TRIGGER IF EXISTS audit_tender_amendments ON tender_amendments;
CREATE TRIGGER audit_tender_amendments
  AFTER INSERT OR UPDATE OR DELETE ON tender_amendments
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'reason','approved_by'
  );

DROP TRIGGER IF EXISTS audit_tender_documents ON tender_documents;
CREATE TRIGGER audit_tender_documents
  AFTER INSERT OR UPDATE OR DELETE ON tender_documents
  FOR EACH ROW EXECUTE FUNCTION flexxo_audit_trigger(
    'storage_url'
  );
