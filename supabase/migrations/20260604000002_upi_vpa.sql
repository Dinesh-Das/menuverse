-- Expose the restaurant UPI VPA required to build customer checkout QR codes.
-- This is a public payment destination, not a secret credential.

alter table if exists "Restaurant"
  add column if not exists upi_vpa text;

grant select (upi_vpa) on "Restaurant" to anon;
