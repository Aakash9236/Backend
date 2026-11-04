--
-- PostgreSQL database dump
--

\restrict obRMHKa5AMThhWCoKSldOqVZd4OgdpAy5mTYaOgNDifd9ED5t4Hf5MdfLXRxPmJ

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: areas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.areas (
    id bigint NOT NULL,
    city_id bigint NOT NULL,
    area_name character varying(150) NOT NULL,
    postal_code character varying(10),
    latitude numeric(10,7),
    longitude numeric(10,7),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_area_latitude CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)))),
    CONSTRAINT chk_area_longitude CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))))
);


ALTER TABLE public.areas OWNER TO postgres;

--
-- Name: areas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.areas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.areas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    actor_user_id bigint,
    action character varying(100) NOT NULL,
    entity_name character varying(100) NOT NULL,
    entity_id bigint NOT NULL,
    old_values jsonb,
    new_values jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO postgres;

--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.audit_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: booking_assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.booking_assignments (
    id bigint NOT NULL,
    booking_id bigint NOT NULL,
    partner_id bigint NOT NULL,
    role_assigned character varying(30) DEFAULT 'PRIMARY_PARTNER'::character varying NOT NULL,
    assignment_status character varying(30) DEFAULT 'OFFERED'::character varying NOT NULL,
    assigned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    responded_at timestamp with time zone,
    rejection_reason text,
    CONSTRAINT chk_assignment_status CHECK (((assignment_status)::text = ANY ((ARRAY['OFFERED'::character varying, 'ACCEPTED'::character varying, 'REJECTED'::character varying, 'EXPIRED'::character varying, 'UNASSIGNED'::character varying])::text[]))),
    CONSTRAINT chk_role_assigned CHECK (((role_assigned)::text = ANY ((ARRAY['PRIMARY_PARTNER'::character varying, 'DRIVER'::character varying, 'WORKER_HELPER'::character varying])::text[])))
);


ALTER TABLE public.booking_assignments OWNER TO postgres;

--
-- Name: booking_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.booking_assignments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.booking_assignments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: booking_inventory_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.booking_inventory_items (
    id bigint NOT NULL,
    booking_id bigint NOT NULL,
    inventory_item_id bigint NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    needs_packing boolean DEFAULT true NOT NULL,
    needs_dismantling boolean DEFAULT false NOT NULL,
    item_volume_cuft numeric(8,2) DEFAULT 0.00 NOT NULL,
    packing_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    CONSTRAINT chk_bii_quantity CHECK ((quantity > 0))
);


ALTER TABLE public.booking_inventory_items OWNER TO postgres;

--
-- Name: booking_inventory_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.booking_inventory_items ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.booking_inventory_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: booking_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.booking_items (
    id bigint NOT NULL,
    booking_id bigint NOT NULL,
    service_id bigint NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    total_price numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_booking_item_price CHECK (((unit_price >= (0)::numeric) AND (total_price >= (0)::numeric))),
    CONSTRAINT chk_booking_item_qty CHECK ((quantity > 0))
);


ALTER TABLE public.booking_items OWNER TO postgres;

--
-- Name: booking_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.booking_items ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.booking_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: booking_labor_details; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.booking_labor_details (
    id bigint NOT NULL,
    booking_id bigint NOT NULL,
    pickup_floor integer DEFAULT 0 NOT NULL,
    pickup_has_elevator boolean DEFAULT false NOT NULL,
    drop_floor integer DEFAULT 0 NOT NULL,
    drop_has_elevator boolean DEFAULT false NOT NULL,
    helpers_count_requested integer DEFAULT 0 NOT NULL,
    labor_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    floor_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    packing_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    CONSTRAINT chk_floors CHECK (((pickup_floor >= 0) AND (drop_floor >= 0))),
    CONSTRAINT chk_helpers_count CHECK ((helpers_count_requested >= 0))
);


ALTER TABLE public.booking_labor_details OWNER TO postgres;

--
-- Name: booking_labor_details_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.booking_labor_details ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.booking_labor_details_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: booking_status_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.booking_status_history (
    id bigint NOT NULL,
    booking_id bigint NOT NULL,
    from_status character varying(30),
    to_status character varying(30) NOT NULL,
    changed_by bigint,
    comment text,
    changed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.booking_status_history OWNER TO postgres;

--
-- Name: booking_status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.booking_status_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.booking_status_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bookings (
    id bigint NOT NULL,
    booking_number character varying(30) NOT NULL,
    customer_id bigint NOT NULL,
    service_category_id bigint NOT NULL,
    city_id bigint NOT NULL,
    booking_type character varying(30) NOT NULL,
    booking_status character varying(30) DEFAULT 'REQUESTED'::character varying NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    pickup_address_id bigint NOT NULL,
    drop_address_id bigint,
    vehicle_type_id bigint,
    coupon_id bigint,
    special_instructions text,
    estimated_duration_minutes integer,
    cancellation_reason text,
    cancelled_by bigint,
    cancelled_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_booking_status CHECK (((booking_status)::text = ANY ((ARRAY['REQUESTED'::character varying, 'SEARCHING_PARTNER'::character varying, 'ASSIGNED'::character varying, 'ACCEPTED'::character varying, 'PARTNER_ON_THE_WAY'::character varying, 'ARRIVED'::character varying, 'IN_PROGRESS'::character varying, 'COMPLETED'::character varying, 'CANCELLED'::character varying])::text[]))),
    CONSTRAINT chk_booking_type CHECK (((booking_type)::text = ANY ((ARRAY['HOME_SERVICE'::character varying, 'HOME_SHIFTING'::character varying, 'OFFICE_SHIFTING'::character varying, 'VEHICLE_RENTAL'::character varying])::text[])))
);


ALTER TABLE public.bookings OWNER TO postgres;

--
-- Name: bookings_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.bookings ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.bookings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cities (
    id bigint NOT NULL,
    country_code character varying(2) DEFAULT 'IN'::character varying NOT NULL,
    state_name character varying(100) NOT NULL,
    city_name character varying(150) NOT NULL,
    city_slug character varying(180) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.cities OWNER TO postgres;

--
-- Name: cities_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.cities ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.coupons (
    id bigint NOT NULL,
    coupon_code character varying(50) NOT NULL,
    description text,
    discount_type character varying(20) NOT NULL,
    discount_value numeric(10,2) NOT NULL,
    max_discount_amount numeric(10,2),
    min_booking_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
    usage_limit_total integer,
    usage_limit_per_user integer DEFAULT 1 NOT NULL,
    current_usage_count integer DEFAULT 0 NOT NULL,
    valid_from timestamp with time zone NOT NULL,
    valid_until timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_coupon_discount_type CHECK (((discount_type)::text = ANY ((ARRAY['PERCENTAGE'::character varying, 'FLAT'::character varying])::text[]))),
    CONSTRAINT chk_coupon_validity CHECK ((valid_until > valid_from)),
    CONSTRAINT chk_coupon_values CHECK (((discount_value > (0)::numeric) AND (min_booking_amount >= (0)::numeric)))
);


ALTER TABLE public.coupons OWNER TO postgres;

--
-- Name: coupons_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.coupons ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.coupons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: customer_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_profiles (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100),
    date_of_birth date,
    gender character varying(20),
    profile_image_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_customer_gender CHECK (((gender IS NULL) OR ((gender)::text = ANY ((ARRAY['MALE'::character varying, 'FEMALE'::character varying, 'OTHER'::character varying, 'PREFER_NOT_TO_SAY'::character varying])::text[]))))
);


ALTER TABLE public.customer_profiles OWNER TO postgres;

--
-- Name: customer_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.customer_profiles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.customer_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fare_breakdowns; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fare_breakdowns (
    id bigint NOT NULL,
    booking_id bigint NOT NULL,
    base_fare numeric(10,2) DEFAULT 0.00 NOT NULL,
    distance_fare numeric(10,2) DEFAULT 0.00 NOT NULL,
    items_fare numeric(10,2) DEFAULT 0.00 NOT NULL,
    inventory_volume_fare numeric(10,2) DEFAULT 0.00 NOT NULL,
    labor_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    floor_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    packing_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    waiting_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    surge_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    discount_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
    taxes_and_fees numeric(10,2) DEFAULT 0.00 NOT NULL,
    total_fare numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_total_fare CHECK ((total_fare >= (0)::numeric))
);


ALTER TABLE public.fare_breakdowns OWNER TO postgres;

--
-- Name: fare_breakdowns_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fare_breakdowns ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.fare_breakdowns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inventory_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_categories (
    id bigint NOT NULL,
    category_name character varying(100) NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.inventory_categories OWNER TO postgres;

--
-- Name: inventory_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.inventory_categories ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.inventory_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_items (
    id bigint NOT NULL,
    inventory_category_id bigint NOT NULL,
    item_name character varying(150) NOT NULL,
    estimated_volume_cuft numeric(8,2) DEFAULT 10.00 NOT NULL,
    estimated_weight_kg numeric(8,2),
    requires_dismantling boolean DEFAULT false NOT NULL,
    fragile boolean DEFAULT false NOT NULL,
    base_packing_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_inventory_volume CHECK ((estimated_volume_cuft >= (0)::numeric)),
    CONSTRAINT chk_packing_charge CHECK ((base_packing_charge >= (0)::numeric))
);


ALTER TABLE public.inventory_items OWNER TO postgres;

--
-- Name: inventory_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.inventory_items ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.inventory_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    booking_id bigint,
    title character varying(200) NOT NULL,
    message text NOT NULL,
    notification_type character varying(50) NOT NULL,
    channel character varying(20) DEFAULT 'IN_APP'::character varying NOT NULL,
    payload jsonb,
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_notification_channel CHECK (((channel)::text = ANY ((ARRAY['IN_APP'::character varying, 'PUSH'::character varying, 'SMS'::character varying, 'EMAIL'::character varying])::text[])))
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.notifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: otp_verifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.otp_verifications (
    id bigint NOT NULL,
    mobile_number character varying(15) NOT NULL,
    user_id bigint,
    otp_hash character varying(255) NOT NULL,
    purpose character varying(30) DEFAULT 'AUTHENTICATION'::character varying NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_otp_attempts CHECK (((attempts >= 0) AND (max_attempts > 0))),
    CONSTRAINT chk_otp_purpose CHECK (((purpose)::text = ANY ((ARRAY['AUTHENTICATION'::character varying, 'CHANGE_MOBILE'::character varying, 'PASSWORD_RESET'::character varying])::text[]))),
    CONSTRAINT chk_otp_status CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'VERIFIED'::character varying, 'EXPIRED'::character varying, 'LOCKED'::character varying])::text[])))
);


