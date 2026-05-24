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
