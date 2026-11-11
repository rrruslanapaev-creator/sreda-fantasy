-- Minimal stand-in for existing Supabase schema to test migration 003.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.managers (id uuid PRIMARY KEY,username text,is_admin boolean NOT NULL DEFAULT false);
CREATE TABLE public.rounds (id bigint PRIMARY KEY,round_number integer,deadline_at timestamptz,status text);
CREATE TABLE public.players (id bigint PRIMARY KEY,name text,position text,active boolean DEFAULT true);
CREATE TABLE public.roster_entries (
  round_id bigint NOT NULL,manager_id uuid NOT NULL,player_id bigint NOT NULL,
  slot text NOT NULL,is_captain boolean DEFAULT false,is_vice_captain boolean DEFAULT false
);
CREATE TABLE public.manager_round_points (
  round_id bigint NOT NULL, manager_id uuid NOT NULL, points integer NOT NULL,
  PRIMARY KEY(round_id,manager_id)
);
INSERT INTO public.managers VALUES('00000000-0000-0000-0000-000000000001','admin',true);
INSERT INTO public.rounds VALUES(1,1,'2020-01-01 00:00:00+00','closed');
INSERT INTO public.players(id,name,position) VALUES
 (1,'Goalkeeper','Вратарь'),(2,'Captain','Полевой'),(3,'Vice','Полевой'),
 (4,'Starter3','Полевой'),(5,'Starter4','Полевой'),(6,'Starter5','Полевой'),
 (7,'Bench1','Полевой'),(8,'Bench2','Полевой');
INSERT INTO public.roster_entries(round_id,manager_id,player_id,slot,is_captain,is_vice_captain) VALUES
 (1,'00000000-0000-0000-0000-000000000001',1,'goalkeeper',false,false),
 (1,'00000000-0000-0000-0000-000000000001',2,'starter',true,false),
 (1,'00000000-0000-0000-0000-000000000001',3,'starter',false,true),
 (1,'00000000-0000-0000-0000-000000000001',4,'starter',false,false),
 (1,'00000000-0000-0000-0000-000000000001',5,'starter',false,false),
 (1,'00000000-0000-0000-0000-000000000001',6,'starter',false,false),
 (1,'00000000-0000-0000-0000-000000000001',7,'bench1',false,false),
 (1,'00000000-0000-0000-0000-000000000001',8,'bench2',false,false);