ALTER TABLE public.otp_verifications OWNER TO postgres;

--
-- Name: otp_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.otp_verifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.otp_verifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: partner_availability; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_availability (
    id bigint NOT NULL,
    partner_id bigint NOT NULL,
    is_online boolean DEFAULT false NOT NULL,
    is_busy boolean DEFAULT false NOT NULL,
    current_booking_id bigint,
    last_heartbeat_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.partner_availability OWNER TO postgres;

--
-- Name: partner_availability_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.partner_availability ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.partner_availability_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: partner_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_documents (
    id bigint NOT NULL,
    partner_id bigint NOT NULL,
    document_type character varying(50) NOT NULL,
    document_storage_key text NOT NULL,
    verification_status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    rejection_reason text,
    reviewed_by bigint,
    reviewed_at timestamp with time zone,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_document_status CHECK (((verification_status)::text = ANY ((ARRAY['PENDING'::character varying, 'VERIFIED'::character varying, 'REJECTED'::character varying])::text[]))),
    CONSTRAINT chk_document_type CHECK (((document_type)::text = ANY ((ARRAY['AADHAAR'::character varying, 'PAN'::character varying, 'DRIVING_LICENSE'::character varying, 'VEHICLE_RC'::character varying, 'BUSINESS_CERTIFICATE'::character varying, 'PROFILE_PHOTO'::character varying, 'OTHER'::character varying])::text[])))
);


ALTER TABLE public.partner_documents OWNER TO postgres;

--
-- Name: partner_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.partner_documents ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.partner_documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: partner_live_locations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_live_locations (
    id bigint NOT NULL,
    partner_id bigint NOT NULL,
    latitude numeric(10,7) NOT NULL,
    longitude numeric(10,7) NOT NULL,
    heading numeric(5,2),
    speed_kph numeric(5,2),
    accuracy_meters numeric(6,2),
    battery_percentage integer,
    recorded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_battery CHECK (((battery_percentage IS NULL) OR ((battery_percentage >= 0) AND (battery_percentage <= 100)))),
    CONSTRAINT chk_live_latitude CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric))),
    CONSTRAINT chk_live_longitude CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric)))
);


ALTER TABLE public.partner_live_locations OWNER TO postgres;

--
-- Name: partner_live_locations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.partner_live_locations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.partner_live_locations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: partner_location_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_location_history (
    id bigint NOT NULL,
    partner_id bigint NOT NULL,
    booking_id bigint,
    latitude numeric(10,7) NOT NULL,
    longitude numeric(10,7) NOT NULL,
    heading numeric(5,2),
    speed_kph numeric(5,2),
    recorded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_hist_latitude CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric))),
    CONSTRAINT chk_hist_longitude CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric)))
);


ALTER TABLE public.partner_location_history OWNER TO postgres;

--
-- Name: partner_location_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.partner_location_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.partner_location_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: partner_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_profiles (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    profile_type character varying(20) DEFAULT 'INDIVIDUAL'::character varying NOT NULL,
    legal_name character varying(200) NOT NULL,
    business_name character varying(200),
    business_description text,
    experience_years integer DEFAULT 0 NOT NULL,
    approval_status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    rejection_reason text,
    reviewed_by bigint,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_partner_approval CHECK (((approval_status)::text = ANY ((ARRAY['PENDING'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying, 'SUSPENDED'::character varying])::text[]))),
    CONSTRAINT chk_partner_experience CHECK ((experience_years >= 0)),
    CONSTRAINT chk_partner_type CHECK (((profile_type)::text = ANY ((ARRAY['INDIVIDUAL'::character varying, 'BUSINESS'::character varying])::text[])))
);


ALTER TABLE public.partner_profiles OWNER TO postgres;

--
-- Name: partner_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.partner_profiles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.partner_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: partner_service_areas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_service_areas (
    id bigint NOT NULL,
    partner_id bigint NOT NULL,
    city_id bigint NOT NULL,
    area_id bigint,
    coverage_type character varying(10) NOT NULL,
    service_radius_km numeric(8,2),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_coverage_type CHECK (((((coverage_type)::text = 'CITY'::text) AND (area_id IS NULL)) OR (((coverage_type)::text = 'AREA'::text) AND (area_id IS NOT NULL)))),
    CONSTRAINT chk_service_radius CHECK (((service_radius_km IS NULL) OR (service_radius_km > (0)::numeric)))
);


ALTER TABLE public.partner_service_areas OWNER TO postgres;

