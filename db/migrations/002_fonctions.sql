-- =====================================================================
-- Cintre — 002 : règles de cohérence et fonctions appelées par l'application
-- ---------------------------------------------------------------------
-- Les règles métier (vente, stock, dettes, caisse) sont calculées par le moteur
-- de l'application (js/moteur.js, testé) ; la base :
--   - applique chaque opération en UNE transaction (tout ou rien),
--   - une seule fois (identifiant d'opération : pas de doublon à la synchronisation),
--   - en refusant toute donnée incohérente (contraintes + déclencheurs ci-dessous).
-- Les fonctions s'exécutent avec les droits de l'utilisateur (security invoker) :
-- la sécurité par ligne s'applique toujours. Seule la suppression du compte
-- (qui doit effacer l'utilisateur de l'authentification) est en security definer.
-- =====================================================================

-- ---------- Cohérence ----------

-- Facture : si deux appareils ont donné le même numéro hors-ligne, le second reçoit le suivant.
create or replace function public.ventes_numero_libre() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from public.ventes
             where user_id = new.user_id and numero = new.numero and id <> new.id) then
    select coalesce(max(numero), 0) + 1 into new.numero from public.ventes where user_id = new.user_id;
  end if;
  return new;
end $$;
drop trigger if exists ventes_numero_libre on public.ventes;
create trigger ventes_numero_libre before insert or update of numero on public.ventes
  for each row execute function public.ventes_numero_libre();

-- Un paiement ne peut jamais dépasser le reste à payer d'une dette.
create or replace function public.imputations_controle() returns trigger
language plpgsql as $$
declare
  du bigint;
  deja bigint;
begin
  select montant into du from public.dettes where id = new.dette_id;
  select coalesce(sum(i.montant), 0) into deja
    from public.imputations i join public.paiements_dette p on p.id = i.paiement_id
   where i.dette_id = new.dette_id and i.id <> new.id and p.annule_le is null;
  if deja + new.montant > du then
    raise exception 'Le paiement dépasse le reste à payer de la dette %', new.dette_id using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists imputations_controle on public.imputations;
create trigger imputations_controle before insert or update on public.imputations
  for each row execute function public.imputations_controle();

-- ---------- Appliquer une opération venant de l'application ----------
-- p_changements : { "articles": [ {…}, … ], "ventes": [ … ], "profil": [ {…} ], … }
-- Le user_id de chaque ligne est TOUJOURS celui de l'utilisateur connecté (jamais celui envoyé).
create or replace function public.appliquer_changements(p_operation uuid, p_changements jsonb)
returns boolean
language plpgsql security invoker set search_path = public
as $$
declare
  uid uuid := public.app_user_id();
