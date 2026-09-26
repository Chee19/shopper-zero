-- Local Lumière demonstration connector; existing connector values remain supported.
alter table public.stores drop constraint stores_checkout_connector_check;
alter table public.stores add constraint stores_checkout_connector_check
  check (checkout_connector in ('woo_store_api', 'magento_guest', 'handoff', 'browser', 'provence_demo'));
alter table public.checkouts drop constraint checkouts_connector_check;
alter table public.checkouts add constraint checkouts_connector_check
  check (connector in ('woo_store_api', 'magento_guest', 'handoff', 'browser', 'provence_demo'));