--
-- Name: partner_service_areas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.partner_service_areas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.partner_service_areas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: partner_skills; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_skills (
    id bigint NOT NULL,
    partner_id bigint NOT NULL,
    service_category_id bigint NOT NULL,
    experience_years integer DEFAULT 0 NOT NULL,
    verification_status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_skill_experience CHECK ((experience_years >= 0)),
    CONSTRAINT chk_skill_verification CHECK (((verification_status)::text = ANY ((ARRAY['PENDING'::character varying, 'VERIFIED'::character varying, 'REJECTED'::character varying])::text[])))
);


ALTER TABLE public.partner_skills OWNER TO postgres;

--
-- Name: partner_skills_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.partner_skills ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.partner_skills_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: partner_vehicles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_vehicles (
    id bigint NOT NULL,
    partner_id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    is_primary boolean DEFAULT true NOT NULL,
    assigned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.partner_vehicles OWNER TO postgres;

--
-- Name: partner_vehicles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.partner_vehicles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.partner_vehicles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: partner_wallets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_wallets (
    id bigint NOT NULL,
    partner_id bigint NOT NULL,
    available_balance numeric(12,2) DEFAULT 0.00 NOT NULL,
    locked_balance numeric(12,2) DEFAULT 0.00 NOT NULL,
    total_earned numeric(12,2) DEFAULT 0.00 NOT NULL,
    total_withdrawn numeric(12,2) DEFAULT 0.00 NOT NULL,
    currency character varying(10) DEFAULT 'INR'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_wallet_balances CHECK (((available_balance >= (0)::numeric) AND (locked_balance >= (0)::numeric)))
);


ALTER TABLE public.partner_wallets OWNER TO postgres;

--
-- Name: partner_wallets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.partner_wallets ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.partner_wallets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    id bigint NOT NULL,
    booking_id bigint NOT NULL,
    payment_method character varying(30) NOT NULL,
    payment_status character varying(30) DEFAULT 'PENDING'::character varying NOT NULL,
    amount numeric(10,2) NOT NULL,
    currency character varying(10) DEFAULT 'INR'::character varying NOT NULL,
    gateway_name character varying(50),
    gateway_order_id character varying(100),
    gateway_payment_id character varying(100),
    gateway_signature character varying(255),
    idempotency_key character varying(100),
    error_message text,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_payment_amount CHECK ((amount >= (0)::numeric)),
    CONSTRAINT chk_payment_method CHECK (((payment_method)::text = ANY ((ARRAY['ONLINE_RAZORPAY'::character varying, 'CASH_ON_DELIVERY'::character varying, 'WALLET'::character varying, 'UPI'::character varying])::text[]))),
    CONSTRAINT chk_payment_status CHECK (((payment_status)::text = ANY ((ARRAY['PENDING'::character varying, 'AUTHORIZED'::character varying, 'CAPTURED'::character varying, 'FAILED'::character varying, 'REFUNDED'::character varying, 'PARTIALLY_REFUNDED'::character varying])::text[])))
);


ALTER TABLE public.payments OWNER TO postgres;

--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.payments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pricing_rules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pricing_rules (
    id bigint NOT NULL,
    city_id bigint NOT NULL,
    service_category_id bigint NOT NULL,
    vehicle_type_id bigint,
    base_fare numeric(10,2) DEFAULT 0.00 NOT NULL,
    base_distance_km numeric(8,2) DEFAULT 0.00 NOT NULL,
    per_km_rate numeric(10,2) DEFAULT 0.00 NOT NULL,
    per_minute_waiting_rate numeric(10,2) DEFAULT 0.00 NOT NULL,
    helper_charge_per_person numeric(10,2) DEFAULT 0.00 NOT NULL,
    floor_charge_without_elevator numeric(10,2) DEFAULT 0.00 NOT NULL,
    volume_rate_per_cuft numeric(10,2) DEFAULT 0.00 NOT NULL,
    surge_multiplier numeric(4,2) DEFAULT 1.00 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_pricing_values CHECK (((base_fare >= (0)::numeric) AND (base_distance_km >= (0)::numeric) AND (per_km_rate >= (0)::numeric) AND (helper_charge_per_person >= (0)::numeric) AND (floor_charge_without_elevator >= (0)::numeric) AND (volume_rate_per_cuft >= (0)::numeric) AND (surge_multiplier >= 1.00)))
);


ALTER TABLE public.pricing_rules OWNER TO postgres;

--
-- Name: pricing_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.pricing_rules ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pricing_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.refunds (
    id bigint NOT NULL,
    payment_id bigint NOT NULL,
    booking_id bigint NOT NULL,
    refund_amount numeric(10,2) NOT NULL,
    currency character varying(10) DEFAULT 'INR'::character varying NOT NULL,
    gateway_refund_id character varying(100),
    refund_reason text NOT NULL,
    refund_status character varying(30) DEFAULT 'PENDING'::character varying NOT NULL,
    processed_by bigint,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_refund_amount CHECK ((refund_amount > (0)::numeric)),
    CONSTRAINT chk_refund_status CHECK (((refund_status)::text = ANY ((ARRAY['PENDING'::character varying, 'PROCESSED'::character varying, 'FAILED'::character varying])::text[])))
);


ALTER TABLE public.refunds OWNER TO postgres;

--
-- Name: refunds_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.refunds ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.refunds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reviews_ratings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reviews_ratings (
    id bigint NOT NULL,
    booking_id bigint NOT NULL,
    reviewer_user_id bigint NOT NULL,
    reviewee_user_id bigint NOT NULL,
    rating integer NOT NULL,
    review_title character varying(150),
    comment text,
    tags text[],
    is_public boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_review_rating CHECK (((rating >= 1) AND (rating <= 5)))
);


ALTER TABLE public.reviews_ratings OWNER TO postgres;

--
-- Name: reviews_ratings_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.reviews_ratings ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.reviews_ratings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roles (
    id bigint NOT NULL,
    role_name character varying(50) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.roles OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.roles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schema_migrations (
    id bigint NOT NULL,
    migration_name character varying(100) NOT NULL,
    executed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    execution_time_ms integer DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'SUCCESS'::character varying NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO postgres;

--
-- Name: schema_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.schema_migrations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.schema_migrations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: service_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.service_categories (
    id bigint NOT NULL,
    parent_category_id bigint,
    category_code character varying(80) NOT NULL,
    category_name character varying(150) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.service_categories OWNER TO postgres;

--
-- Name: service_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.service_categories ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.service_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: service_rate_cards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.service_rate_cards (
    id bigint NOT NULL,
    service_id bigint NOT NULL,
    city_id bigint NOT NULL,
    visiting_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    base_service_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    hourly_charge numeric(10,2),
    minimum_charge numeric(10,2) DEFAULT 0.00 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_rate_card_charges CHECK (((visiting_charge >= (0)::numeric) AND (base_service_charge >= (0)::numeric) AND (minimum_charge >= (0)::numeric) AND ((hourly_charge IS NULL) OR (hourly_charge >= (0)::numeric))))
);


ALTER TABLE public.service_rate_cards OWNER TO postgres;

--
-- Name: service_rate_cards_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.service_rate_cards ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.service_rate_cards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.services (
    id bigint NOT NULL,
    service_category_id bigint NOT NULL,
    service_code character varying(50) NOT NULL,
    service_name character varying(150) NOT NULL,
    description text,
    duration_minutes integer DEFAULT 60 NOT NULL,
    icon_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_service_duration CHECK ((duration_minutes > 0))
);


ALTER TABLE public.services OWNER TO postgres;

--
-- Name: services_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.services ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.services_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_addresses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_addresses (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    city_id bigint NOT NULL,
    area_id bigint,
    address_type character varying(20) DEFAULT 'HOME'::character varying NOT NULL,
    address_line1 text NOT NULL,
    address_line2 text,
    landmark character varying(255),
    postal_code character varying(20) NOT NULL,
    latitude numeric(10,7) NOT NULL,
    longitude numeric(10,7) NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_address_latitude CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric))),
    CONSTRAINT chk_address_longitude CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))),
    CONSTRAINT chk_address_type CHECK (((address_type)::text = ANY ((ARRAY['HOME'::character varying, 'WORK'::character varying, 'OTHER'::character varying])::text[])))
);


