-- =====================================================================
-- MIGRATION: 010_reviews_ratings.sql
-- DESCRIPTION: Two-way rating and feedback system for completed bookings
-- =====================================================================

BEGIN;


CREATE TABLE IF NOT EXISTS public.reviews_ratings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL,
    reviewer_user_id bigint NOT NULL,
    reviewee_user_id bigint NOT NULL,
    rating integer NOT NULL,
    review_title varchar(150) NULL,
    comment text NULL,
    tags text[] NULL,
    is_public boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_review_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE,
    CONSTRAINT fk_review_reviewer FOREIGN KEY (reviewer_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT fk_review_reviewee FOREIGN KEY (reviewee_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT uq_booking_reviewer UNIQUE (booking_id, reviewer_user_id),
    CONSTRAINT chk_review_rating CHECK (rating >= 1 AND rating <= 5)
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON public.reviews_ratings (reviewee_user_id, rating);
CREATE INDEX IF NOT EXISTS idx_reviews_booking ON public.reviews_ratings (booking_id);



COMMIT;
