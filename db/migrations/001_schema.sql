-- =====================================================================
-- Cintre — 001 : schéma de la base (PostgreSQL standard)
-- ---------------------------------------------------------------------
-- Aucune fonctionnalité propre à Supabase dans les tables : seule la
-- fonction app_user_id() dépend de l'hébergeur (voir plus bas).
-- Montants : nombres ENTIERS dans la plus petite unité de la devise
--   USD -> centimes, CDF -> francs (bigint : exact, jamais de flottant).
-- Taux : entier, nombre de FC pour 1 $.
-- À exécuter une seule fois, dans l'ordre (001, puis 002).
-- =====================================================================

-- Utilisateur connecté.
--   Supabase (Phase A)        : auth.uid()
--   Node.js + PostgreSQL (B)  : current_setting('app.user_id', true)::uuid
create or replace function public.app_user_id() returns uuid
language sql stable
as $$ select auth.uid() $$;

-- Date de dernière modification, utilisée par la synchronisation.
create or replace function public.maj_le_maintenant() returns trigger
language plpgsql as $$
begin
  new.maj_le := clock_timestamp();
  return new;
end $$;

-- ---------- Boutique (une par compte) ----------
create table if not exists public.profils (
  id                uuid primary key,                       -- = identifiant de l'utilisateur
  nom_boutique      text not null check (length(trim(nom_boutique)) between 1 and 60),
  devise_principale text not null check (devise_principale in ('USD', 'CDF')),
  taux              integer not null check (taux between 1 and 1000000),
  fuseau            text not null default 'Africa/Lubumbashi',
  seuil_stock_bas   integer not null default 3 check (seuil_stock_bas between 0 and 1000),
  cree_le           timestamptz not null default now(),
  modifie_le        timestamptz not null default now(),
  maj_le            timestamptz not null default clock_timestamp()
);

-- ---------- Articles (prix = prix d'achat) ----------
create table if not exists public.articles (
  id          uuid primary key,
  user_id     uuid not null,
  nom         text not null check (length(trim(nom)) between 1 and 80),
  prix_achat  bigint not null check (prix_achat > 0),
  devise      text not null check (devise in ('USD', 'CDF')),
  quantite    integer not null check (quantite >= 0),          -- stock jamais négatif
  categorie   text,
  cree_le     timestamptz not null default now(),
  modifie_le  timestamptz not null default now(),
  supprime_le timestamptz,
  maj_le      timestamptz not null default clock_timestamp()
);

create table if not exists public.clients (
  id        uuid primary key,
  user_id   uuid not null,
  nom       text not null check (length(trim(nom)) between 1 and 60),
  telephone text,
  cree_le   timestamptz not null default now(),
  maj_le    timestamptz not null default clock_timestamp()
);

-- ---------- Ventes = factures numérotées ----------
create table if not exists public.ventes (
  id              uuid primary key,
  user_id         uuid not null,
  numero          integer not null check (numero > 0),
  cree_le         timestamptz not null,
  devise          text not null check (devise in ('USD', 'CDF')),
  taux            integer not null check (taux > 0),
  total           bigint not null check (total > 0),
  totaux          jsonb,                                   -- { "USD": …, "CDF": … } (vente $ + FC)
  total_principal bigint not null check (total_principal >= 0),
  cout_principal  bigint not null default 0 check (cout_principal >= 0),
  statut          text not null check (statut in ('payee', 'credit')),
  client_id       uuid,
  mode            text,
  annule_le       timestamptz,
  maj_le          timestamptz not null default clock_timestamp(),
  unique (user_id, numero)
);

create table if not exists public.lignes_de_vente (
  id                uuid primary key,
  user_id           uuid not null,
  vente_id          uuid not null references public.ventes (id) on delete cascade,
  article_id        uuid not null,
  nom               text not null,                         -- nom AU MOMENT de la vente
  categorie         text,
  quantite          integer not null check (quantite > 0),
  prix_unitaire     bigint check (prix_unitaire >= 0),      -- null pour une ligne payée en $ + FC
  devise            text check (devise in ('USD', 'CDF', 'mixte')),
  montants          jsonb,                                   -- { "USD": …, "CDF": … }
  cout_principal    bigint not null default 0,
  montant_principal bigint not null,
  maj_le            timestamptz not null default clock_timestamp()
);

-- ---------- Dettes et paiements ----------
create table if not exists public.dettes (
  id            uuid primary key,
  user_id       uuid not null,
  client_id     uuid not null,
  vente_id      uuid not null references public.ventes (id) on delete cascade,
  devise        text not null check (devise in ('USD', 'CDF')),
  taux          integer not null check (taux > 0),
  montant_vente bigint not null check (montant_vente > 0),
  acompte       bigint not null default 0 check (acompte >= 0),
  montant       bigint not null check (montant > 0),       -- dû après l'acompte
  cree_le       timestamptz not null,
  annule_le     timestamptz,
  maj_le        timestamptz not null default clock_timestamp()
);

create table if not exists public.paiements_dette (
  id           uuid primary key,
  user_id      uuid not null,
  client_id    uuid not null,
  devise       text not null check (devise in ('USD', 'CDF')),      -- devise de la dette
  montant      bigint not null check (montant > 0),                  -- déduit de la dette
  devise_recue text not null check (devise_recue in ('USD', 'CDF')),
  montant_recu bigint not null check (montant_recu > 0),             -- argent réellement reçu
  taux         integer not null check (taux > 0),
  mode         text not null,
  note         text,
  cree_le      timestamptz not null,
  annule_le    timestamptz,
  maj_le       timestamptz not null default clock_timestamp()
);

-- Répartition d'un paiement sur les dettes (la plus ancienne d'abord)
create table if not exists public.imputations (
  id          uuid primary key,
  user_id     uuid not null,
  paiement_id uuid not null references public.paiements_dette (id) on delete cascade,
  dette_id    uuid not null references public.dettes (id) on delete cascade,
  montant     bigint not null check (montant > 0),
  maj_le      timestamptz not null default clock_timestamp()
);