begin
  if uid is null then
    raise exception 'Non connecté' using errcode = '28000';
  end if;

  -- Déjà reçue ? (renvoi après une coupure réseau) : rien à refaire.
  insert into operations (id, user_id) values (p_operation, uid) on conflict (id) do nothing;
  if not found then
    return false;
  end if;

  if p_changements ? 'profil' then
    insert into profils (id, nom_boutique, devise_principale, taux, fuseau, seuil_stock_bas, cree_le, modifie_le)
    select uid, r.nom_boutique, r.devise_principale, r.taux, coalesce(r.fuseau, 'Africa/Lubumbashi'),
           coalesce(r.seuil_stock_bas, 3), coalesce(r.cree_le, now()), coalesce(r.modifie_le, now())
      from jsonb_to_recordset(p_changements -> 'profil')
        as r(nom_boutique text, devise_principale text, taux integer, fuseau text, seuil_stock_bas integer,
             cree_le timestamptz, modifie_le timestamptz)
    on conflict (id) do update set
      nom_boutique = excluded.nom_boutique, devise_principale = excluded.devise_principale, taux = excluded.taux,
      fuseau = excluded.fuseau, seuil_stock_bas = excluded.seuil_stock_bas, modifie_le = excluded.modifie_le;
  end if;

  if p_changements ? 'articles' then
    insert into articles (id, user_id, nom, prix_achat, devise, quantite, categorie, cree_le, modifie_le, supprime_le)
    select r.id, uid, r.nom, r.prix_achat, r.devise, r.quantite, r.categorie, r.cree_le, r.modifie_le, r.supprime_le
      from jsonb_to_recordset(p_changements -> 'articles')
        as r(id uuid, nom text, prix_achat bigint, devise text, quantite integer, categorie text,
             cree_le timestamptz, modifie_le timestamptz, supprime_le timestamptz)
    on conflict (id) do update set
      nom = excluded.nom, prix_achat = excluded.prix_achat, devise = excluded.devise, quantite = excluded.quantite,
      categorie = excluded.categorie, modifie_le = excluded.modifie_le, supprime_le = excluded.supprime_le;
  end if;

  if p_changements ? 'clients' then
    insert into clients (id, user_id, nom, telephone, cree_le)
    select r.id, uid, r.nom, r.telephone, r.cree_le
      from jsonb_to_recordset(p_changements -> 'clients') as r(id uuid, nom text, telephone text, cree_le timestamptz)
    on conflict (id) do update set nom = excluded.nom, telephone = excluded.telephone;
  end if;

  if p_changements ? 'ventes' then
    insert into ventes (id, user_id, numero, cree_le, devise, taux, total, totaux, total_principal, cout_principal,
                        statut, client_id, mode, annule_le)
    select r.id, uid, r.numero, r.cree_le, r.devise, r.taux, r.total, r.totaux, r.total_principal,
           coalesce(r.cout_principal, 0), r.statut, r.client_id, r.mode, r.annule_le
      from jsonb_to_recordset(p_changements -> 'ventes')
        as r(id uuid, numero integer, cree_le timestamptz, devise text, taux integer, total bigint, totaux jsonb,
             total_principal bigint, cout_principal bigint, statut text, client_id uuid, mode text, annule_le timestamptz)
    on conflict (id) do update set annule_le = excluded.annule_le, mode = excluded.mode;
  end if;

  if p_changements ? 'lignes_de_vente' then
    insert into lignes_de_vente (id, user_id, vente_id, article_id, nom, categorie, quantite, prix_unitaire, devise,
                                 montants, cout_principal, montant_principal)
    select r.id, uid, r.vente_id, r.article_id, r.nom, r.categorie, r.quantite, r.prix_unitaire, r.devise,
           r.montants, coalesce(r.cout_principal, 0), r.montant_principal
      from jsonb_to_recordset(p_changements -> 'lignes_de_vente')
        as r(id uuid, vente_id uuid, article_id uuid, nom text, categorie text, quantite integer, prix_unitaire bigint,
             devise text, montants jsonb, cout_principal bigint, montant_principal bigint)
    on conflict (id) do nothing;   -- une ligne de vente ne change jamais
  end if;

  if p_changements ? 'dettes' then
    insert into dettes (id, user_id, client_id, vente_id, devise, taux, montant_vente, acompte, montant, cree_le, annule_le)
    select r.id, uid, r.client_id, r.vente_id, r.devise, r.taux, r.montant_vente, r.acompte, r.montant, r.cree_le, r.annule_le
      from jsonb_to_recordset(p_changements -> 'dettes')
        as r(id uuid, client_id uuid, vente_id uuid, devise text, taux integer, montant_vente bigint, acompte bigint,
             montant bigint, cree_le timestamptz, annule_le timestamptz)
    on conflict (id) do update set annule_le = excluded.annule_le;
  end if;

  if p_changements ? 'paiements_dette' then
    insert into paiements_dette (id, user_id, client_id, devise, montant, devise_recue, montant_recu, taux, mode, note,
                                 cree_le, annule_le)
    select r.id, uid, r.client_id, r.devise, r.montant, r.devise_recue, r.montant_recu, r.taux, r.mode, r.note,
           r.cree_le, r.annule_le
      from jsonb_to_recordset(p_changements -> 'paiements_dette')
        as r(id uuid, client_id uuid, devise text, montant bigint, devise_recue text, montant_recu bigint, taux integer,
             mode text, note text, cree_le timestamptz, annule_le timestamptz)
    on conflict (id) do update set annule_le = excluded.annule_le;
  end if;

  if p_changements ? 'imputations' then
    insert into imputations (id, user_id, paiement_id, dette_id, montant)
    select r.id, uid, r.paiement_id, r.dette_id, r.montant
      from jsonb_to_recordset(p_changements -> 'imputations')
        as r(id uuid, paiement_id uuid, dette_id uuid, montant bigint)
    on conflict (id) do nothing;
  end if;

  if p_changements ? 'depenses' then
    insert into depenses (id, user_id, montant, devise, type, mode, note, taux, montant_principal, cree_le, modifie_le, annule_le)
    select r.id, uid, r.montant, r.devise, r.type, r.mode, r.note, r.taux, r.montant_principal, r.cree_le,
           coalesce(r.modifie_le, now()), r.annule_le
      from jsonb_to_recordset(p_changements -> 'depenses')
        as r(id uuid, montant bigint, devise text, type text, mode text, note text, taux integer,
             montant_principal bigint, cree_le timestamptz, modifie_le timestamptz, annule_le timestamptz)
    on conflict (id) do update set
      montant = excluded.montant, devise = excluded.devise, type = excluded.type, mode = excluded.mode,
      note = excluded.note, montant_principal = excluded.montant_principal, modifie_le = excluded.modifie_le,
      annule_le = excluded.annule_le;
  end if;

  if p_changements ? 'mouvements_caisse' then
    insert into mouvements_caisse (id, user_id, type, source, reference_id, devise, montant, mode, montant_principal,
                                   cree_le, annule_le)
    select r.id, uid, r.type, r.source, r.reference_id, r.devise, r.montant, r.mode, r.montant_principal,
           r.cree_le, r.annule_le
      from jsonb_to_recordset(p_changements -> 'mouvements_caisse')
        as r(id uuid, type text, source text, reference_id uuid, devise text, montant bigint, mode text,
             montant_principal bigint, cree_le timestamptz, annule_le timestamptz)
    on conflict (id) do update set
      devise = excluded.devise, montant = excluded.montant, mode = excluded.mode,
      montant_principal = excluded.montant_principal, annule_le = excluded.annule_le;
  end if;

  return true;
