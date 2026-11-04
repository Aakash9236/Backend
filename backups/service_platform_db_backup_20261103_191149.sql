--
-- PostgreSQL database dump
--

\restrict rPnR8klEF1azAnalRJyk5ePuT2ywHfE9eMhac4GDu0ps1fL4rrBVSacxDvnGSD2

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
-- Data for Name: areas; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.areas (id, city_id, area_name, postal_code, latitude, longitude, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: cities; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cities (id, country_code, state_name, city_name, city_slug, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: customer_profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_profiles (id, user_id, first_name, last_name, date_of_birth, gender, profile_image_url, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: otp_verifications; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.otp_verifications (id, mobile_number, user_id, otp_hash, purpose, status, attempts, max_attempts, expires_at, verified_at, created_at) FROM stdin;
\.


--
-- Data for Name: partner_documents; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_documents (id, partner_id, document_type, document_storage_key, verification_status, rejection_reason, reviewed_by, reviewed_at, uploaded_at) FROM stdin;
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
-- Name: areas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.areas_id_seq', 1, false);


--
-- Name: cities_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cities_id_seq', 1, false);


--
-- Name: customer_profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customer_profiles_id_seq', 1, false);


--
-- Name: otp_verifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.otp_verifications_id_seq', 1, false);


--
-- Name: partner_documents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_documents_id_seq', 1, false);


--
-- Name: partner_profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_profiles_id_seq', 1, false);


--
-- Name: partner_service_areas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_service_areas_id_seq', 1, false);


--
-- Name: partner_skills_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_skills_id_seq', 1, false);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.roles_id_seq', 6, true);


--
-- Name: service_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.service_categories_id_seq', 14, true);


--
-- Name: user_roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_roles_id_seq', 1, false);


--
-- Name: user_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_sessions_id_seq', 1, false);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 1, false);


--
-- Name: areas areas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_pkey PRIMARY KEY (id);


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
-- Name: otp_verifications otp_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.otp_verifications
    ADD CONSTRAINT otp_verifications_pkey PRIMARY KEY (id);


--
-- Name: partner_documents partner_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_documents
    ADD CONSTRAINT partner_documents_pkey PRIMARY KEY (id);


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
-- Name: areas uq_area_city_id; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT uq_area_city_id UNIQUE (city_id, id);


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
-- Name: user_roles uq_user_role; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT uq_user_role UNIQUE (user_id, role_id);


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
-- Name: idx_areas_city; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_areas_city ON public.areas USING btree (city_id);


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
-- Name: idx_partner_document_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_document_status ON public.partner_documents USING btree (verification_status);


--
-- Name: idx_partner_documents; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_documents ON public.partner_documents USING btree (partner_id);


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
-- Name: idx_service_parent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_service_parent ON public.service_categories USING btree (parent_category_id);


--
-- Name: idx_sessions_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_active ON public.user_sessions USING btree (user_id, expires_at) WHERE (revoked_at IS NULL);


--
-- Name: idx_sessions_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_user ON public.user_sessions USING btree (user_id);


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
-- PostgreSQL database dump complete
--

\unrestrict rPnR8klEF1azAnalRJyk5ePuT2ywHfE9eMhac4GDu0ps1fL4rrBVSacxDvnGSD2