ALTER TABLE public.user_addresses OWNER TO postgres;

--
-- Name: user_addresses_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.user_addresses ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_addresses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_roles (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    role_id bigint NOT NULL,
    assigned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.user_roles OWNER TO postgres;

--
-- Name: user_roles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.user_roles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_sessions (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    refresh_token_hash character varying(255) NOT NULL,
    device_id character varying(255),
    device_name character varying(255),
    ip_address inet,
    user_agent text,
    expires_at timestamp with time zone NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.user_sessions OWNER TO postgres;

--
-- Name: user_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.user_sessions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    mobile_number character varying(15) NOT NULL,
    email character varying(255),
    account_status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    is_mobile_verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_account_status CHECK (((account_status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'BLOCKED'::character varying, 'DELETED'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: vehicle_types; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicle_types (
    id bigint NOT NULL,
    type_code character varying(50) NOT NULL,
    type_name character varying(100) NOT NULL,
    service_category_id bigint NOT NULL,
    capacity_kg numeric(10,2) NOT NULL,
    volume_cuft numeric(10,2),
    base_fare numeric(10,2) DEFAULT 0.00 NOT NULL,
    per_km_rate numeric(10,2) DEFAULT 0.00 NOT NULL,
    per_minute_rate numeric(10,2) DEFAULT 0.00 NOT NULL,
    icon_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_vehicle_capacity CHECK ((capacity_kg > (0)::numeric)),
    CONSTRAINT chk_vehicle_rates CHECK (((base_fare >= (0)::numeric) AND (per_km_rate >= (0)::numeric) AND (per_minute_rate >= (0)::numeric)))
);


ALTER TABLE public.vehicle_types OWNER TO postgres;

--
-- Name: vehicle_types_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.vehicle_types ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.vehicle_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicles (
    id bigint NOT NULL,
    vehicle_type_id bigint NOT NULL,
    registration_number character varying(50) NOT NULL,
    make character varying(100),
    model character varying(100),
    manufacturing_year integer,
    rc_number character varying(100),
    fitness_valid_until date,
    insurance_valid_until date,
    pollution_valid_until date,
    verification_status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    rejection_reason text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_vehicle_verification CHECK (((verification_status)::text = ANY ((ARRAY['PENDING'::character varying, 'VERIFIED'::character varying, 'REJECTED'::character varying, 'SUSPENDED'::character varying])::text[])))
);


ALTER TABLE public.vehicles OWNER TO postgres;

--
-- Name: vehicles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.vehicles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.vehicles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wallet_transactions (
    id bigint NOT NULL,
    wallet_id bigint NOT NULL,
    booking_id bigint,
    transaction_type character varying(30) NOT NULL,
    amount numeric(10,2) NOT NULL,
    opening_balance numeric(12,2) NOT NULL,
    closing_balance numeric(12,2) NOT NULL,
    reference_id character varying(100),
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_tx_amount CHECK ((amount > (0)::numeric)),
    CONSTRAINT chk_tx_type CHECK (((transaction_type)::text = ANY ((ARRAY['CREDIT_BOOKING_EARNING'::character varying, 'CREDIT_TIP'::character varying, 'CREDIT_INCENTIVE'::character varying, 'DEBIT_COMMISSION'::character varying, 'DEBIT_PENALTY'::character varying, 'DEBIT_WITHDRAWAL'::character varying, 'DEBIT_REFUND_REVERSAL'::character varying])::text[])))
);


ALTER TABLE public.wallet_transactions OWNER TO postgres;

--
-- Name: wallet_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.wallet_transactions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.wallet_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Data for Name: areas; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.areas (id, city_id, area_name, postal_code, latitude, longitude, is_active, created_at, updated_at) FROM stdin;
1	1	Andheri West	400058	19.1363000	72.8277000	t	2026-11-04 12:11:49.562+05:30	2026-11-04 12:11:49.562+05:30
2	1	Bandra West	400050	19.0596000	72.8295000	t	2026-11-04 12:11:49.562+05:30	2026-11-04 12:11:49.562+05:30
3	1	Powai	400076	19.1176000	72.9060000	t	2026-11-04 12:11:49.562+05:30	2026-11-04 12:11:49.562+05:30
4	2	Koramangala	560034	12.9352000	77.6245000	t	2026-11-04 12:11:49.588+05:30	2026-11-04 12:11:49.588+05:30
5	2	Indiranagar	560038	12.9784000	77.6408000	t	2026-11-04 12:11:49.588+05:30	2026-11-04 12:11:49.588+05:30
6	2	Whitefield	560066	12.9698000	77.7500000	t	2026-11-04 12:11:49.588+05:30	2026-11-04 12:11:49.588+05:30
7	3	Connaught Place	110001	28.6315000	77.2167000	t	2026-11-04 12:11:49.59+05:30	2026-11-04 12:11:49.59+05:30
8	3	Hauz Khas	110016	28.5494000	77.2001000	t	2026-11-04 12:11:49.59+05:30	2026-11-04 12:11:49.59+05:30
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.audit_logs (id, actor_user_id, action, entity_name, entity_id, old_values, new_values, ip_address, user_agent, created_at) FROM stdin;
\.


--
-- Data for Name: booking_assignments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.booking_assignments (id, booking_id, partner_id, role_assigned, assignment_status, assigned_at, responded_at, rejection_reason) FROM stdin;
\.


--
-- Data for Name: booking_inventory_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.booking_inventory_items (id, booking_id, inventory_item_id, quantity, needs_packing, needs_dismantling, item_volume_cuft, packing_charge) FROM stdin;
\.


--
-- Data for Name: booking_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.booking_items (id, booking_id, service_id, quantity, unit_price, total_price, created_at) FROM stdin;
\.


--
-- Data for Name: booking_labor_details; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.booking_labor_details (id, booking_id, pickup_floor, pickup_has_elevator, drop_floor, drop_has_elevator, helpers_count_requested, labor_charge, floor_charge, packing_charge) FROM stdin;
\.


--
-- Data for Name: booking_status_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.booking_status_history (id, booking_id, from_status, to_status, changed_by, comment, changed_at) FROM stdin;
\.


--
-- Data for Name: bookings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bookings (id, booking_number, customer_id, service_category_id, city_id, booking_type, booking_status, scheduled_at, pickup_address_id, drop_address_id, vehicle_type_id, coupon_id, special_instructions, estimated_duration_minutes, cancellation_reason, cancelled_by, cancelled_at, completed_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: cities; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cities (id, country_code, state_name, city_name, city_slug, is_active, created_at, updated_at) FROM stdin;
1	IN	Maharashtra	Mumbai	mumbai	t	2026-11-04 12:11:49.562+05:30	2026-11-04 12:11:49.562+05:30
2	IN	Karnataka	Bengaluru	bengaluru	t	2026-11-04 12:11:49.588+05:30	2026-11-04 12:11:49.588+05:30
3	IN	Delhi	New Delhi	new-delhi	t	2026-11-04 12:11:49.59+05:30	2026-11-04 12:11:49.59+05:30
\.


--
-- Data for Name: coupons; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.coupons (id, coupon_code, description, discount_type, discount_value, max_discount_amount, min_booking_amount, usage_limit_total, usage_limit_per_user, current_usage_count, valid_from, valid_until, is_active, created_at) FROM stdin;
\.


--
-- Data for Name: customer_profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_profiles (id, user_id, first_name, last_name, date_of_birth, gender, profile_image_url, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: fare_breakdowns; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.fare_breakdowns (id, booking_id, base_fare, distance_fare, items_fare, inventory_volume_fare, labor_charge, floor_charge, packing_charge, waiting_charge, surge_charge, discount_amount, taxes_and_fees, total_fare, created_at) FROM stdin;
\.


--
-- Data for Name: inventory_categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_categories (id, category_name, display_order, is_active, created_at) FROM stdin;
\.


--
-- Data for Name: inventory_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_items (id, inventory_category_id, item_name, estimated_volume_cuft, estimated_weight_kg, requires_dismantling, fragile, base_packing_charge, is_active, created_at) FROM stdin;
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.notifications (id, user_id, booking_id, title, message, notification_type, channel, payload, is_read, read_at, created_at) FROM stdin;
\.


--
-- Data for Name: otp_verifications; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.otp_verifications (id, mobile_number, user_id, otp_hash, purpose, status, attempts, max_attempts, expires_at, verified_at, created_at) FROM stdin;
\.


--
-- Data for Name: partner_availability; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_availability (id, partner_id, is_online, is_busy, current_booking_id, last_heartbeat_at, updated_at) FROM stdin;
\.


--
-- Data for Name: partner_documents; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_documents (id, partner_id, document_type, document_storage_key, verification_status, rejection_reason, reviewed_by, reviewed_at, uploaded_at) FROM stdin;
\.


--
-- Data for Name: partner_live_locations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_live_locations (id, partner_id, latitude, longitude, heading, speed_kph, accuracy_meters, battery_percentage, recorded_at, updated_at) FROM stdin;
\.


--
-- Data for Name: partner_location_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_location_history (id, partner_id, booking_id, latitude, longitude, heading, speed_kph, recorded_at) FROM stdin;
\.


--
-- Data for Name: partner_profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_profiles (id, user_id, profile_type, legal_name, business_name, business_description, experience_years, approval_status, rejection_reason, reviewed_by, reviewed_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: partner_service_areas; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_service_areas (id, partner_id, city_id, area_id, coverage_type, service_radius_km, is_active, created_at) FROM stdin;
\.


--
-- Data for Name: partner_skills; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_skills (id, partner_id, service_category_id, experience_years, verification_status, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: partner_vehicles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_vehicles (id, partner_id, vehicle_id, is_primary, assigned_at) FROM stdin;
\.


--
-- Data for Name: partner_wallets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_wallets (id, partner_id, available_balance, locked_balance, total_earned, total_withdrawn, currency, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payments (id, booking_id, payment_method, payment_status, amount, currency, gateway_name, gateway_order_id, gateway_payment_id, gateway_signature, idempotency_key, error_message, paid_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: pricing_rules; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.pricing_rules (id, city_id, service_category_id, vehicle_type_id, base_fare, base_distance_km, per_km_rate, per_minute_waiting_rate, helper_charge_per_person, floor_charge_without_elevator, volume_rate_per_cuft, surge_multiplier, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: refunds; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.refunds (id, payment_id, booking_id, refund_amount, currency, gateway_refund_id, refund_reason, refund_status, processed_by, processed_at, created_at) FROM stdin;
\.


--
-- Data for Name: reviews_ratings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.reviews_ratings (id, booking_id, reviewer_user_id, reviewee_user_id, rating, review_title, comment, tags, is_public, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.roles (id, role_name, description, created_at) FROM stdin;
1	CUSTOMER	User who books services	2026-11-03 18:31:34.842458+05:30
2	PARTNER	User who provides professional services	2026-11-03 18:31:34.842458+05:30
3	DRIVER	User who drives vehicles	2026-11-03 18:31:34.842458+05:30
4	WORKER	User who performs loading and unloading	2026-11-03 18:31:34.842458+05:30
5	ADMIN	Platform administrator	2026-11-03 18:31:34.842458+05:30
6	SUPER_ADMIN	Platform super administrator	2026-11-03 18:31:34.842458+05:30
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.schema_migrations (id, migration_name, executed_at, execution_time_ms, status) FROM stdin;
1	001_baseline_existing_schema.sql	2026-11-04 10:09:21.504805+05:30	0	SUCCESS
2	002_user_addresses.sql	2026-11-04 10:09:21.960888+05:30	142	SUCCESS
3	003_vehicle_fleet.sql	2026-11-04 10:09:22.513038+05:30	141	SUCCESS
4	004_shifting_inventory_labor.sql	2026-11-04 10:09:23.267741+05:30	132	SUCCESS
5	005_services_rate_cards.sql	2026-11-04 10:09:23.904817+05:30	139	SUCCESS
6	006_pricing_rules_coupons.sql	2026-11-04 10:09:24.477369+05:30	123	SUCCESS
7	007_bookings_assignments.sql	2026-11-04 10:09:25.122049+05:30	175	SUCCESS
8	008_payments_wallets.sql	2026-11-04 10:09:26.259037+05:30	152	SUCCESS
9	009_tracking_availability.sql	2026-11-04 10:09:27.055375+05:30	138	SUCCESS
10	010_reviews_ratings.sql	2026-11-04 10:09:27.900085+05:30	250	SUCCESS
11	011_notifications_audit_logs.sql	2026-11-04 10:09:28.520426+05:30	131	SUCCESS
\.


--
-- Data for Name: service_categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.service_categories (id, parent_category_id, category_code, category_name, description, is_active, created_at, updated_at) FROM stdin;
1	\N	HOME_SERVICES	Home Services	Home repair and maintenance services	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
2	\N	SHIFTING	Home and Office Shifting	Moving and relocation services	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
3	\N	VEHICLE_SERVICES	Vehicle Services	Vehicle and driver-related services	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
4	1	MOTOR_MECHANIC	Motor Mechanic	Vehicle mechanical repair	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
5	1	AC_REPAIR	AC Repair	Air conditioner repair and maintenance	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
6	1	CARPENTER	Carpenter	Furniture and woodwork	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
7	1	PLUMBER	Plumber	Plumbing and pipe repair	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
8	1	ELECTRICIAN	Electrician	Electrical repair and installation	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
9	2	OFFICE_RELOCATION	Office Relocation	Office shifting	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
10	2	HOME_RELOCATION	Home Relocation	Residential shifting	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
11	2	LOADING_UNLOADING	Loading and Unloading	Loading and unloading workers	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
12	2	PACKING	Packing	Packing and unpacking services	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
13	3	VEHICLE_OWNER	Vehicle Owner	Vehicle rental and transport	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
14	3	DRIVER	Driver	Professional driving services	t	2026-11-03 18:40:39.038536+05:30	2026-11-03 18:40:39.038536+05:30
\.


--
-- Data for Name: service_rate_cards; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.service_rate_cards (id, service_id, city_id, visiting_charge, base_service_charge, hourly_charge, minimum_charge, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: services; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.services (id, service_category_id, service_code, service_name, description, duration_minutes, icon_url, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_addresses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_addresses (id, user_id, city_id, area_id, address_type, address_line1, address_line2, landmark, postal_code, latitude, longitude, is_default, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_roles (id, user_id, role_id, assigned_at) FROM stdin;
\.


--
-- Data for Name: user_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_sessions (id, user_id, refresh_token_hash, device_id, device_name, ip_address, user_agent, expires_at, last_used_at, revoked_at, created_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, mobile_number, email, account_status, is_mobile_verified, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: vehicle_types; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicle_types (id, type_code, type_name, service_category_id, capacity_kg, volume_cuft, base_fare, per_km_rate, per_minute_rate, icon_url, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: vehicles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicles (id, vehicle_type_id, registration_number, make, model, manufacturing_year, rc_number, fitness_valid_until, insurance_valid_until, pollution_valid_until, verification_status, rejection_reason, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: wallet_transactions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.wallet_transactions (id, wallet_id, booking_id, transaction_type, amount, opening_balance, closing_balance, reference_id, description, created_at) FROM stdin;
\.


--
-- Name: areas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.areas_id_seq', 8, true);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.audit_logs_id_seq', 108, true);


--
-- Name: booking_assignments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.booking_assignments_id_seq', 1, false);


--
-- Name: booking_inventory_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.booking_inventory_items_id_seq', 1, false);


--
-- Name: booking_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.booking_items_id_seq', 1, false);


--
-- Name: booking_labor_details_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.booking_labor_details_id_seq', 1, false);


--
-- Name: booking_status_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.booking_status_history_id_seq', 1, false);


--
-- Name: bookings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bookings_id_seq', 1, false);


--
-- Name: cities_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cities_id_seq', 3, true);


--
-- Name: coupons_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.coupons_id_seq', 1, false);


--
-- Name: customer_profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customer_profiles_id_seq', 78, true);


--
-- Name: fare_breakdowns_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.fare_breakdowns_id_seq', 1, false);


--
-- Name: inventory_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.inventory_categories_id_seq', 1, false);


--
-- Name: inventory_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.inventory_items_id_seq', 1, false);


--
-- Name: notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.notifications_id_seq', 1, false);


--
-- Name: otp_verifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.otp_verifications_id_seq', 123, true);


--
-- Name: partner_availability_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_availability_id_seq', 1, false);


--
-- Name: partner_documents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_documents_id_seq', 45, true);


--
-- Name: partner_live_locations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_live_locations_id_seq', 1, false);


--
-- Name: partner_location_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_location_history_id_seq', 1, false);


--
-- Name: partner_profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_profiles_id_seq', 45, true);


--
-- Name: partner_service_areas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_service_areas_id_seq', 8, true);


--
-- Name: partner_skills_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_skills_id_seq', 9, true);


--
-- Name: partner_vehicles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_vehicles_id_seq', 1, false);


--
-- Name: partner_wallets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_wallets_id_seq', 1, false);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payments_id_seq', 1, false);


--
-- Name: pricing_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.pricing_rules_id_seq', 1, false);


--
-- Name: refunds_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.refunds_id_seq', 1, false);


--
-- Name: reviews_ratings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.reviews_ratings_id_seq', 1, false);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.roles_id_seq', 6, true);


--
-- Name: schema_migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.schema_migrations_id_seq', 11, true);


--
-- Name: service_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.service_categories_id_seq', 14, true);


--
-- Name: service_rate_cards_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.service_rate_cards_id_seq', 1, false);


--
-- Name: services_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.services_id_seq', 1, false);


--
-- Name: user_addresses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_addresses_id_seq', 20, true);


--
-- Name: user_roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_roles_id_seq', 266, true);


--
-- Name: user_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_sessions_id_seq', 270, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 175, true);


--
-- Name: vehicle_types_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vehicle_types_id_seq', 1, false);


--
-- Name: vehicles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vehicles_id_seq', 1, false);


--
-- Name: wallet_transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.wallet_transactions_id_seq', 1, false);


--
-- Name: areas areas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: booking_assignments booking_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_assignments
    ADD CONSTRAINT booking_assignments_pkey PRIMARY KEY (id);


--
-- Name: booking_inventory_items booking_inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_inventory_items
    ADD CONSTRAINT booking_inventory_items_pkey PRIMARY KEY (id);


--
-- Name: booking_items booking_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_items
    ADD CONSTRAINT booking_items_pkey PRIMARY KEY (id);


--
-- Name: booking_labor_details booking_labor_details_booking_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_labor_details
    ADD CONSTRAINT booking_labor_details_booking_id_key UNIQUE (booking_id);


--
-- Name: booking_labor_details booking_labor_details_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_labor_details
    ADD CONSTRAINT booking_labor_details_pkey PRIMARY KEY (id);


--
-- Name: booking_status_history booking_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT booking_status_history_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_booking_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_booking_number_key UNIQUE (booking_number);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: cities cities_city_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_city_slug_key UNIQUE (city_slug);


--
-- Name: cities cities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_coupon_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_coupon_code_key UNIQUE (coupon_code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: customer_profiles customer_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_pkey PRIMARY KEY (id);


--
-- Name: customer_profiles customer_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_user_id_key UNIQUE (user_id);


--
-- Name: fare_breakdowns fare_breakdowns_booking_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fare_breakdowns
    ADD CONSTRAINT fare_breakdowns_booking_id_key UNIQUE (booking_id);


--
-- Name: fare_breakdowns fare_breakdowns_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fare_breakdowns
    ADD CONSTRAINT fare_breakdowns_pkey PRIMARY KEY (id);


--
-- Name: inventory_categories inventory_categories_category_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_categories
    ADD CONSTRAINT inventory_categories_category_name_key UNIQUE (category_name);


--
-- Name: inventory_categories inventory_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_categories
    ADD CONSTRAINT inventory_categories_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: otp_verifications otp_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.otp_verifications
    ADD CONSTRAINT otp_verifications_pkey PRIMARY KEY (id);


--
-- Name: partner_availability partner_availability_partner_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_availability
    ADD CONSTRAINT partner_availability_partner_id_key UNIQUE (partner_id);


--
-- Name: partner_availability partner_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_availability
    ADD CONSTRAINT partner_availability_pkey PRIMARY KEY (id);


--
-- Name: partner_documents partner_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_documents
    ADD CONSTRAINT partner_documents_pkey PRIMARY KEY (id);


--
-- Name: partner_live_locations partner_live_locations_partner_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_live_locations
    ADD CONSTRAINT partner_live_locations_partner_id_key UNIQUE (partner_id);


--
-- Name: partner_live_locations partner_live_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_live_locations
    ADD CONSTRAINT partner_live_locations_pkey PRIMARY KEY (id);


--
-- Name: partner_location_history partner_location_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_location_history
    ADD CONSTRAINT partner_location_history_pkey PRIMARY KEY (id);


--
-- Name: partner_profiles partner_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_profiles
    ADD CONSTRAINT partner_profiles_pkey PRIMARY KEY (id);


--
-- Name: partner_profiles partner_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_profiles
    ADD CONSTRAINT partner_profiles_user_id_key UNIQUE (user_id);


--
-- Name: partner_service_areas partner_service_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_service_areas
    ADD CONSTRAINT partner_service_areas_pkey PRIMARY KEY (id);


--
-- Name: partner_skills partner_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_skills
    ADD CONSTRAINT partner_skills_pkey PRIMARY KEY (id);


--
-- Name: partner_vehicles partner_vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_vehicles
    ADD CONSTRAINT partner_vehicles_pkey PRIMARY KEY (id);


--
-- Name: partner_wallets partner_wallets_partner_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_wallets
    ADD CONSTRAINT partner_wallets_partner_id_key UNIQUE (partner_id);


--
-- Name: partner_wallets partner_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_wallets
    ADD CONSTRAINT partner_wallets_pkey PRIMARY KEY (id);


--
-- Name: payments payments_gateway_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_gateway_payment_id_key UNIQUE (gateway_payment_id);


--
-- Name: payments payments_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: pricing_rules pricing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT pricing_rules_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_gateway_refund_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_gateway_refund_id_key UNIQUE (gateway_refund_id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: reviews_ratings reviews_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews_ratings
    ADD CONSTRAINT reviews_ratings_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_role_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_role_name_key UNIQUE (role_name);


--
-- Name: schema_migrations schema_migrations_migration_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_migration_name_key UNIQUE (migration_name);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);


--
-- Name: service_categories service_categories_category_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_category_code_key UNIQUE (category_code);


--
-- Name: service_categories service_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);


--
-- Name: service_rate_cards service_rate_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_rate_cards
    ADD CONSTRAINT service_rate_cards_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: services services_service_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_service_code_key UNIQUE (service_code);


--
-- Name: areas uq_area_city_id; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT uq_area_city_id UNIQUE (city_id, id);


--
-- Name: booking_assignments uq_booking_partner_assignment; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_assignments
    ADD CONSTRAINT uq_booking_partner_assignment UNIQUE (booking_id, partner_id);


--
-- Name: reviews_ratings uq_booking_reviewer; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews_ratings
    ADD CONSTRAINT uq_booking_reviewer UNIQUE (booking_id, reviewer_user_id);


--
-- Name: areas uq_city_area; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT uq_city_area UNIQUE (city_id, area_name);


--
-- Name: cities uq_city_location; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT uq_city_location UNIQUE (country_code, state_name, city_name);


--
-- Name: partner_skills uq_partner_skill; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_skills
    ADD CONSTRAINT uq_partner_skill UNIQUE (partner_id, service_category_id);


--
-- Name: partner_vehicles uq_partner_vehicle; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_vehicles
    ADD CONSTRAINT uq_partner_vehicle UNIQUE (partner_id, vehicle_id);


--
-- Name: service_rate_cards uq_service_city_rate; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_rate_cards
    ADD CONSTRAINT uq_service_city_rate UNIQUE (service_id, city_id);


--
-- Name: user_roles uq_user_role; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT uq_user_role UNIQUE (user_id, role_id);


--
-- Name: user_addresses user_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT user_addresses_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_refresh_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_refresh_token_hash_key UNIQUE (refresh_token_hash);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_mobile_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_mobile_number_key UNIQUE (mobile_number);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vehicle_types vehicle_types_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_types
    ADD CONSTRAINT vehicle_types_pkey PRIMARY KEY (id);


--
-- Name: vehicle_types vehicle_types_type_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_types
    ADD CONSTRAINT vehicle_types_type_code_key UNIQUE (type_code);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_registration_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_registration_number_key UNIQUE (registration_number);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: idx_areas_city; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_areas_city ON public.areas USING btree (city_id);


--
-- Name: idx_assignment_partner_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_assignment_partner_status ON public.booking_assignments USING btree (partner_id, assignment_status);


--
-- Name: idx_audit_logs_actor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_logs_actor ON public.audit_logs USING btree (actor_user_id);


--
-- Name: idx_audit_logs_entity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_logs_entity ON public.audit_logs USING btree (entity_name, entity_id);


--
-- Name: idx_booking_items_booking; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_booking_items_booking ON public.booking_items USING btree (booking_id);


--
-- Name: idx_bookings_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bookings_customer ON public.bookings USING btree (customer_id);


--
-- Name: idx_bookings_scheduled; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bookings_scheduled ON public.bookings USING btree (scheduled_at);


--
-- Name: idx_bookings_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bookings_status ON public.bookings USING btree (booking_status);


--
-- Name: idx_coupons_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_coupons_code ON public.coupons USING btree (coupon_code) WHERE (is_active = true);


--
-- Name: idx_inventory_items_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_items_category ON public.inventory_items USING btree (inventory_category_id);


--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, is_read, created_at DESC);


--
-- Name: idx_otp_expiry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_otp_expiry ON public.otp_verifications USING btree (expires_at) WHERE ((status)::text = 'PENDING'::text);


--
-- Name: idx_otp_mobile_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_otp_mobile_created ON public.otp_verifications USING btree (mobile_number, created_at DESC);


--
-- Name: idx_partner_approval; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_approval ON public.partner_profiles USING btree (approval_status);


--
-- Name: idx_partner_availability_online; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_availability_online ON public.partner_availability USING btree (is_online, is_busy);


--
-- Name: idx_partner_document_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_document_status ON public.partner_documents USING btree (verification_status);


--
-- Name: idx_partner_documents; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_documents ON public.partner_documents USING btree (partner_id);


--
-- Name: idx_partner_live_coords; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_live_coords ON public.partner_live_locations USING btree (latitude, longitude);


--
-- Name: idx_partner_location_history_booking; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_location_history_booking ON public.partner_location_history USING btree (booking_id, recorded_at);


--
-- Name: idx_partner_service_area; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_service_area ON public.partner_service_areas USING btree (area_id) WHERE (area_id IS NOT NULL);


--
-- Name: idx_partner_service_city; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_service_city ON public.partner_service_areas USING btree (city_id);


--
-- Name: idx_partner_service_partner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_service_partner ON public.partner_service_areas USING btree (partner_id);


--
-- Name: idx_partner_skills_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_skills_category ON public.partner_skills USING btree (service_category_id);


--
-- Name: idx_partner_skills_partner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_skills_partner ON public.partner_skills USING btree (partner_id);


--
-- Name: idx_partner_vehicles_partner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_vehicles_partner ON public.partner_vehicles USING btree (partner_id);


--
-- Name: idx_payments_booking; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payments_booking ON public.payments USING btree (booking_id);


--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payments_status ON public.payments USING btree (payment_status);


--
-- Name: idx_pricing_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pricing_lookup ON public.pricing_rules USING btree (city_id, service_category_id);


--
-- Name: idx_rate_cards_city; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rate_cards_city ON public.service_rate_cards USING btree (city_id);


--
-- Name: idx_refunds_payment; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_refunds_payment ON public.refunds USING btree (payment_id);


--
-- Name: idx_reviews_booking; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reviews_booking ON public.reviews_ratings USING btree (booking_id);


--
-- Name: idx_reviews_reviewee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reviews_reviewee ON public.reviews_ratings USING btree (reviewee_user_id, rating);


--
-- Name: idx_service_parent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_service_parent ON public.service_categories USING btree (parent_category_id);


--
-- Name: idx_services_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_services_category ON public.services USING btree (service_category_id);


--
-- Name: idx_sessions_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_active ON public.user_sessions USING btree (user_id, expires_at) WHERE (revoked_at IS NULL);


--
-- Name: idx_sessions_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_user ON public.user_sessions USING btree (user_id);


--
-- Name: idx_status_history_booking; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_status_history_booking ON public.booking_status_history USING btree (booking_id);


--
-- Name: idx_user_addresses_area; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_addresses_area ON public.user_addresses USING btree (area_id) WHERE (area_id IS NOT NULL);


--
-- Name: idx_user_addresses_city; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_addresses_city ON public.user_addresses USING btree (city_id);


--
-- Name: idx_user_addresses_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_addresses_user ON public.user_addresses USING btree (user_id);


--
-- Name: idx_vehicles_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_status ON public.vehicles USING btree (verification_status);


--
-- Name: idx_vehicles_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vehicles_type ON public.vehicles USING btree (vehicle_type_id);


--
-- Name: idx_wallet_transactions_wallet; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_wallet_transactions_wallet ON public.wallet_transactions USING btree (wallet_id, created_at DESC);


--
-- Name: uq_partner_area_coverage; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_partner_area_coverage ON public.partner_service_areas USING btree (partner_id, area_id) WHERE ((coverage_type)::text = 'AREA'::text);


--
-- Name: uq_partner_city_coverage; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_partner_city_coverage ON public.partner_service_areas USING btree (partner_id, city_id) WHERE ((coverage_type)::text = 'CITY'::text);


--
-- Name: areas fk_area_city; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT fk_area_city FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT;


--
-- Name: booking_assignments fk_assignment_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_assignments
    ADD CONSTRAINT fk_assignment_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_assignments fk_assignment_partner; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_assignments
    ADD CONSTRAINT fk_assignment_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE RESTRICT;


--
-- Name: audit_logs fk_audit_actor; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: partner_availability fk_availability_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_availability
    ADD CONSTRAINT fk_availability_booking FOREIGN KEY (current_booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: partner_availability fk_availability_partner; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_availability
    ADD CONSTRAINT fk_availability_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE;


--
-- Name: booking_inventory_items fk_bii_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_inventory_items
    ADD CONSTRAINT fk_bii_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_inventory_items fk_bii_inventory_item; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_inventory_items
    ADD CONSTRAINT fk_bii_inventory_item FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE RESTRICT;


--
-- Name: bookings fk_booking_cancelled_by; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT fk_booking_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bookings fk_booking_category; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT fk_booking_category FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE RESTRICT;


--
-- Name: bookings fk_booking_city; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT fk_booking_city FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT;


--
-- Name: bookings fk_booking_coupon; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT fk_booking_coupon FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE SET NULL;


--
-- Name: bookings fk_booking_customer; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT fk_booking_customer FOREIGN KEY (customer_id) REFERENCES public.customer_profiles(id) ON DELETE RESTRICT;


--
-- Name: bookings fk_booking_drop_address; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT fk_booking_drop_address FOREIGN KEY (drop_address_id) REFERENCES public.user_addresses(id) ON DELETE RESTRICT;


--
-- Name: booking_items fk_booking_item_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_items
    ADD CONSTRAINT fk_booking_item_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_items fk_booking_item_service; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_items
    ADD CONSTRAINT fk_booking_item_service FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE RESTRICT;


--
-- Name: bookings fk_booking_pickup_address; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT fk_booking_pickup_address FOREIGN KEY (pickup_address_id) REFERENCES public.user_addresses(id) ON DELETE RESTRICT;


--
-- Name: bookings fk_booking_vehicle_type; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT fk_booking_vehicle_type FOREIGN KEY (vehicle_type_id) REFERENCES public.vehicle_types(id) ON DELETE RESTRICT;


--
-- Name: customer_profiles fk_customer_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT fk_customer_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: partner_documents fk_document_partner; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_documents
    ADD CONSTRAINT fk_document_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE;


--
-- Name: partner_documents fk_document_reviewer; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_documents
    ADD CONSTRAINT fk_document_reviewer FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: fare_breakdowns fk_fare_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fare_breakdowns
    ADD CONSTRAINT fk_fare_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: partner_location_history fk_history_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_location_history
    ADD CONSTRAINT fk_history_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: partner_location_history fk_history_partner; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_location_history
    ADD CONSTRAINT fk_history_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE;


--
-- Name: inventory_items fk_inventory_item_category; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT fk_inventory_item_category FOREIGN KEY (inventory_category_id) REFERENCES public.inventory_categories(id) ON DELETE RESTRICT;


--
-- Name: booking_labor_details fk_labor_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_labor_details
    ADD CONSTRAINT fk_labor_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: partner_live_locations fk_live_location_partner; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_live_locations
    ADD CONSTRAINT fk_live_location_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE;


--
-- Name: notifications fk_notification_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notification_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: notifications fk_notification_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: otp_verifications fk_otp_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.otp_verifications
    ADD CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: service_categories fk_parent_category; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT fk_parent_category FOREIGN KEY (parent_category_id) REFERENCES public.service_categories(id) ON DELETE RESTRICT;


--
-- Name: partner_profiles fk_partner_reviewer; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_profiles
    ADD CONSTRAINT fk_partner_reviewer FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: partner_profiles fk_partner_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_profiles
    ADD CONSTRAINT fk_partner_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: partner_vehicles fk_partner_vehicle_partner; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_vehicles
    ADD CONSTRAINT fk_partner_vehicle_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE;


--
-- Name: partner_vehicles fk_partner_vehicle_vehicle; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_vehicles
    ADD CONSTRAINT fk_partner_vehicle_vehicle FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: payments fk_payment_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT fk_payment_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;


--
-- Name: pricing_rules fk_pricing_category; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT fk_pricing_category FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE RESTRICT;


--
-- Name: pricing_rules fk_pricing_city; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT fk_pricing_city FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT;


--
-- Name: pricing_rules fk_pricing_vehicle_type; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT fk_pricing_vehicle_type FOREIGN KEY (vehicle_type_id) REFERENCES public.vehicle_types(id) ON DELETE RESTRICT;


--
-- Name: service_rate_cards fk_rate_card_city; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_rate_cards
    ADD CONSTRAINT fk_rate_card_city FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT;


--
-- Name: service_rate_cards fk_rate_card_service; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_rate_cards
    ADD CONSTRAINT fk_rate_card_service FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: refunds fk_refund_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT fk_refund_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;


--
-- Name: refunds fk_refund_payment; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT fk_refund_payment FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE RESTRICT;


--
-- Name: refunds fk_refund_processed_by; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT fk_refund_processed_by FOREIGN KEY (processed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: reviews_ratings fk_review_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews_ratings
    ADD CONSTRAINT fk_review_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: reviews_ratings fk_review_reviewee; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews_ratings
    ADD CONSTRAINT fk_review_reviewee FOREIGN KEY (reviewee_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reviews_ratings fk_review_reviewer; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reviews_ratings
    ADD CONSTRAINT fk_review_reviewer FOREIGN KEY (reviewer_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: partner_service_areas fk_service_area_area; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_service_areas
    ADD CONSTRAINT fk_service_area_area FOREIGN KEY (city_id, area_id) REFERENCES public.areas(city_id, id) ON DELETE RESTRICT;


--
-- Name: partner_service_areas fk_service_area_city; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_service_areas
    ADD CONSTRAINT fk_service_area_city FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT;


--
-- Name: partner_service_areas fk_service_area_partner; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_service_areas
    ADD CONSTRAINT fk_service_area_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE;


--
-- Name: services fk_service_category; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT fk_service_category FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE RESTRICT;


--
-- Name: user_sessions fk_session_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: partner_skills fk_skill_category; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_skills
    ADD CONSTRAINT fk_skill_category FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE RESTRICT;


--
-- Name: partner_skills fk_skill_partner; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_skills
    ADD CONSTRAINT fk_skill_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE;


--
-- Name: booking_status_history fk_status_history_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT fk_status_history_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_status_history fk_status_history_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT fk_status_history_user FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: wallet_transactions fk_tx_booking; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT fk_tx_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: wallet_transactions fk_tx_wallet; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT fk_tx_wallet FOREIGN KEY (wallet_id) REFERENCES public.partner_wallets(id) ON DELETE RESTRICT;


--
-- Name: user_addresses fk_user_address_area; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT fk_user_address_area FOREIGN KEY (area_id) REFERENCES public.areas(id) ON DELETE RESTRICT;


--
-- Name: user_addresses fk_user_address_city; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT fk_user_address_city FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE RESTRICT;


--
-- Name: user_addresses fk_user_address_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT fk_user_address_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_roles fk_user_roles_role; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE RESTRICT;


--
-- Name: user_roles fk_user_roles_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: vehicles fk_vehicle_type; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT fk_vehicle_type FOREIGN KEY (vehicle_type_id) REFERENCES public.vehicle_types(id) ON DELETE RESTRICT;


--
-- Name: vehicle_types fk_vehicle_type_category; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicle_types
    ADD CONSTRAINT fk_vehicle_type_category FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE RESTRICT;


--
-- Name: partner_wallets fk_wallet_partner; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_wallets
    ADD CONSTRAINT fk_wallet_partner FOREIGN KEY (partner_id) REFERENCES public.partner_profiles(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict obRMHKa5AMThhWCoKSldOqVZd4OgdpAy5mTYaOgNDifd9ED5t4Hf5MdfLXRxPmJ

