-- Add LinkedIn Sales Navigator company id to organizations table.
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS linkedin_org_id VARCHAR NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_linkedin_org_id
ON organizations (linkedin_org_id);
