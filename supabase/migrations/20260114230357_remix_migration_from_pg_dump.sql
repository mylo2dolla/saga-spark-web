CREATE EXTENSION IF NOT EXISTS "pg_graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "plpgsql";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
BEGIN;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

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

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'moderator',
    'user'
);


--
-- Name: get_campaign_by_invite_code(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_campaign_by_invite_code(_invite_code text) RETURNS TABLE(id uuid, name text, owner_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT id, name, owner_id
  FROM public.campaigns
  WHERE invite_code = _invite_code
    AND is_active = true
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  RETURN NEW;
END;
$$;


--
-- Name: handle_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;


--
-- Name: is_campaign_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_campaign_member(_user_id uuid, _campaign_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.campaign_members
    WHERE user_id = _user_id
      AND campaign_id = _campaign_id
  )
$$;


--
-- Name: is_campaign_owner(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_campaign_owner(_user_id uuid, _campaign_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.campaigns
    WHERE id = _campaign_id
      AND owner_id = _user_id
  )
$$;


SET default_table_access_method = heap;

--
-- Name: abilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abilities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    ability_type text DEFAULT 'active'::text NOT NULL,
    damage text,
    healing text,
    range integer DEFAULT 1,
    cost integer DEFAULT 0,
    cost_type text DEFAULT 'mana'::text,
    cooldown integer DEFAULT 0,
    targeting_type text DEFAULT 'single'::text,
    area_size integer DEFAULT 1,
    effects jsonb DEFAULT '[]'::jsonb,
    is_equipped boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: campaign_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    user_id uuid NOT NULL,
    is_dm boolean DEFAULT false NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    invite_code text DEFAULT "substring"(md5((random())::text), 1, 8) NOT NULL,
    owner_id uuid NOT NULL,
    current_scene text DEFAULT 'The adventure begins...'::text,
    game_state jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.characters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    class text NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    hp integer DEFAULT 10 NOT NULL,
    max_hp integer DEFAULT 10 NOT NULL,
    ac integer DEFAULT 10 NOT NULL,
    stats jsonb DEFAULT '{"wisdom": 10, "charisma": 10, "strength": 10, "dexterity": 10, "constitution": 10, "intelligence": 10}'::jsonb,
    abilities jsonb DEFAULT '[]'::jsonb,
    inventory jsonb DEFAULT '[]'::jsonb,
    xp integer DEFAULT 0 NOT NULL,
    xp_to_next integer DEFAULT 300 NOT NULL,
    "position" jsonb DEFAULT '{"x": 0, "y": 0}'::jsonb,
    status_effects text[] DEFAULT '{}'::text[],
    avatar_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    equipment jsonb DEFAULT '{"armor": null, "boots": null, "ring1": null, "ring2": null, "gloves": null, "helmet": null, "shield": null, "weapon": null, "trinket1": null, "trinket2": null, "trinket3": null}'::jsonb,
    backpack jsonb DEFAULT '[]'::jsonb,
    resources jsonb DEFAULT '{"mana": 0, "rage": 0, "maxMana": 0, "maxRage": 0, "stamina": 0, "maxStamina": 0}'::jsonb,
    class_description text,
    passives jsonb DEFAULT '[]'::jsonb
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    user_id uuid,
    message_type text DEFAULT 'player'::text NOT NULL,
    content text NOT NULL,
    roll_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: combat_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.combat_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    round_number integer DEFAULT 1 NOT NULL,
    current_turn_index integer DEFAULT 0 NOT NULL,
    initiative_order uuid[] DEFAULT '{}'::uuid[],
    enemies jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: grid_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grid_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    grid_size jsonb DEFAULT '{"cols": 12, "rows": 10}'::jsonb NOT NULL,
    tiles jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    item_type text DEFAULT 'treasure'::text NOT NULL,
    slot text,
    rarity text DEFAULT 'common'::text NOT NULL,
    stat_modifiers jsonb DEFAULT '{}'::jsonb,
    abilities_granted jsonb DEFAULT '[]'::jsonb,
    effects jsonb DEFAULT '[]'::jsonb,
    value integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    display_name text NOT NULL,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role DEFAULT 'user'::public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: abilities abilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abilities
    ADD CONSTRAINT abilities_pkey PRIMARY KEY (id);


--
-- Name: campaign_members campaign_members_campaign_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_members
    ADD CONSTRAINT campaign_members_campaign_id_user_id_key UNIQUE (campaign_id, user_id);


--
-- Name: campaign_members campaign_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_members
    ADD CONSTRAINT campaign_members_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_invite_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_invite_code_key UNIQUE (invite_code);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: characters characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: combat_state combat_state_campaign_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combat_state
    ADD CONSTRAINT combat_state_campaign_id_key UNIQUE (campaign_id);


--
-- Name: combat_state combat_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combat_state
    ADD CONSTRAINT combat_state_pkey PRIMARY KEY (id);


--
-- Name: grid_state grid_state_campaign_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grid_state
    ADD CONSTRAINT grid_state_campaign_id_key UNIQUE (campaign_id);


--
-- Name: grid_state grid_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grid_state
    ADD CONSTRAINT grid_state_pkey PRIMARY KEY (id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: campaigns update_campaigns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


--
-- Name: characters update_characters_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_characters_updated_at BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


--
-- Name: combat_state update_combat_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_combat_state_updated_at BEFORE UPDATE ON public.combat_state FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


--
-- Name: grid_state update_grid_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_grid_state_updated_at BEFORE UPDATE ON public.grid_state FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


--
-- Name: abilities abilities_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abilities
    ADD CONSTRAINT abilities_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: campaign_members campaign_members_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_members
    ADD CONSTRAINT campaign_members_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_members campaign_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_members
    ADD CONSTRAINT campaign_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: campaigns campaigns_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: characters characters_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: characters characters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: combat_state combat_state_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combat_state
    ADD CONSTRAINT combat_state_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: grid_state grid_state_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grid_state
    ADD CONSTRAINT grid_state_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: items Anyone can view items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view items" ON public.items FOR SELECT USING (true);


--
-- Name: combat_state Campaign members can insert combat state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Campaign members can insert combat state" ON public.combat_state FOR INSERT WITH CHECK (public.is_campaign_member(auth.uid(), campaign_id));


--
-- Name: chat_messages Campaign members can send messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Campaign members can send messages" ON public.chat_messages FOR INSERT WITH CHECK (public.is_campaign_member(auth.uid(), campaign_id));


--
-- Name: combat_state Campaign members can update combat state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Campaign members can update combat state" ON public.combat_state FOR UPDATE USING (public.is_campaign_member(auth.uid(), campaign_id));


--
-- Name: grid_state Campaign members can update grid state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Campaign members can update grid state" ON public.grid_state FOR UPDATE USING ((public.is_campaign_member(auth.uid(), campaign_id) OR public.is_campaign_owner(auth.uid(), campaign_id)));


--
-- Name: characters Campaign members can view characters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Campaign members can view characters" ON public.characters FOR SELECT USING ((public.is_campaign_member(auth.uid(), campaign_id) OR public.is_campaign_owner(auth.uid(), campaign_id)));


--
-- Name: combat_state Campaign members can view combat state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Campaign members can view combat state" ON public.combat_state FOR SELECT USING (public.is_campaign_member(auth.uid(), campaign_id));


--
-- Name: grid_state Campaign members can view grid state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Campaign members can view grid state" ON public.grid_state FOR SELECT USING ((public.is_campaign_member(auth.uid(), campaign_id) OR public.is_campaign_owner(auth.uid(), campaign_id)));


--
-- Name: chat_messages Campaign members can view messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Campaign members can view messages" ON public.chat_messages FOR SELECT USING (public.is_campaign_member(auth.uid(), campaign_id));


--
-- Name: campaigns Campaign members can view their campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Campaign members can view their campaigns" ON public.campaigns FOR SELECT USING ((public.is_campaign_member(auth.uid(), id) OR (owner_id = auth.uid())));


--
-- Name: grid_state Campaign owners can delete grid state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Campaign owners can delete grid state" ON public.grid_state FOR DELETE USING (public.is_campaign_owner(auth.uid(), campaign_id));


--
-- Name: grid_state Campaign owners can insert grid state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Campaign owners can insert grid state" ON public.grid_state FOR INSERT WITH CHECK (public.is_campaign_owner(auth.uid(), campaign_id));


--
-- Name: combat_state Campaign owners can manage combat state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Campaign owners can manage combat state" ON public.combat_state USING (public.is_campaign_owner(auth.uid(), campaign_id));


--
-- Name: campaign_members Members can view campaign members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can view campaign members" ON public.campaign_members FOR SELECT USING ((public.is_campaign_member(auth.uid(), campaign_id) OR public.is_campaign_owner(auth.uid(), campaign_id)));


--
-- Name: items Only system can insert items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only system can insert items" ON public.items FOR INSERT WITH CHECK (false);


--
-- Name: campaigns Owners can delete their campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can delete their campaigns" ON public.campaigns FOR DELETE USING ((auth.uid() = owner_id));


--
-- Name: campaigns Owners can update their campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can update their campaigns" ON public.campaigns FOR UPDATE USING ((auth.uid() = owner_id));


--
-- Name: profiles Profiles are viewable by everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);


--
-- Name: abilities Users can create abilities for their characters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create abilities for their characters" ON public.abilities FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.characters c
  WHERE ((c.id = abilities.character_id) AND (c.user_id = auth.uid())))));


