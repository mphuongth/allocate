-- Add last_payment_date and version columns to insurance_members
-- last_payment_date: records when a payment was last marked as paid (REQ-32)
-- version: optimistic concurrency control for concurrent mark-paid requests

ALTER TABLE insurance_members
ADD COLUMN last_payment_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- Index for efficient sorting/filtering by most recent payment date
CREATE INDEX idx_insurance_members_last_payment_date
ON insurance_members (last_payment_date DESC NULLS LAST);

-- Rollback:
-- DROP INDEX idx_insurance_members_last_payment_date;
-- ALTER TABLE insurance_members DROP COLUMN last_payment_date, DROP COLUMN version;
