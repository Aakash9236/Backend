-- =====================================================================
-- MIGRATION: 004_shifting_inventory_labor.sql
-- DESCRIPTION: Shifting inventory catalog, items, and moving labor requirements
-- =====================================================================

BEGIN;


CREATE TABLE IF NOT EXISTS public.inventory_categories (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_name varchar(100) NOT NULL UNIQUE,
    display_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.inventory_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inventory_category_id bigint NOT NULL,
    item_name varchar(150) NOT NULL,
    estimated_volume_cuft numeric(8, 2) NOT NULL DEFAULT 10.00,
    estimated_weight_kg numeric(8, 2) NULL,
    requires_dismantling boolean NOT NULL DEFAULT false,
    fragile boolean NOT NULL DEFAULT false,
    base_packing_charge numeric(10, 2) NOT NULL DEFAULT 0.00,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_inventory_item_category FOREIGN KEY (inventory_category_id) REFERENCES public.inventory_categories(id) ON DELETE RESTRICT,
    CONSTRAINT chk_inventory_volume CHECK (estimated_volume_cuft >= 0),
    CONSTRAINT chk_packing_charge CHECK (base_packing_charge >= 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON public.inventory_items (inventory_category_id);



COMMIT;