--
-- Name: campaigns Users can create campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create campaigns" ON public.campaigns FOR INSERT WITH CHECK ((auth.uid() = owner_id));


--
-- Name: characters Users can create their own characters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own characters" ON public.characters FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (public.is_campaign_member(auth.uid(), campaign_id) OR public.is_campaign_owner(auth.uid(), campaign_id))));


--
-- Name: abilities Users can delete their own abilities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own abilities" ON public.abilities FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.characters c
  WHERE ((c.id = abilities.character_id) AND (c.user_id = auth.uid())))));


--
-- Name: characters Users can delete their own characters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own characters" ON public.characters FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: profiles Users can insert their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: campaign_members Users can join campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can join campaigns" ON public.campaign_members FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: campaign_members Users can leave campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can leave campaigns" ON public.campaign_members FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: abilities Users can update their own abilities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own abilities" ON public.abilities FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.characters c
  WHERE ((c.id = abilities.character_id) AND (c.user_id = auth.uid())))));


--
-- Name: characters Users can update their own characters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own characters" ON public.characters FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: profiles Users can update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: abilities Users can view their own abilities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own abilities" ON public.abilities FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.characters c
  WHERE ((c.id = abilities.character_id) AND ((c.user_id = auth.uid()) OR public.is_campaign_member(auth.uid(), c.campaign_id))))));


--
-- Name: user_roles Users can view their own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: abilities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abilities ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_members ENABLE ROW LEVEL SECURITY;

--
-- Name: campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: characters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: combat_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.combat_state ENABLE ROW LEVEL SECURITY;

--
-- Name: grid_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grid_state ENABLE ROW LEVEL SECURITY;

--
-- Name: items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--




COMMIT;