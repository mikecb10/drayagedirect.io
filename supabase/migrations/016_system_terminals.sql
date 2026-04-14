-- ============================================================
-- Migration 016: System Terminals + Market Toggles
-- ============================================================
-- Seeds ~250 US and Canadian intermodal terminals (marine + rail)
-- organized by Market. Tenants flip on markets to populate their
-- instance. The label/key is immutable (used for backend tracking).
-- The default_name (profile name) is overridable per-tenant.
-- ============================================================

-- System terminals — the canonical directory
CREATE TABLE IF NOT EXISTS system_terminals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  country TEXT NOT NULL DEFAULT 'US',
  market TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('MARINE', 'RAIL')),
  label TEXT NOT NULL,
  default_name TEXT NOT NULL,
  address TEXT,
  suite TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  is_system BOOLEAN NOT NULL DEFAULT true,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_terminals_market ON system_terminals(market);
CREATE INDEX IF NOT EXISTS idx_system_terminals_type ON system_terminals(type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_terminals_label ON system_terminals(label) WHERE is_system = true;

-- Tenant market toggles — which markets a tenant has enabled
CREATE TABLE IF NOT EXISTS tenant_market_toggles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, market)
);

CREATE INDEX IF NOT EXISTS idx_tenant_market_toggles_tenant ON tenant_market_toggles(tenant_id);

-- Tenant terminal overrides — per-tenant custom name + individual enable/disable
CREATE TABLE IF NOT EXISTS tenant_terminal_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  terminal_id UUID NOT NULL REFERENCES system_terminals(id) ON DELETE CASCADE,
  custom_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, terminal_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_terminal_overrides_tenant ON tenant_terminal_overrides(tenant_id);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE system_terminals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_market_toggles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_terminal_overrides ENABLE ROW LEVEL SECURITY;

-- system_terminals: readable by all authenticated users
DROP POLICY IF EXISTS system_terminals_select ON system_terminals;
CREATE POLICY system_terminals_select ON system_terminals FOR SELECT
  USING (true);

-- tenant_market_toggles: tenant-isolated
DROP POLICY IF EXISTS tenant_market_toggles_select ON tenant_market_toggles;
CREATE POLICY tenant_market_toggles_select ON tenant_market_toggles FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_market_toggles_insert ON tenant_market_toggles;
CREATE POLICY tenant_market_toggles_insert ON tenant_market_toggles FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_market_toggles_update ON tenant_market_toggles;
CREATE POLICY tenant_market_toggles_update ON tenant_market_toggles FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_market_toggles_delete ON tenant_market_toggles;
CREATE POLICY tenant_market_toggles_delete ON tenant_market_toggles FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- tenant_terminal_overrides: tenant-isolated
DROP POLICY IF EXISTS tenant_terminal_overrides_select ON tenant_terminal_overrides;
CREATE POLICY tenant_terminal_overrides_select ON tenant_terminal_overrides FOR SELECT
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_terminal_overrides_insert ON tenant_terminal_overrides;
CREATE POLICY tenant_terminal_overrides_insert ON tenant_terminal_overrides FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_terminal_overrides_update ON tenant_terminal_overrides;
CREATE POLICY tenant_terminal_overrides_update ON tenant_terminal_overrides FOR UPDATE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

DROP POLICY IF EXISTS tenant_terminal_overrides_delete ON tenant_terminal_overrides;
CREATE POLICY tenant_terminal_overrides_delete ON tenant_terminal_overrides FOR DELETE
  USING (tenant_id = current_tenant_id() OR is_dd_admin());

-- ============================================================
-- SEED SYSTEM TERMINALS (~250 rows)
-- ============================================================