-- ---------- Dépenses et caisse ----------
create table if not exists public.depenses (
  id                uuid primary key,
  user_id           uuid not null,
  montant           bigint not null check (montant > 0),
  devise            text not null check (devise in ('USD', 'CDF')),
  type              text not null,
  mode              text not null,
  note              text,
  taux              integer not null check (taux > 0),
  montant_principal bigint not null,
  cree_le           timestamptz not null,
  modifie_le        timestamptz not null default now(),
  annule_le         timestamptz,
  maj_le            timestamptz not null default clock_timestamp()
);

-- Solde de la caisse = somme des mouvements non annulés
create table if not exists public.mouvements_caisse (
  id                uuid primary key,
  user_id           uuid not null,
  type              text not null check (type in ('entree', 'sortie')),
  source            text not null check (source in ('vente', 'acompte', 'paiement_dette', 'depense')),
  reference_id      uuid not null,
  devise            text not null check (devise in ('USD', 'CDF')),
  montant           bigint not null check (montant > 0),
  mode              text not null,
  montant_principal bigint not null,
  cree_le           timestamptz not null,
  annule_le         timestamptz,
  maj_le            timestamptz not null default clock_timestamp()
);

-- Journal des opérations reçues : une opération n'est appliquée qu'UNE fois (idempotence).
create table if not exists public.operations (
  id      uuid primary key,
  user_id uuid not null,
  recue_le timestamptz not null default now()
);

-- Anti-doublons des e-mails (étape 5)
create table if not exists public.notifications_envoyees (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null,
  type      text not null,
  cle       text not null,
  envoye_le timestamptz not null default now(),
  unique (user_id, type, cle)
);

-- ---------- Index (requêtes par utilisateur et synchronisation) ----------
do $$
declare t text;
begin
  foreach t in array array['articles', 'clients', 'ventes', 'lignes_de_vente', 'dettes',
                            'paiements_dette', 'imputations', 'depenses', 'mouvements_caisse']
  loop
    execute format('create index if not exists %I on public.%I (user_id, maj_le)', t || '_user_maj', t);
  end loop;
end $$;
create index if not exists profils_maj on public.profils (maj_le);
create index if not exists ventes_user_date on public.ventes (user_id, cree_le);
create index if not exists mouvements_user_date on public.mouvements_caisse (user_id, cree_le);
create index if not exists dettes_client on public.dettes (user_id, client_id);
create index if not exists imputations_dette on public.imputations (dette_id);

-- ---------- maj_le tenue à jour à chaque modification ----------
do $$
declare t text;
begin
  foreach t in array array['profils', 'articles', 'clients', 'ventes', 'lignes_de_vente', 'dettes',
                            'paiements_dette', 'imputations', 'depenses', 'mouvements_caisse']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_maj_le', t);
    execute format('create trigger %I before insert or update on public.%I
                    for each row execute function public.maj_le_maintenant()', t || '_maj_le', t);
  end loop;
end $$;

-- =====================================================================
-- Sécurité par ligne : chaque commerçant ne voit et ne modifie QUE ses données.
-- =====================================================================
alter table public.profils enable row level security;
drop policy if exists profils_proprietaire on public.profils;
create policy profils_proprietaire on public.profils
  for all using (id = public.app_user_id()) with check (id = public.app_user_id());

do $$
declare t text;
begin
  foreach t in array array['articles', 'clients', 'ventes', 'lignes_de_vente', 'dettes', 'paiements_dette',
                            'imputations', 'depenses', 'mouvements_caisse', 'operations', 'notifications_envoyees']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_proprietaire', t);
    execute format('create policy %I on public.%I for all
                    using (user_id = public.app_user_id()) with check (user_id = public.app_user_id())',
                   t || '_proprietaire', t);
  end loop;
end $$;

-- Les visiteurs non connectés n'ont accès à rien.
revoke all on all tables in schema public from anon;
