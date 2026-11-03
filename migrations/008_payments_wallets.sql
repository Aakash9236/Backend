-- =====================================================================
-- MIGRATION: 008_payments_wallets.sql
-- DESCRIPTION: Payment gateways, refunds, partner wallets, and transaction ledger
-- =====================================================================

BEGIN;


CREATE TABLE IF NOT EXISTS public.payments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL,
    payment_method varchar(30) NOT NULL,
    payment_status varchar(30) NOT NULL DEFAULT 'PENDING',
    amount numeric(10, 2) NOT NULL,
    currency varchar(10) NOT NULL DEFAULT 'INR',
    gateway_name varchar(50) NULL,
    gateway_order_id varchar(100) NULL,
    gateway_payment_id varchar(100) NULL UNIQUE,
    gateway_signature varchar(255) NULL,
    idempotency_key varchar(100) NULL UNIQUE,
    error_message text NULL,
    paid_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_payment_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT,
    CONSTRAINT chk_payment_amount CHECK (amount >= 0),
    CONSTRAINT chk_payment_method CHECK (payment_method IN ('ONLINE_RAZORPAY', 'CASH_ON_DELIVERY', 'WALLET', 'UPI')),
    CONSTRAINT chk_payment_status CHECK (payment_status IN ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'))
);

CREATE TABLE IF NOT EXISTS public.refunds (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id bigint NOT NULL,
    booking_id bigint NOT NULL,
    refund_amount numeric(10, 2) NOT NULL,
    currency varchar(10) NOT NULL DEFAULT 'INR',
    gateway_refund_id varchar(100) NULL UNIQUE,
    refund_reason text NOT NULL,
    refund_status varchar(30) NOT NULL DEFAULT 'PENDING',
    processed_by bigint NULL,
    processed_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_refund_payment FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_refund_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT,
    CONSTRAINT fk_refund_processed_by FOREIGN KEY (processed_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_refund_amount CHECK (refund_amount > 0),
    CONSTRAINT chk_refund_status CHECK (refund_status IN ('PENDING', 'PROCESSED', 'FAILED'))
);

CREATE TABLE IF NOT EXISTS public.partner_wallets (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    partner_id bigint NOT NULL UNIQUE,
    available_balance numeric(12, 2) NOT NULL DEFAULT 0.00,
    locked_balance numeric(12, 2) NOT NULL DEFAULT 0.00,
    total_earned numeric(12, 2) NOT NULL DEFAULT 0.00,
    total_withdrawn numeric(12, 2) NOT NULL DEFAULT 0.00,
    currency varchar(10) NOT NULL DEFAULT 'INR',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_wallet_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE,
    CONSTRAINT chk_wallet_balances CHECK (available_balance >= 0 AND locked_balance >= 0)
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    wallet_id bigint NOT NULL,
    booking_id bigint NULL,
    transaction_type varchar(30) NOT NULL,
    amount numeric(10, 2) NOT NULL,
    opening_balance numeric(12, 2) NOT NULL,
    closing_balance numeric(12, 2) NOT NULL,
    reference_id varchar(100) NULL,
    description text NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_tx_wallet FOREIGN KEY (wallet_id) REFERENCES public.partner_wallets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_tx_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL,
    CONSTRAINT chk_tx_amount CHECK (amount > 0),
    CONSTRAINT chk_tx_type CHECK (transaction_type IN (
        'CREDIT_BOOKING_EARNING',
        'CREDIT_TIP',
        'CREDIT_INCENTIVE',
        'DEBIT_COMMISSION',
        'DEBIT_PENALTY',
        'DEBIT_WITHDRAWAL',
        'DEBIT_REFUND_REVERSAL'
    ))
);

CREATE INDEX IF NOT EXISTS idx_payments_booking ON public.payments (booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments (payment_status);
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON public.refunds (payment_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet ON public.wallet_transactions (wallet_id, created_at DESC);



COMMIT;
