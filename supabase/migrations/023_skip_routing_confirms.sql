-- Per-user toggle to skip routing restructure confirmation dialogs
ALTER TABLE user_dispatcher_preferences
  ADD COLUMN IF NOT EXISTS skip_routing_confirmations BOOLEAN NOT NULL DEFAULT false;