end $$;

-- ---------- Effacer mes données (Profil → Tout effacer) ----------
create or replace function public.effacer_mes_donnees(p_garder_boutique boolean default true)
returns void
language plpgsql security invoker set search_path = public
as $$
declare uid uuid := public.app_user_id();
begin
  if uid is null then raise exception 'Non connecté' using errcode = '28000'; end if;
  delete from imputations where user_id = uid;
  delete from paiements_dette where user_id = uid;
  delete from mouvements_caisse where user_id = uid;
  delete from dettes where user_id = uid;
  delete from lignes_de_vente where user_id = uid;
  delete from ventes where user_id = uid;
  delete from depenses where user_id = uid;
  delete from clients where user_id = uid;
  delete from articles where user_id = uid;
  delete from operations where user_id = uid;
  if not p_garder_boutique then delete from profils where id = uid; end if;
end $$;

-- ---------- Supprimer mon compte (données + identifiants de connexion) ----------
create or replace function public.supprimer_mon_compte()
returns void
language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Non connecté' using errcode = '28000'; end if;
  delete from imputations where user_id = uid;
  delete from paiements_dette where user_id = uid;
  delete from mouvements_caisse where user_id = uid;
  delete from dettes where user_id = uid;
  delete from lignes_de_vente where user_id = uid;
  delete from ventes where user_id = uid;
  delete from depenses where user_id = uid;
  delete from clients where user_id = uid;
  delete from articles where user_id = uid;
  delete from operations where user_id = uid;
  delete from notifications_envoyees where user_id = uid;
  delete from profils where id = uid;
  delete from auth.users where id = uid;
end $$;

-- Seuls les utilisateurs connectés peuvent appeler ces fonctions.
revoke execute on function public.appliquer_changements(uuid, jsonb) from public, anon;
revoke execute on function public.effacer_mes_donnees(boolean) from public, anon;
revoke execute on function public.supprimer_mon_compte() from public, anon;
grant execute on function public.appliquer_changements(uuid, jsonb) to authenticated;
grant execute on function public.effacer_mes_donnees(boolean) to authenticated;
grant execute on function public.supprimer_mon_compte() to authenticated;
