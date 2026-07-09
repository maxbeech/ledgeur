-- Links an org to its Stripe subscription so a completed checkout actually
-- flips `orgs.plan` (previously nothing wrote this column outside manual SQL).

alter table orgs add column stripe_customer_id text unique;
alter table orgs add column stripe_subscription_id text unique;

-- Looked up by the webhook via client_reference_id (the org id) or by
-- stripe_customer_id on subsequent subscription update/cancel events.
create index orgs_stripe_customer_idx on orgs (stripe_customer_id) where stripe_customer_id is not null;
