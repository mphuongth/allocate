-- Fold the legacy "Husband" / "Wife" relationship values into "Spouse".
-- The insurance forms now offer Self / Spouse / Child / Parent / Other, so any
-- member still tagged Husband/Wife would otherwise have no matching option.
UPDATE insurance_members
SET relationship = 'Spouse'
WHERE relationship IN ('Husband', 'Wife');