INSERT INTO system_terminals (country, market, type, label, default_name, address, suite, city, state, zip) VALUES
-- ALABAMA
('US', 'ALABAMA', 'MARINE', 'APM MOBILE', 'APM - MOBILE', '901 Ezra Trice Blvd', NULL, 'Mobile', 'AL', '36603'),
('US', 'ALABAMA', 'RAIL', 'CSX NORTH BESSEMER', 'CSX - NORTH BESSEMER', '2401 5th Ave', NULL, 'North Bessemer', 'AL', '35020'),
('US', 'ALABAMA', 'RAIL', 'NS HUNTSVILLE', 'NS - HUNTSVILLE', '2850 Wall-Triana Highway', NULL, 'Huntsville', 'AL', '35824'),
('US', 'ALABAMA', 'RAIL', 'NS MCCALLA', 'NS - MCCALLA', '7100 Crescent Way', NULL, 'McCalla', 'AL', '35111'),
-- ARIZONA
('US', 'ARIZONA', 'RAIL', 'BNSF PHOENIX', 'BNSF - PHOENIX', '5281 N TOM MURRAY ROAD', NULL, 'GLENDALE', 'AZ', '85301'),
('US', 'ARIZONA', 'RAIL', 'UP TUCSON', 'UP - TUCSON', '6800 E CENTURY PARK DRIVE', NULL, 'TUCSON', 'AZ', '85706'),
-- ATLANTA
('US', 'ATLANTA', 'RAIL', 'ARP CRANDALL', 'ARP - APPALACHIAN REGIONAL PORT', '8746 Hwy. 411 North', NULL, 'Crandall', 'GA', '30711'),
('US', 'ATLANTA', 'RAIL', 'BNSF FAIRBURN', 'BNSF - FAIRBURN', '6700 McLarin Road', NULL, 'Fairburn', 'GA', '30213'),
('US', 'ATLANTA', 'RAIL', 'CIS CORDELE', 'CIS - CORDELE INTERMODAL SERCIVES', '2902 East 13th Ave', NULL, 'Cordele', 'GA', '31015'),
('US', 'ATLANTA', 'RAIL', 'CSX ATLANTA HULSEY', 'CSX - ATLANTA HULSEY', 'Boulevard Dr SE', NULL, 'Atlanta', 'GA', '30307'),
('US', 'ATLANTA', 'RAIL', 'CSX FAIRBURN', 'CSX - FAIRBURN', '6700 McLarin Road', NULL, 'Fairburn', 'GA', '30213'),
('US', 'ATLANTA', 'RAIL', 'FEC ATLANTA', 'FEC - ATLANTA', '1600 Marietta Road, NW - Gate 6', NULL, 'Atlanta', 'GA', '30318'),
('US', 'ATLANTA', 'RAIL', 'NS ATLANTA', 'NS - ATLANTA', '1600 Marietta Road', NULL, 'Atlanta', 'GA', '30318'),
('US', 'ATLANTA', 'RAIL', 'NS AUSTELL', 'NS - AUSTELL', '6000 Dr. Luke Glenn Garrett, Jr. Memorial Highway', NULL, 'Austell', 'GA', '30196'),
-- BALTIMORE
('US', 'BALTIMORE', 'MARINE', 'DUNDALK', 'DUNDALK MARINE TERMINAL', '2700 Broening Hwy', NULL, 'Baltimore', 'MD', '21222'),
('US', 'BALTIMORE', 'MARINE', 'FAIRFIELD', 'FAIRFIELD / MASONSVILLE MARINE TERMINAL', '2900 Childs St.', NULL, 'Baltimore', 'MD', '21222'),
('US', 'BALTIMORE', 'MARINE', 'LOCUST POINT', 'LOCUST POINT MARINE TERMINAL', '2025 E McComas St', NULL, 'Baltimore', 'MD', '21222'),
('US', 'BALTIMORE', 'MARINE', 'SEAGIRT', 'SEAGIRT MARINE TERMINAL', '2600 Broening Hwy', NULL, 'Baltimore', 'MD', '21222'),
('US', 'BALTIMORE', 'MARINE', 'SOUTH LOCUST POINT', 'SOUTH LOCUST POINT MARINE TERMINAL', '2001 E McComas St', NULL, 'Baltimore', 'MD', '21222'),
('US', 'BALTIMORE', 'RAIL', 'CSX BALTIMORE', 'CSX - BALTIMORE', '4801 Keith Avenue', NULL, 'Baltimore', 'MD', '21224'),
('US', 'BALTIMORE', 'RAIL', 'CSX BALTIMORE CURTIS BAY', 'CSX - BALTIMORE CURTIS BAY', '1910 Benhill Ave', NULL, 'Baltimore', 'MD', '21226'),
('US', 'BALTIMORE', 'RAIL', 'NS BALTIMORE', 'NS - BALTIMORE', '4800 E. Lombard Street', NULL, 'Baltimore', 'MD', '21224'),
-- BOSTON
('US', 'BOSTON', 'MARINE', 'CONLEY', 'CONLEY CONTAINER TERMINAL', '700 Summer St', NULL, 'South Boston', 'MA', '02127'),
('US', 'BOSTON', 'RAIL', 'CSX SPRINGFIELD', 'CSX - SPRINGFIELD', '151 Day Street', NULL, 'West Springfield', 'MA', NULL),
('US', 'BOSTON', 'RAIL', 'CSX WORCESTER', 'CSX - WORCESTER', '165 Grafton Street', NULL, 'Worcester', 'MA', NULL),
('US', 'BOSTON', 'RAIL', 'ICI WORCESTER', 'INTRANSIT CONTAINER - WORCESTER', '53 Wiser Ave', NULL, 'Worcester', 'MA', NULL),
('US', 'BOSTON', 'RAIL', 'NS AYER', 'NS - AYER', '133 Barnum Road', NULL, 'Ayer', 'MA', NULL),
-- CHARLESTON
('US', 'CHARLESTON', 'MARINE', 'HLT', 'HLT - Hugh K. Leatherman Terminal', '1500 Port Access Rd.', NULL, 'North Charleston', 'SC', '29406'),
('US', 'CHARLESTON', 'MARINE', 'NCT RSA', 'NCT RSA - North Charleston Terminal', '1000 Remount Road', NULL, 'North Charleston', 'SC', '29406'),
('US', 'CHARLESTON', 'MARINE', 'WWT', 'WWT - Wando Welch Terminal', '400 Long Point Rd.', NULL, 'Mt. Pleasant', 'SC', '29464'),
('US', 'CHARLESTON', 'RAIL', 'CSX DILLON', 'CSX - DILLON', '111 West Fairfield Road', NULL, 'Dillon', 'SC', '29536'),
('US', 'CHARLESTON', 'RAIL', 'CSX NORTH CHARLESTON', 'CSX - NORTH CHARLESTON', '4201 Meeting Street', NULL, 'North Charleston', 'SC', '29405'),
('US', 'CHARLESTON', 'RAIL', 'NS NORTH CHARLESTON', 'NS - NORTH CHARLESTON', '4350 Goer Drive', NULL, 'North Charleston', 'SC', '29406'),
('US', 'CHARLESTON', 'RAIL', 'SCIP', 'SCIP - SOUTH CAROLINA INLAND PORT', '100 International Commerce Blvd.', NULL, 'Greer', 'SC', '29651'),
-- CHICAGO
('US', 'CHICAGO', 'RAIL', 'BNSF CHICAGO', 'BNSF - CHICAGO', '3526 W. 43rd St.', NULL, 'Chicago', 'IL', '60632'),
('US', 'CHICAGO', 'RAIL', 'BNSF CICERO', 'BNSF - CICERO', '5601 W. 26th St.', NULL, 'Cicero', 'IL', '60421'),
('US', 'CHICAGO', 'RAIL', 'BNSF ELWOOD', 'BNSF - ELWOOD', '26664 Elwood International Port Rd', NULL, 'Elwood', 'IL', '60421'),
('US', 'CHICAGO', 'RAIL', 'BNSF HODGKINS', 'BNSF - HODGKINS', '7600 Santa Fe Dr.', NULL, 'Hodgkins', 'IL', '60525'),
('US', 'CHICAGO', 'RAIL', 'CN HARVEY', 'CN - HARVEY', '16800 South Center St.', NULL, 'Harvey', 'IL', '60426'),
('US', 'CHICAGO', 'RAIL', 'CN JOLIET', 'CN - JOLIET', '785 Draper Ave', NULL, 'Joliet', 'IL', '60432'),
('US', 'CHICAGO', 'RAIL', 'CP FRANKLIN PARK', 'CP - FRANKLIN PARK', '10800 S. Franklin Ave.', NULL, 'Franklin Park', 'IL', '60131'),
('US', 'CHICAGO', 'RAIL', 'CP SCHILLER PARK', 'CP - SCHILLER PARK', '9665 W. Lawrence Ave', NULL, 'Schiller Park', 'IL', '60176'),
('US', 'CHICAGO', 'RAIL', 'CSX BEDFORD PARK', 'CSX - BEDFORD PARK', '7000 W. 71st St.', NULL, 'Bedford Park', 'IL', '60638'),
('US', 'CHICAGO', 'RAIL', 'CSX CHICAGO 59TH', 'CSX - CHICAGO (59TH)', '2101 W. 59th St.', NULL, 'Chicago', 'IL', '60636'),
('US', 'CHICAGO', 'RAIL', 'IAIS BLUE ISLAND', 'IAIS - BLUE ISLAND', '2100 Prairie St.', NULL, 'Blue Island', 'IL', '60406'),
('US', 'CHICAGO', 'RAIL', 'NS CHICAGO 106TH', 'NS - CHICAGO (106TH)', '2040 E. 106th St.', NULL, 'Chicago', 'IL', '60617'),
('US', 'CHICAGO', 'RAIL', 'NS CHICAGO 47TH', 'NS - CHICAGO (47TH)', '361 W. 47th St.', NULL, 'Chicago', 'IL', '60609'),
('US', 'CHICAGO', 'RAIL', 'NS CHICAGO 63RD', 'NS - CHICAGO (63RD)', '169 E 63rd ST', NULL, 'Chicago', 'IL', '60637'),
('US', 'CHICAGO', 'RAIL', 'NS CHICAGO S WESTERN', 'NS - CHICAGO (S WESTERN AVE)', '7540 S. Western Avenue', NULL, 'Chicago', 'IL', '60620'),
('US', 'CHICAGO', 'RAIL', 'UP DECATUR', 'UP - DECATUR', '3095 E. Parkway Drive', NULL, 'Decatur', 'IL', NULL),
('US', 'CHICAGO', 'RAIL', 'UP DOLTON', 'UP - DOLTON', '147th St. & Indiana Ave.', NULL, 'Dolton', 'IL', '60419'),
('US', 'CHICAGO', 'RAIL', 'UP JOLIET', 'UP - JOLIET', '3000 Centerpoint Way', NULL, 'Joliet', 'IL', '60436'),
('US', 'CHICAGO', 'RAIL', 'UP NORTHLAKE', 'UP - NORTHLAKE', '301 W. Lake St.', NULL, 'Northlake', 'IL', '60184'),
('US', 'CHICAGO', 'RAIL', 'UP ROCHELLE', 'UP - ROCHELLE', '2701 Intermodal Dr.', NULL, 'Rochelle', 'IL', '61068'),
-- DALLAS / FT WORTH
('US', 'DALLAS / FT WORTH', 'RAIL', 'BNSF HASLET', 'BNSF - HASLET', '1111 Intermodal Parkway', NULL, 'Haslet', 'TX', '76052'),
('US', 'DALLAS / FT WORTH', 'RAIL', 'KCS WYLIE', 'KCS - WYLIE', '2800 N. State Hwy 78', NULL, 'Wylie', 'TX', '75098'),
('US', 'DALLAS / FT WORTH', 'RAIL', 'UP HUTCHINS', 'UP - HUTCHINS', '1550 Fulghum Rd', NULL, 'Hutchins', 'TX', '75141'),
('US', 'DALLAS / FT WORTH', 'RAIL', 'UP MESQUITE', 'UP - MESQUITE', '4100 Forney Rd.', NULL, 'Mesquite', 'TX', '75149'),
-- DENVER
('US', 'DENVER', 'RAIL', 'BNSF DENVER', 'BNSF - DENVER', '585 West 53rd Place', NULL, 'Hudson', 'CO', '80642'),
('US', 'DENVER', 'RAIL', 'BNSF HUDSON', 'BNSF HUDSON', '2001 LCH AVE', NULL, 'Hudson', 'CO', '80642'),
('US', 'DENVER', 'RAIL', 'UP DENVER', 'UP - DENVER', '4085 York St', NULL, 'Denver', 'CO', '80216'),
-- DETROIT
('US', 'DETROIT', 'RAIL', 'CN FERNDALE', 'CN - FERNDALE', '289 Fern Street', NULL, 'Ferndale', 'MI', '48220'),
('US', 'DETROIT', 'RAIL', 'CP DETROIT', 'CP - DETROIT', '12594 Westwood St.', NULL, 'Detroit', 'MI', '48223'),
('US', 'DETROIT', 'RAIL', 'CSX DETROIT', 'CSX - DETROIT', '6750 Dix Street', NULL, 'Detroit', 'MI', '48209'),
('US', 'DETROIT', 'RAIL', 'NS DETROIT', 'NS - DETROIT', '2725 Livernois', NULL, 'Detroit', 'MI', '48209'),
-- GREATER FL
('US', 'GREATER FL', 'MARINE', 'PORT MANATEE', 'PORT MANATEE', '300 Tampa Bay Way', NULL, 'Palmetto', 'FL', '34221'),
('US', 'GREATER FL', 'MARINE', 'PORT PANAMA CITY', 'PORT PANAMA CITY', '1801 B Ave', NULL, 'Panama City', 'FL', '32401'),
('US', 'GREATER FL', 'MARINE', 'PORT TAMPA BAY', 'PORT TAMPA BAY', '2802 Guy N Verger Blvd', NULL, 'Tampa', 'FL', '33605'),
('US', 'GREATER FL', 'RAIL', 'CSX TAMPA', 'CSX - TAMPA', '1901 North 62nd Street', NULL, 'Tampa', 'FL', '33619'),
('US', 'GREATER FL', 'RAIL', 'CSX WINTER HAVEN', 'CSX - WINTER HAVEN', '3935 Intermodal Drive', NULL, 'Winter Haven', 'FL', '33884'),
('US', 'GREATER FL', 'RAIL', 'FEC TITUSVILLE', 'FEC - TITUSVILLE', '3686 Tico Road', NULL, 'Titusville', 'FL', '32780'),
-- GREATER NY
('US', 'GREATER NY', 'RAIL', 'CSX BLASDELL', 'CSX - BLASDELL', '257 Lake Ave', NULL, 'Blasdell', 'NY', '14219'),
('US', 'GREATER NY', 'RAIL', 'CSX EAST SYRACUSE', 'CSX - EAST SYRACUSE', '600 Freedom Rd', NULL, 'East Syracuse', 'NY', '13057'),
('US', 'GREATER NY', 'RAIL', 'NS BUFFALO', 'NS - BUFFALO', '500 Bison Parkway', NULL, 'Buffalo', 'NY', '14227'),
('US', 'GREATER NY', 'RAIL', 'NS MECHANICVILLE', 'NS - MECHANICVILLE', '50 Route 67', NULL, 'Mechanicville', 'NY', '12118'),
-- GREATER TX
('US', 'GREATER TX', 'RAIL', 'BNSF EL PASO', 'BNSF - EL PASO', '805 S. Santa Fe St', NULL, 'El Paso', 'TX', '79901'),
('US', 'GREATER TX', 'RAIL', 'KCS LAREDO', 'KCS - LAREDO', '604 Serrano Road', NULL, 'Laredo', 'TX', '78046'),
('US', 'GREATER TX', 'RAIL', 'UP DONNA', 'UP - DONNA', '100 N. Whalen Rd.', NULL, 'Donna', 'TX', '78537'),
('US', 'GREATER TX', 'RAIL', 'UP EL PASO', 'UP - EL PASO', '211 N Piedras St', NULL, 'El Paso', 'TX', '79905'),
('US', 'GREATER TX', 'RAIL', 'UP LAREDO', 'UP - LAREDO', '12101 Jim Youn Way', NULL, 'Laredo', 'TX', '78045'),
('US', 'GREATER TX', 'RAIL', 'UP SANTA TERESA', 'UP - SANTA TERESA', '9050 Strauss Road', NULL, 'Santa Teresa', 'NM', '88008'),
('US', 'GREATER TX', 'RAIL', 'UP VON ORMY', 'UP - VON ORMY', '13001 IH-35 South', NULL, 'Von Ormy', 'TX', '78073'),
-- HOUSTON
('US', 'HOUSTON', 'MARINE', 'BARBOURS CUT TERMINALS', 'BARBOURS CUT TERMINALS', '1515 E. Barbours Cut Boulevard', NULL, 'La Porte', 'TX', '77571'),
('US', 'HOUSTON', 'MARINE', 'BAYPORT TERMINAL', 'BAYPORT TERMINAL', '12855 Port Road', NULL, 'Seabrook', 'TX', '77586'),
('US', 'HOUSTON', 'MARINE', 'JACINTO PORT INTERNATIONAL', 'JACINTO PORT INTERNATIONAL', '16398 Jacintoport Boulevard', NULL, 'Houston', 'TX', '77015'),
('US', 'HOUSTON', 'MARINE', 'MANCHESTER', 'MANCHESTER TERMINAL', '10001 Manchester St', NULL, 'Houston', 'TX', '77012'),
('US', 'HOUSTON', 'MARINE', 'PORT FREEPORT', 'PORT FREEPORT', '1001 Navigation Blvd.', NULL, 'Freeport', 'TX', NULL),
('US', 'HOUSTON', 'RAIL', 'BNSF HOUSTON', 'BNSF - HOUSTON', '215 Brisbane Road', NULL, 'Houston', 'TX', '77061'),
('US', 'HOUSTON', 'RAIL', 'KCS BEASLEY', 'KCS - BEASLEY', '11538 Gin Road', NULL, 'Beasley', 'TX', '77417'),
('US', 'HOUSTON', 'RAIL', 'UP HOUSTON', 'UP - HOUSTON', '6800 Kirkpatrick Blvd', NULL, 'Houston', 'TX', '77028'),
-- INDIANA
('US', 'INDIANA', 'RAIL', 'CN INDIANAPOLIS', 'CN - INDIANAPOLIS', '1585 S. Senate Ave.', NULL, 'Indianapolis', 'IN', '46225'),
('US', 'INDIANA', 'RAIL', 'CSX AVON', 'CSX - AVON', '501 S. County Road 800E', NULL, 'Avon', 'IN', '46123'),
('US', 'INDIANA', 'RAIL', 'CSX INDIANAPOLIS', 'CSX - INDIANAPOLIS', '1500 South Senate Avenue', NULL, 'Indianapolis', 'IN', '46225'),
-- JACKSONVILLE
('US', 'JACKSONVILLE', 'MARINE', 'PORT OF FERNANDINA', 'PORT OF FERNANDINA', '315 N 2nd St', NULL, 'Fernandina Beach', 'FL', '32034'),
('US', 'JACKSONVILLE', 'MARINE', 'SSA JACKSONVILLE', 'SSA - JACKSONVILLE', '5800 William Mills St.', NULL, 'Jacksonville', 'FL', '32226'),
('US', 'JACKSONVILLE', 'MARINE', 'TMT JACKSONVILLE', 'TALLYRAND MARINE TERMINAL - JACKSONVILLE', '2085 Talleyrand Ave.', NULL, 'Jacksonville', 'FL', '32206'),
('US', 'JACKSONVILLE', 'MARINE', 'TOTE JACKSONVILLE', 'TOTE - JACKSONVILLE', '5250 William Mills St.', NULL, 'Jacksonville', 'FL', '32226'),
('US', 'JACKSONVILLE', 'MARINE', 'TRAILER BRIDGE JACKSONVILLE', 'TRAILER BRIDGE - JACKSONVILLE', '5090 William Mills St.', NULL, 'Jacksonville', 'FL', '32226'),
('US', 'JACKSONVILLE', 'MARINE', 'TRAPAC JACKSONVILLE', 'TRAPAC - JACKSONVILLE', '9834 New Berlin Rd', NULL, 'Jacksonville', 'FL', NULL),
('US', 'JACKSONVILLE', 'RAIL', 'CSX JACKSONVILLE NEW BERLIN', 'CSX - JACKSONVILLE NEW BERLIN', '9600 New Berlin Rd', NULL, 'Jacksonville', 'FL', NULL),
('US', 'JACKSONVILLE', 'RAIL', 'CSX JACKSONVILLE', 'CSX - JACKSONVILLE', '5902 Sportsman Club Road', NULL, 'Jacksonville', 'FL', '32219'),
('US', 'JACKSONVILLE', 'RAIL', 'FEC JACKSONVILLE', 'FEC - JACKSONVILLE', '7150 Phillips Hwy', NULL, 'Jacksonville', 'FL', '32216'),
('US', 'JACKSONVILLE', 'RAIL', 'NS JACKSONVILLE', 'NS - JACKSONVILLE', '6098 Soutel Drive', NULL, 'Jacksonville', 'FL', '32219'),
-- KANSAS CITY
('US', 'KANSAS CITY', 'RAIL', 'BNSF EDGERTON', 'BNSF - EDGERTON', '34500 W 199th St.', NULL, 'Edgerton', 'KS', '66021'),
('US', 'KANSAS CITY', 'RAIL', 'CSX KANSAS CITY', 'CSX - KANSAS CITY', '3301 East 147th Street', NULL, 'Kansas City', 'MO', '64147'),
('US', 'KANSAS CITY', 'RAIL', 'CP KANSAS CITY', 'CP KANSAS CITY', '3301 E 147th Street', NULL, 'Kansas City', 'MO', '64147'),
('US', 'KANSAS CITY', 'RAIL', 'NS KANSAS CITY', 'NS - KANSAS CITY', '4800 N. Kimball Drive', NULL, 'Kansas City', 'MO', '64161'),
('US', 'KANSAS CITY', 'RAIL', 'UP KANSAS CITY', 'UP - KANSAS CITY', '4801 Gardner Avenue', NULL, 'Kansas City', 'MO', '64120'),
-- KENTUCKY
('US', 'KENTUCKY', 'RAIL', 'CSX LOUISVILLE', 'CSX - LOUISVILLE', '8021 National Turnpike', NULL, 'Louisville', 'KY', '40214'),
('US', 'KENTUCKY', 'RAIL', 'NS LOUISVILLE', 'NS - LOUISVILLE', '4913 Heller St.', NULL, 'Louisville', 'KY', '40218'),
-- LA/LB
('US', 'LA/LB', 'MARINE', 'APM LOS ANGELES', 'APM - LOS ANGELES', '2500 Navy Way', NULL, 'Los Angeles', 'CA', '90731'),
('US', 'LA/LB', 'MARINE', 'EVERPORT TERMINAL ISLAND', 'EVERPORT - TERMINAL ISLAND', '389 Terminal Way', NULL, 'Terminal Island', 'CA', '90731'),
('US', 'LA/LB', 'MARINE', 'FENIX', 'FENIX - TERMINAL ISLAND', '614 Terminal Way', NULL, 'Terminal Island', 'CA', '90731'),
('US', 'LA/LB', 'MARINE', 'ITS LONG BEACH', 'ITS TERMINAL - LONG BEACH', '1281 Pier G Way', NULL, 'Long Beach', 'CA', '90802'),
('US', 'LA/LB', 'MARINE', 'LBCT', 'LBCT - LONG BEACH CONTAINER TERMINAL', '1171 Pier 1 Avenue', NULL, 'Long Beach', 'CA', '90802'),
('US', 'LA/LB', 'MARINE', 'MATSON', 'MATSON TERMINAL - LONG BEACH', '320 Pier C St.', NULL, 'Long Beach', 'CA', '90813'),
('US', 'LA/LB', 'MARINE', 'PASHA', 'PASHA STEVEDORING - WILMINGTON', '802 S. Fries Avenue - LA Harbor', NULL, 'Wilmington', 'CA', '90744'),
('US', 'LA/LB', 'MARINE', 'PCT', 'PCT LONG BEACH', '1512 Pier J Avenue', NULL, 'Long Beach', 'CA', '90802'),
('US', 'LA/LB', 'MARINE', 'PIER A', 'PIER A / SSA - LONG BEACH', '700 Pier A Plaza', NULL, 'Long Beach', 'CA', '90813'),
('US', 'LA/LB', 'MARINE', 'PORT OF HUENEME', 'PORT OF HUENEME', '333 Ponoma Street', NULL, 'Port Hueneme', 'CA', '93044'),
('US', 'LA/LB', 'MARINE', 'TRAPAC WILMINGTON', 'TRAPAC - WILMINGTON', '920 West Harry Bridges Blvd', NULL, 'Wilmington', 'CA', '90744'),
('US', 'LA/LB', 'MARINE', 'TTI', 'TTI - LONG BEACH', '301 Mediterranean Way', NULL, 'Long Beach', 'CA', '90802'),
('US', 'LA/LB', 'MARINE', 'WBCT', 'WBCT - SAN PEDRO', '2050 John S. Gibson Blvd.', NULL, 'San Pedro', 'CA', NULL),
('US', 'LA/LB', 'MARINE', 'YTI', 'YTI - TERMINAL ISLAND', '701 New Dock St.', NULL, 'Terminal Island', 'CA', '90731'),
('US', 'LA/LB', 'RAIL', 'BNSF BARSTOW', 'BNSF - BARSTOW', '2825 W. Main St.', NULL, 'Barstow', 'CA', NULL),
('US', 'LA/LB', 'RAIL', 'BNSF COMMERCE 26TH STREET', 'BNSF - COMMERCE (26TH)', '5600 Eastern 26th Street', NULL, 'Commerce', 'CA', '90040'),
('US', 'LA/LB', 'RAIL', 'BNSF COMMERCE WASHINGTON BLVD', 'BNSF - COMMERCE (WASHINGTON)', '3770 E. Washington Blvd', NULL, 'City of Commerce', 'CA', '90023'),
('US', 'LA/LB', 'RAIL', 'BNSF SAN BERNARDINO', 'BNSF - SAN BERNARDINO', '1535 W. 4th Street', NULL, 'San Bernardino', 'CA', '92411'),
('US', 'LA/LB', 'RAIL', 'UP CITY OF INDUSTRY', 'UP - CITY OF INDUSTRY', '650 South Stimson Avenue', NULL, 'City of Industry', 'CA', '91745'),
('US', 'LA/LB', 'RAIL', 'UP COMMERCE', 'UP - COMMERCE', '4341 E. Washington Blvd', NULL, 'City of Commerce', 'CA', '90023'),
('US', 'LA/LB', 'RAIL', 'UP FONTANA', 'UP - FONTANA', '17550 Slover Avenue', NULL, 'Fontana', 'CA', '92316'),
('US', 'LA/LB', 'RAIL', 'UP LONG BEACH', 'UP - LONG BEACH', '2401 E. Sepulveda Blvd.', NULL, 'Long Beach', 'CA', '90810'),
('US', 'LA/LB', 'RAIL', 'UP LOS ANGELES', 'UP - LOS ANGELES', '750 Lamar Street', NULL, 'Los Angeles', 'CA', '90031'),
('US', 'LA/LB', 'MARINE', 'EMODAL', 'EMODAL', '1 World Way', NULL, 'Los Angeles', 'CA', '90045'),
-- MAINE
('US', 'MAINE', 'MARINE', 'IMT PORTLAND', 'IMT - PORTLAND', '460 Commercial Street', NULL, 'Portland', 'ME', '04101'),
-- MEMPHIS
('US', 'MEMPHIS', 'RAIL', 'BNSF MEMPHIS', 'BNSF - MEMPHIS', '4814 Lamar Ave.', NULL, 'Memphis', 'TN', '38109'),
('US', 'MEMPHIS', 'RAIL', 'CN MEMPHIS', 'CN - MEMPHIS', '2804 Paul R. Lowry Road', NULL, 'Memphis', 'TN', '38109'),
('US', 'MEMPHIS', 'RAIL', 'CSX MEMPHIS', 'CSX - MEMPHIS', '3588 Paul R. Lowry Road', NULL, 'Memphis', 'TN', '38109'),
('US', 'MEMPHIS', 'RAIL', 'CSX NASHVILLE', 'CSX - NASHVILLE', '3086 Sidco Dr.', NULL, 'Nashville', 'TN', '37204'),
('US', 'MEMPHIS', 'RAIL', 'NS ROSSVILLE', 'NS - ROSSVILLE', '3000 Norfolk Southern Way', NULL, 'Rossville', 'TN', '38066'),
('US', 'MEMPHIS', 'RAIL', 'UP MARION', 'UP - MARION', '500 Kuhn Rd.', NULL, 'Marion', 'AR', '72364'),
('US', 'MEMPHIS', 'RAIL', 'UP MEMPHIS', 'UP - MEMPHIS', '911 Rayner St.', NULL, 'Memphis', 'TN', '38114'),
-- MIAMI
('US', 'MIAMI', 'MARINE', 'FIT', 'FIT - FLORIDA INTERNATIONAL TERMINAL', '3800 McIntosh Rd.', NULL, 'Port Everglades', 'FL', '33316'),
('US', 'MIAMI', 'MARINE', 'PET', 'PET - PORT EVERGLADES TERMINAL', '1850 Eller Drive', NULL, 'Fort Lauderdale', 'FL', '33316'),
('US', 'MIAMI', 'MARINE', 'POMTOC', 'POMTOC - PORT OF MIAMI TERMINAL', '2299 Port Boulevard', NULL, 'Miami', 'FL', '33132'),
('US', 'MIAMI', 'MARINE', 'SFCT', 'SFCT - South Florida Container Terminal', '2650 Port Boulevard', NULL, 'Miami', 'FL', '33132'),
('US', 'MIAMI', 'RAIL', 'CSX MIAMI', 'CSX - MIAMI', '7300 NW 69th Avenue', NULL, 'Miami', 'FL', '33166'),
('US', 'MIAMI', 'RAIL', 'FEC FT LAUDERDALE', 'FEC - FT LAUDERDALE', '1500 Eller Drive', NULL, 'Ft. Lauderdale', 'FL', '33316'),
('US', 'MIAMI', 'RAIL', 'FEC FT PIERCE', 'FEC - FT PIERCE', '353 Florida Avenue', NULL, 'Ft. Pierce', 'FL', '34950'),
('US', 'MIAMI', 'RAIL', 'FEC MIAMI', 'FEC - MIAMI', '7300 NW 69th Avenue', NULL, 'Miami', 'FL', '33166'),
('US', 'MIAMI', 'RAIL', 'FEC WEST PALM BEACH', 'FEC - WEST PALM BEACH', '603 15th Street', NULL, 'West Palm Beach', 'FL', '33401'),
('US', 'MIAMI', 'RAIL', 'NS MIAMI', 'CTX - MIAMI', '7300 NW 69th Avenue', NULL, 'Miami', 'FL', '33166'),
-- MINNESOTA
('US', 'MINNESOTA', 'RAIL', 'BNSF ST PAUL', 'BNSF - ST PAUL', '1701 Pierce Butler Route', NULL, 'St. Paul', 'MN', '55104'),
('US', 'MINNESOTA', 'RAIL', 'CN DULUTH', 'CN - DULUTH', '1310 Port Terminal Drive', NULL, 'Duluth', 'MN', '55802'),
('US', 'MINNESOTA', 'RAIL', 'CN NEW RICHMOND', 'CN - NEW RICHMOND', '1099 Business Hwy 64', NULL, 'New Richmond', 'WI', '54017'),
('US', 'MINNESOTA', 'RAIL', 'CP MINNEAPOLIS', 'CP - MINNEAPOLIS', '2800 Central Ave NE', NULL, 'Minneapolis', 'MN', '55418'),
('US', 'MINNESOTA', 'RAIL', 'UP MINNEAPOLIS', 'UP - MINNEAPOLIS', '525 Kasota Avenue SE', NULL, 'Minneapolis', 'MN', '55414'),
-- MISSISSIPPI
('US', 'MISSISSIPPI', 'MARINE', 'PORT OF GULFPORT', 'PORT OF GULFPORT', '30th Avenue South Extension West Pier', NULL, 'Gulfport', 'MS', '39501'),
-- NEBRASKA
('US', 'NEBRASKA', 'RAIL', 'BNSF OMAHA', 'BNSF - OMAHA', '4370 Gibson Road', NULL, 'Omaha', 'NE', '68107'),
('US', 'NEBRASKA', 'RAIL', 'UP COUNCIL BLUFFS', 'UP - COUNCIL BLUFFS', '2722 South Ave', NULL, 'Council Bluffs', 'IA', '51501'),
-- NEVADA
('US', 'NEVADA', 'RAIL', 'UP LAS VEGAS', 'UP - LAS VEGAS', '4740 Tropical Parkway', NULL, 'Las Vegas', 'NV', '89030'),
('US', 'NEVADA', 'RAIL', 'UP SPARKS', 'UP - SPARKS', '1151 Nugget Avenue', NULL, 'Sparks', 'NV', '89431'),
-- NEW ORLEANS
('US', 'NEW ORLEANS', 'MARINE', 'NEW ORLEANS TERMINAL', 'NEW ORLEANS TERMINAL', '50 Napoleon Ave', NULL, 'New Orleans', 'LA', '70115'),
('US', 'NEW ORLEANS', 'MARINE', 'PORT OF NEW ORLEANS', 'PORT OF NEW ORLEANS', '1350 Port of New Orleans Place', NULL, 'New Orleans', 'LA', '70115'),
('US', 'NEW ORLEANS', 'RAIL', 'CN HARAHAN', 'CN - HARAHAN', '2351 Hickory Avenue', NULL, 'Harahan', 'LA', '70123'),
('US', 'NEW ORLEANS', 'RAIL', 'CSX NEW ORLEANS', 'CSX - NEW ORLEANS', '7801 Almonaster Ave.', NULL, 'New Orleans', 'LA', '70126'),
('US', 'NEW ORLEANS', 'RAIL', 'NS NEW ORLEANS', 'NS - NEW ORLEANS', '2900 Florida Avenue', NULL, 'New Orleans', 'LA', '70117'),
('US', 'NEW ORLEANS', 'RAIL', 'UP AVONDALE', 'UP - AVONDALE', '100 Avondale Garden Road', NULL, 'Avondale', 'LA', '70094'),
-- NORTH CAROLINA
('US', 'NORTH CAROLINA', 'MARINE', 'PORT WILMINGTON NC', 'PORT OF WILMINGTON, NC', '1 Shipyard Blvd', NULL, 'Wilmington', 'NC', NULL),
('US', 'NORTH CAROLINA', 'RAIL', 'CIP CHARLOTTE', 'CIP - CHARLOTTE INLAND PORT', '1301 Exchange Street', NULL, 'Charlotte', 'NC', '28412'),
('US', 'NORTH CAROLINA', 'RAIL', 'CSX BATTLEBORO', 'CSX - BATTLEBORO', '5770 Old Battleboro Road', NULL, 'Battleboro', 'NC', '27809'),
('US', 'NORTH CAROLINA', 'RAIL', 'CSX CHARLOTTE', 'CSX - CHARLOTTE', '5430 Hovis Road', NULL, 'Charlotte', 'NC', '28208'),
('US', 'NORTH CAROLINA', 'RAIL', 'NS CHARLOTTE', 'NS - CHARLOTTE', '5710 West Boulevard', NULL, 'Charlotte', 'NC', '28208'),
('US', 'NORTH CAROLINA', 'RAIL', 'NS GREENSBORO', 'NS - GREENSBORO', '1105 Merritt Drive', NULL, 'Greensboro', 'NC', '27407'),
-- NY/NJ
('US', 'NY/NJ', 'MARINE', 'APM ELIZABETH', 'APM - ELIZABETH', '5080 McLester Street', NULL, 'Elizabeth', 'NJ', '07207'),
('US', 'NY/NJ', 'MARINE', 'GCT BAYONNE', 'GCT - BAYONNE', '302 Port Jersey Blvd.', NULL, 'Jersey City', 'NJ', '07305'),
('US', 'NY/NJ', 'MARINE', 'GCT NY', 'GCT - NY', '300 Western Avenue', NULL, 'Staten Island', 'NY', '10303'),
('US', 'NY/NJ', 'MARINE', 'MAHER ELIZABETH', 'MAHER - ELIZABETH', '1210 Corbin Street', NULL, 'Elizabeth', 'NJ', '07201'),
('US', 'NY/NJ', 'MARINE', 'PNCT NEWARK', 'PNCT - NEWARK', '241 Calcutta Street', NULL, 'Newark', 'NJ', '07114'),
('US', 'NY/NJ', 'MARINE', 'RED HOOK BROOKLYN', 'RED HOOK - BROOKLYN', '70 Hamilton Ave # 8', NULL, 'Brooklyn', 'NY', '11231'),
('US', 'NY/NJ', 'MARINE', 'RED HOOK NEWARK', 'RED HOOK - NEWARK', '138 Marsh Street', NULL, 'Newark', 'NJ', '07114'),
('US', 'NY/NJ', 'RAIL', 'CSX ELIZABETH', 'CSX - ELIZABETH', 'Port Newark/Elizabeth Marine Complex', NULL, 'Elizabeth', 'NJ', '07201'),
('US', 'NY/NJ', 'RAIL', 'CSX KEARNY', 'CSX - KEARNY', '700 Old Fish House Road', NULL, 'South Kearny', 'NJ', '07032'),
('US', 'NY/NJ', 'RAIL', 'CSX NORTH BERGEN 83RD', 'CSX - NORTH BERGEN (83RD)', '2200 83rd Street', NULL, 'North Bergen', 'NJ', '07047'),
('US', 'NY/NJ', 'RAIL', 'CSX NORTH BERGEN TONNELLE', 'CSX - NORTH BERGEN (TONNELLE AVE)', '6201 Tonnelle Avenue', NULL, 'North Bergen', 'NJ', '07047'),
('US', 'NY/NJ', 'RAIL', 'NS ELIZABETH PORT NEWARK', 'NS - ELIZABETH (PORT NEWARK)', 'Port Newark/Elizabeth Marine Complex', NULL, 'Elizabeth', 'NJ', '07201'),
('US', 'NY/NJ', 'RAIL', 'NS ELIZABETH THIRD ST', 'NS - ELIZABETH (THIRD ST)', '322 Third Street', NULL, 'Elizabeth', 'NJ', '07206'),
('US', 'NY/NJ', 'RAIL', 'NS JERSEY CITY', 'NS - JERSEY CITY', '125 County Road', NULL, 'Jersey City', 'NJ', '07307'),
-- OAKLAND
('US', 'OAKLAND', 'MARINE', 'EVERPORT OAKLAND', 'EVERPORT - OAKLAND', '5190 7th Street', NULL, 'Oakland', 'CA', '94607'),
('US', 'OAKLAND', 'MARINE', 'MATSON OAKLAND', 'MATSON - OAKLAND', '1579 Middle Harbour Rd', NULL, 'Oakland', 'CA', '94607'),
('US', 'OAKLAND', 'MARINE', 'OICT OAKLAND', 'OICT - OAKLAND INTERNATIONAL CONTAINER TERMINAL', '1717 Middle Harbor Road', NULL, 'Oakland', 'CA', '94607'),
('US', 'OAKLAND', 'MARINE', 'PTSC OAKLAND', 'PTSC - HOWARD TERMINAL', '1 Market St', NULL, 'Oakland', 'CA', '94607'),
('US', 'OAKLAND', 'MARINE', 'TRAPAC OAKLAND', 'TRAPAC - OAKLAND', '2800 7th Street - Berth 30', NULL, 'Oakland', 'CA', '94607'),
('US', 'OAKLAND', 'RAIL', 'BNSF OAKLAND', 'BNSF - OAKLAND', '333 Maritime St.', NULL, 'Oakland', 'CA', '94607'),
('US', 'OAKLAND', 'RAIL', 'BNSF STOCKTON', 'BNSF - STOCKTON', '6540 S Austin Road', NULL, 'Stockton', 'CA', NULL),
('US', 'OAKLAND', 'RAIL', 'UP FRENCH CAMP', 'UP - FRENCH CAMP', '1000 E. Roth Road', NULL, 'French Camp', 'CA', NULL),
('US', 'OAKLAND', 'RAIL', 'UP OAKLAND', 'UP - OAKLAND', '1776 Middle Harbor Road', NULL, 'Oakland', 'CA', '94607'),
-- OHIO
('US', 'OHIO', 'RAIL', 'CSX CINCINNATI', 'CSX - CINCINNATI', '2149 Western Avenue', NULL, 'Cincinnati', 'OH', '45214'),
('US', 'OHIO', 'RAIL', 'CSX CLEVELAND', 'CSX - CLEVELAND', '601 East 152nd Street', NULL, 'Cleveland', 'OH', '44110'),
('US', 'OHIO', 'RAIL', 'CSX COLUMBUS', 'CSX - COLUMBUS', '2351 Westbelt Drive', NULL, 'Columbus', 'OH', '43228'),
('US', 'OHIO', 'RAIL', 'CSX MARION', 'CSX - MARION', '3007 Harding Hwy. East', NULL, 'Marion', 'OH', '43302'),
('US', 'OHIO', 'RAIL', 'CSX NORTH BALTIMORE', 'CSX - NORTH BALTIMORE', '17000 Deshler Rd', NULL, 'North Baltimore', 'OH', '45872'),
('US', 'OHIO', 'RAIL', 'NS CINCINNATI', 'NS - CINCINNATI', '1400 Gest Street', NULL, 'Cincinnati', 'OH', '45203'),
('US', 'OHIO', 'RAIL', 'NS COLUMBUS', 'NS - COLUMBUS', '3329 Thoroughbred Drive', NULL, 'Columbus', 'OH', '43217'),
('US', 'OHIO', 'RAIL', 'NS MAPLE HEIGHTS', 'NS - MAPLE HEIGHTS', '5300 Greenhurst Drive', NULL, 'Maple Heights', 'OH', '44137'),
('US', 'OHIO', 'RAIL', 'NS SHARONVILLE', 'NS - SHARONVILLE', '3155 E. Sharon Road', NULL, 'Sharonville', 'OH', '45241'),
('US', 'OHIO', 'RAIL', 'NS TOLEDO', 'NS - TOLEDO', '2101 Hill Street', NULL, 'Toledo', 'OH', '43607'),
-- OREGON
('US', 'OREGON', 'MARINE', 'PORT PORTLAND', 'PORT PORTLAND', '7201 N. Marine Dr.', NULL, 'Portland', 'OR', '97203'),
('US', 'OREGON', 'RAIL', 'BNSF PORTLAND', 'BNSF - PORTLAND', '3930 NW Yeon Avenue', NULL, 'Portland', 'OR', '97210'),
('US', 'OREGON', 'RAIL', 'UP PORTLAND', 'UP - PORTLAND', '5424 SE McLoughlin Blvd.', NULL, 'Portland', 'OR', '97202'),
-- PHILADELPHIA
('US', 'PHILADELPHIA', 'MARINE', 'PACKER MARINE', 'PACKER MARINE TERMINAL', '3301 S Christopher Columbus Blvd', NULL, 'Philadelphia', 'PA', '19148'),
('US', 'PHILADELPHIA', 'MARINE', 'PENN EDDYSTONE', 'PENN TERMINALS', '1 Saville Avenue', NULL, 'Eddystone', 'PA', '19022'),
('US', 'PHILADELPHIA', 'MARINE', 'PORT WILMINGTON DE', 'PORT OF WILMINGTON, DE', '1 Hausel Road', NULL, 'Wilmington', 'DE', NULL),
('US', 'PHILADELPHIA', 'RAIL', 'CSX CHAMBERSBURG', 'CSX - CHAMBERSBURG', '700 Kriner Road', NULL, 'Chambersburg', 'PA', '17202'),
('US', 'PHILADELPHIA', 'RAIL', 'CSX PHILADELPHIA', 'CSX - PHILADELPHIA', '3400 South Christopher Columbus Blvd.', NULL, 'Philadelphia', 'PA', NULL),
('US', 'PHILADELPHIA', 'RAIL', 'NS BETHLEHEM', 'NS BETHLEHEM', '1650 Riverside Drive', NULL, 'Bethlehem', 'PA', '18015'),
('US', 'PHILADELPHIA', 'RAIL', 'NS GREENCASTLE', 'NS - GREENCASTLE', '612 Adrian Commons Drive', NULL, 'Greencastle', 'PA', '17225'),
('US', 'PHILADELPHIA', 'RAIL', 'NS HARRISBURG INDUSTRIAL RD', 'NS - HARRISBURG (INDUSTRIAL RD)', '3500 Industrial Road', NULL, 'Harrisburg', 'PA', '17110'),
('US', 'PHILADELPHIA', 'RAIL', 'NS HARRISBURG PAXTON ST', 'NS - HARRISBURG (PAXTON ST)', '5050 Paxton Street', NULL, 'Harrisburg', 'PA', '17111'),
('US', 'PHILADELPHIA', 'RAIL', 'NS LANGHORNE', 'NS - LANGHORNE', '98 Cabot Blvd. East', NULL, 'Langhorne', 'PA', '19047'),
('US', 'PHILADELPHIA', 'RAIL', 'NS TAYLOR', 'NS - TAYLOR', '268 N Main St', NULL, 'Taylor', 'PA', '18517'),
('US', 'PHILADELPHIA', 'RAIL', 'NS WALL', 'NS - WALL', '701 Wall Road', NULL, 'Wall', 'PA', '15148'),
-- SAVANNAH
('US', 'SAVANNAH', 'MARINE', 'GCT SAVANNAH', 'GCT - SAVANNAH', '4 Main Street', NULL, 'Savannah', 'GA', NULL),
('US', 'SAVANNAH', 'MARINE', 'OT SAVANNAH', 'OT - SAVANNAH', '902 Louisville Road', NULL, 'Savannah', 'GA', NULL),
('US', 'SAVANNAH', 'RAIL', 'CSX SAVANNAH', 'CSX - SAVANNAH', '3000 Tremont Road', NULL, 'Savannah', 'GA', '31415'),
('US', 'SAVANNAH', 'RAIL', 'NS SAVANNAH', 'NS - SAVANNAH', '251 Grange Road', NULL, 'Port Wentworth', 'GA', '31407'),
-- SEATTLE / TACOMA
('US', 'SEATTLE / TACOMA', 'MARINE', 'HUSKY TACOMA', 'HUSKY TERMINAL - TACOMA', '1101 Port of Tacoma Road - Terminal Four', NULL, 'Tacoma', 'WA', '98421'),
('US', 'SEATTLE / TACOMA', 'MARINE', 'PCT TACOMA', 'PCT - TACOMA', '4015 SR-509 N. Frontage Rd.', NULL, 'Tacoma', 'WA', '98421'),
('US', 'SEATTLE / TACOMA', 'MARINE', 'PORT SEATTLE', 'PORT OF SEATTLE', '2711 Alaskan Way', NULL, 'Seattle', 'WA', '98121'),
('US', 'SEATTLE / TACOMA', 'MARINE', 'PORT TACOMA', 'PORT OF TACOMA', '1 Sitcum Way', NULL, 'Tacoma', 'WA', '98447'),
('US', 'SEATTLE / TACOMA', 'MARINE', 'SEATTLE 18', 'TERMINAL 18 - SSA SEATTLE', '1050 SW Spokane St.', NULL, 'Seattle', 'WA', '98134'),
('US', 'SEATTLE / TACOMA', 'MARINE', 'SEATTLE 30', 'TERMINAL 30 - SSA SEATTLE', '2431 East Marginal Way South', NULL, 'Seattle', 'WA', '98134'),
('US', 'SEATTLE / TACOMA', 'MARINE', 'SEATTLE 46', 'TERMINAL 46 - PTSC SEATTLE', '401 Alaskan Way S.', NULL, 'Seattle', 'WA', '98104'),
('US', 'SEATTLE / TACOMA', 'MARINE', 'SEATTLE 5', 'TERMINAL 5 - SSA SEATTLE', '3443 W Marginal Way SW', NULL, 'Seattle', 'WA', '98106'),
('US', 'SEATTLE / TACOMA', 'MARINE', 'SEATTLE Y4', 'TERMINAL Y4 - SSA SEATTLE', '6110 W. Marginal Way SW', NULL, 'Seattle', 'WA', '98106'),
('US', 'SEATTLE / TACOMA', 'MARINE', 'WUT WASHINGTON', 'WUT - WASHINGTON UNITED TERMINAL', '1815 Port of Tacoma Rd.', NULL, 'Tacoma', 'WA', '98421'),
('US', 'SEATTLE / TACOMA', 'RAIL', 'BNSF SEATTLE 51ST', 'BNSF - SEATTLE (51ST)', '12400 51st Place South', NULL, 'Seattle', 'WA', '98178'),
('US', 'SEATTLE / TACOMA', 'RAIL', 'BNSF SEATTLE HANFORD', 'BNSF - SEATTLE (HANFORD)', '45 S. Hanford Street', NULL, 'Seattle', 'WA', '98134'),
('US', 'SEATTLE / TACOMA', 'RAIL', 'BNSF SPOKANE', 'BNSF - SPOKANE', '1800 N. Dickey', NULL, 'Spokane', 'WA', '99211'),
('US', 'SEATTLE / TACOMA', 'RAIL', 'BNSF TACOMA NORTH', 'BNSF - TACOMA NORTH', '711 Port of Tacoma Road', NULL, 'Tacoma', 'WA', '98421'),
('US', 'SEATTLE / TACOMA', 'RAIL', 'BNSF TACOMA SOUTH', 'BNSF - TACOMA (SOUTH)', '1101 Milwaukee Way', NULL, 'Tacoma', 'WA', '98421'),
('US', 'SEATTLE / TACOMA', 'RAIL', 'UP SEATTLE', 'UP - SEATTLE', '4700 Denver Avenue South', NULL, 'Seattle', 'WA', '98134'),
('US', 'SEATTLE / TACOMA', 'RAIL', 'UP TACOMA', 'UP - TACOMA', '1738 Milwaukee Way', NULL, 'Tacoma', 'WA', '98421'),
-- ST LOUIS
('US', 'ST LOUIS', 'RAIL', 'BNSF ST LOUIS', 'BNSF - ST LOUIS', '3500 Wellington Avenue', NULL, 'St. Louis', 'MO', '63139'),
('US', 'ST LOUIS', 'RAIL', 'CSX EAST ST LOUIS', 'CSX - EAST ST LOUIS', '3900 Rose Lake Road', NULL, 'East St. Louis', 'IL', NULL),
('US', 'ST LOUIS', 'RAIL', 'NS ST LOUIS', 'NS - ST LOUIS', '7021 Hall Street', NULL, 'St. Louis', 'MO', '63147'),
('US', 'ST LOUIS', 'RAIL', 'UP DUPO', 'UP - DUPO', 'Highway 3 & State Street', NULL, 'Dupo', 'IL', '62239'),
-- UTAH
('US', 'UTAH', 'RAIL', 'BNSF SALT LAKE CITY', 'BNSF SALT LAKE CITY', '6199 West 10000 North Temple Street', NULL, 'Salt Lake City', 'UT', '84116'),
('US', 'UTAH', 'RAIL', 'UP SALT LAKE CITY', 'UP - SALT LAKE CITY', '1045 South 5500 West', NULL, 'Salt Lake City', 'UT', '84104'),
-- VIRGINIA
('US', 'VIRGINIA', 'MARINE', 'NIT', 'NIT - NORFOLK INTERNATIONAL TERMINAL', '7737 Hampton Blvd.', NULL, 'Norfolk', 'VA', '23505'),
('US', 'VIRGINIA', 'MARINE', 'PMT', 'PMT - PORTSMOUTH MARINE TERMINAL', '2000 Seaboard Ave', NULL, 'Portsmouth', 'VA', '23707'),
('US', 'VIRGINIA', 'MARINE', 'RMT', 'RMT - RICHMOND MARINE TERMINAL', '5000 Deepwater Terminal Road', NULL, 'Richmond', 'VA', '23234'),
('US', 'VIRGINIA', 'MARINE', 'VIG', 'VIG - VIRGINIA INTERNATIONAL GATEWAY', '1000 Virginia International Gateway Blvd', NULL, 'Portsmouth', 'VA', '23703'),
('US', 'VIRGINIA', 'MARINE', 'VIT', 'VIT - VIRGINIA INTERNATIONAL TERMINALS', '7737 Hampton Blvd', NULL, 'Norfolk', 'VA', '23505'),
('US', 'VIRGINIA', 'RAIL', 'CSX PORTSMOUTH', 'CSX - PORTSMOUTH', '1 Harper Avenue', NULL, 'Portsmouth', 'VA', '23707'),
('US', 'VIRGINIA', 'RAIL', 'NS CHESAPEAKE', 'NS - CHESAPEAKE', '1710 Atlantic Avenue', NULL, 'Chesapeake', 'VA', '23324'),
('US', 'VIRGINIA', 'RAIL', 'NS FRONT ROYAL', 'NS - FRONT ROYAL', '7685 Winchester Road', NULL, 'Front Royal', 'VA', '22630'),
-- CANADA
('CAN', 'CALGARY', 'RAIL', 'CLP CONRICH', 'CN - CALGARY LOGISTICS PARK (CLP)', '250129 Logistics Parkway', NULL, 'Conrich', 'AB', NULL),
('CAN', 'CALGARY', 'RAIL', 'CN CALGARY', 'CN - CALGARY', '5310-27th Street, SE', NULL, 'Calgary', 'AB', NULL),
('CAN', 'CALGARY', 'RAIL', 'CP CALGARY', 'CP - CALGARY', '11020 52nd St. SE', NULL, 'Calgary', 'AB', NULL),
('CAN', 'EDMONTON', 'RAIL', 'CN EDMONTON', 'CN - EDMONTON', '#4 12311 - 184th Street', NULL, 'Edmonton', 'AB', NULL),
('CAN', 'EDMONTON', 'RAIL', 'CP EDMONTON', 'CP - EDMONTON', '10155 - 39th Ave', NULL, 'Edmonton', 'AB', NULL),
('CAN', 'HALIFAX', 'MARINE', 'PSA HALIFAX', 'PSA - HALIFAX', '577 Marginal Road', NULL, 'Halifax', 'NS', NULL),
('CAN', 'HALIFAX', 'RAIL', 'CN HALIFAX', 'CN - HALIFAX', '3833 Barrington Street', NULL, 'Halifax', 'NS', NULL),
('CAN', 'MONCTON / ST JOHN', 'MARINE', 'PORT OF SAINT JOHN', 'PORT OF SAINT JOHN', '10 King Street West', NULL, 'Saint John', 'NB', NULL),
('CAN', 'MONCTON / ST JOHN', 'RAIL', 'CN MONCTON', 'CN MONCTON', 'Delong Drive', NULL, 'Moncton', 'NB', NULL),
('CAN', 'MONCTON / ST JOHN', 'RAIL', 'CP SAINT JOHN', 'CP - SAINT JOHN', '10 King St. W.', NULL, 'Saint John', 'NB', NULL),
('CAN', 'MONTREAL', 'MARINE', 'MGT CAST', 'CAST - MONTREAL GATEWAY TERMINAL', '305 Rue Curatteau', NULL, 'Montreal', 'QC', NULL),
('CAN', 'MONTREAL', 'MARINE', 'MGT RACINE', 'RACINE - MONTREAL GATEWAY TERMINAL', '305 Rue Curatteau, Shed 57-64', NULL, 'Montreal', 'QC', NULL),
('CAN', 'MONTREAL', 'MARINE', 'TERMONT 52 MONTREAL', 'TERMONT - 52 - MONTREAL', '450 Rue de Boucherville, Secteur 52', NULL, 'Montreal', 'QC', NULL),
('CAN', 'MONTREAL', 'MARINE', 'TERMONT 68 MONTREAL', 'TERMONT - 68 - MONTREAL', '450 Rue de Boucherville, Secteur 68', NULL, 'Montreal', 'QC', NULL),
('CAN', 'MONTREAL', 'RAIL', 'CN MONTREAL', 'CN - MONTREAL', '4500 Hickmore Street', NULL, 'St. Laurent', 'QC', NULL),
('CAN', 'MONTREAL', 'RAIL', 'CP MONTREAL', 'CP - LACHINE', '2250 - 43rd Avenue', NULL, 'Lachine', 'QC', NULL),
('CAN', 'PRINCE GEORGE', 'RAIL', 'CN PRINCE GEORGE', 'CN - PRINCE GEORGE', '855 River Road', NULL, 'Prince George', 'BC', NULL),
('CAN', 'PRINCE RUPERT', 'MARINE', 'PORT PRINCE RUPERT', 'PORT PRINCE RUPERT', '3100 Scott Road', NULL, 'Prince Rupert', 'BC', NULL),
('CAN', 'REGINA', 'RAIL', 'CN REGINA', 'CN - REGINA', '3701 East Bypass Service Road', NULL, 'Regina', 'SK', NULL),
('CAN', 'REGINA', 'RAIL', 'CP REGINA DEWDNEY', 'CP - REGINA (DEWDNEY)', '2271 Dewdney Ave', NULL, 'Regina', 'SK', NULL),
('CAN', 'REGINA', 'RAIL', 'CP REGINA FLEMING', 'CP - REGINA (FLEMING)', '2401 Fleming Road', NULL, 'Regina', 'SK', NULL),
('CAN', 'SASKATOON', 'RAIL', 'CN SASKATOON', 'CN - SASKATOON', '1701 Chappell Drive', NULL, 'Saskatoon', 'SK', NULL),
('CAN', 'THUNDER BAY', 'RAIL', 'CP THUNDER BAY', 'CP - THUNDER BAY', '210 - 110 Avenue', NULL, 'Thunder Bay', 'ON', NULL),
('CAN', 'TORONTO', 'RAIL', 'CN BRAMPTON', 'CN - BRAMPTON', '30 Intermodal Drive', NULL, 'Brampton', 'ON', NULL),
('CAN', 'TORONTO', 'RAIL', 'CN MISSISSAUGA', 'CN - MISSISSAUGA', '7675 Torbram Road', NULL, 'Mississauga', 'ON', NULL),
('CAN', 'TORONTO', 'RAIL', 'CP BRAMPTON', 'CP - BRAMPTON', '76 Intermodal Drive', NULL, 'Brampton', 'ON', NULL),
('CAN', 'TORONTO', 'RAIL', 'CP VAUGHAN', 'CPR - VAUGHAN', '6830 Rutherford Rd', NULL, 'Vaughan', 'ON', NULL),
('CAN', 'VANCOUVER', 'MARINE', 'CENTERM', 'CENTERM - DP WORLD', 'Centennial Road', NULL, 'Vancouver', 'BC', NULL),
('CAN', 'VANCOUVER', 'MARINE', 'DELTAPORT', 'DELTAPORT - GCT CANADA', '2 Roberts Bank Way', NULL, 'Delta', 'BC', NULL),
('CAN', 'VANCOUVER', 'MARINE', 'FRASER SURREY', 'FRASER SURREY - DP WORLD', '11060 Elevator Road', NULL, 'Surrey', 'BC', NULL),
('CAN', 'VANCOUVER', 'MARINE', 'VANTERM', 'VANTERM - GCT CANADA', '1300 Stewart Street', NULL, 'Vancouver', 'BC', NULL),
('CAN', 'VANCOUVER', 'RAIL', 'BNSF NEW WESTMINSTER', 'BNSF - NEW WESTMINSTER', '400 Brunette Ave', NULL, 'New Westminster', 'BC', NULL),
('CAN', 'VANCOUVER', 'RAIL', 'CN VANCOUVER', 'CN - VANCOUVER', '17569 - 104th Avenue', NULL, 'Vancouver', 'BC', NULL),
('CAN', 'VANCOUVER', 'RAIL', 'CP VANCOUVER', 'CP - PITT MEADOWS', '17900 Kennedy Road', NULL, 'Pitt Meadows', 'BC', NULL),
('CAN', 'WINNIPEG', 'RAIL', 'CN WINNIPEG', 'CN - WINNIPEG', '560 Plessis Road', NULL, 'Winnipeg', 'MB', NULL),
('CAN', 'WINNIPEG', 'RAIL', 'CP WINNIPEG', 'CP - WINNIPEG', '611 Keewatin Street', NULL, 'Winnipeg', 'MB', NULL)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Verification
-- ============================================================
SELECT country, COUNT(*) AS terminals FROM system_terminals GROUP BY country ORDER BY country;
SELECT market, type, COUNT(*) FROM system_terminals GROUP BY market, type ORDER BY market, type;
