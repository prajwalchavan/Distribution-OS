ALTER POLICY "sync_tombstones_read" ON "sync_tombstones" TO app_rw USING ((tenant_id = (SELECT current_setting('app.tenant_id', true)) OR tenant_id = '*') AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR (
          table_name IN (
            'retailers', 'retailer_links', 'sales_orders', 'sales_order_lines', 'price_lists',
            'price_list_items', 'schemes', 'invoices', 'invoice_lines', 'credit_notes',
            'credit_note_lines', 'receipts', 'retailer_outstanding_summary', 'tenant_products',
            'products', 'product_variants', 'manufacturers', 'brands'
          )
          AND (
            table_name NOT IN ('retailers', 'retailer_outstanding_summary')
            OR row_id IN (
              SELECT l.retailer_id FROM retailer_links l
              WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
                AND l.user_id = (SELECT current_setting('app.actor_id', true))
                AND l.status = 'active'
            )
          )
        )
      ));