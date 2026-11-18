ALTER TABLE discord_signup_states ADD COLUMN applicant_name TEXT;
ALTER TABLE discord_webhook_subscriptions ADD COLUMN applicant_name TEXT;
ALTER TABLE discord_webhook_deliveries ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1));
