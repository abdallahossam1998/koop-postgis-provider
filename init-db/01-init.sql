-- Initialize PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create sample cities table for testing
CREATE TABLE IF NOT EXISTS cities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    population INTEGER,
    country VARCHAR(100),
    geom GEOMETRY(POINT, 4326)
);

-- Insert sample data
INSERT INTO cities (name, population, country, geom) VALUES
('New York', 8336817, 'USA', ST_GeomFromText('POINT(-74.006 40.7128)', 4326)),
('Los Angeles', 3979576, 'USA', ST_GeomFromText('POINT(-118.2437 34.0522)', 4326)),
('Chicago', 2693976, 'USA', ST_GeomFromText('POINT(-87.6298 41.8781)', 4326)),
('London', 8982000, 'UK', ST_GeomFromText('POINT(-0.1276 51.5074)', 4326)),
('Paris', 2161000, 'France', ST_GeomFromText('POINT(2.3522 48.8566)', 4326)),
('Tokyo', 13929286, 'Japan', ST_GeomFromText('POINT(139.6917 35.6895)', 4326))
ON CONFLICT DO NOTHING;

-- Create spatial index
CREATE INDEX IF NOT EXISTS idx_cities_geom ON cities USING GIST(geom);

-- Create sample polygon table for testing
CREATE TABLE IF NOT EXISTS countries (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    iso_code VARCHAR(3),
    population BIGINT,
    area_km2 NUMERIC,
    geom GEOMETRY(MULTIPOLYGON, 4326)
);

-- Create spatial index for countries
CREATE INDEX IF NOT EXISTS idx_countries_geom ON countries USING GIST(geom);

-- ========================================
-- RELATIONSHIP TESTING TABLES
-- ========================================

-- Main locations table (parent table)
CREATE TABLE IF NOT EXISTS test_locations (
    location_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    geom GEOMETRY(POINT, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample locations
INSERT INTO test_locations (name, description, geom) VALUES
('Central Park', 'Large urban park in Manhattan', ST_GeomFromText('POINT(-73.9688 40.7812)', 4326)),
('Downtown Plaza', 'Main commercial district plaza', ST_GeomFromText('POINT(-73.9857 40.7484)', 4326)),
('Times Square', 'Famous commercial intersection', ST_GeomFromText('POINT(-73.9857 40.758)', 4326)),
('Brooklyn Bridge Park', 'Waterfront park with city views', ST_GeomFromText('POINT(-73.9969 40.7021)', 4326)),
('High Line Park', 'Elevated linear park', ST_GeomFromText('POINT(-74.0048 40.748)', 4326))
ON CONFLICT DO NOTHING;

-- Buildings table (related to locations)
CREATE TABLE IF NOT EXISTS test_buildings (
    building_id SERIAL PRIMARY KEY,
    location_id INTEGER REFERENCES test_locations(location_id),
    building_name VARCHAR(100) NOT NULL,
    building_type VARCHAR(50),
    floors INTEGER,
    area_sqm NUMERIC(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample buildings
INSERT INTO test_buildings (location_id, building_name, building_type, floors, area_sqm) VALUES
-- Central Park buildings
(1, 'Central Park Visitor Center', 'Public', 2, 1200.50),
(1, 'Park Maintenance Facility', 'Utility', 1, 800.00),
(1, 'Bethesda Terrace Arcade', 'Historic', 2, 2500.75),
-- Downtown Plaza buildings
(2, 'Downtown Office Tower', 'Commercial', 25, 15000.00),
(2, 'Plaza Shopping Center', 'Retail', 3, 8500.25),
(2, 'Municipal Building', 'Government', 8, 5200.00),
-- Times Square buildings
(3, 'Times Square Theater', 'Entertainment', 4, 3200.50),
(3, 'Broadway Hotel', 'Hospitality', 20, 12000.00),
-- Brooklyn Bridge Park buildings
(4, 'Bridge View Restaurant', 'Commercial', 2, 1800.00),
(4, 'Park Pavilion', 'Public', 1, 900.00),
-- High Line Park buildings
(5, 'High Line Gallery', 'Cultural', 3, 2200.00),
(5, 'Elevated Cafe', 'Commercial', 2, 650.00)
ON CONFLICT DO NOTHING;

-- Infrastructure table (related to locations)
CREATE TABLE IF NOT EXISTS test_infrastructure (
    infrastructure_id SERIAL PRIMARY KEY,
    location_id INTEGER REFERENCES test_locations(location_id),
    infrastructure_name VARCHAR(100) NOT NULL,
    infrastructure_type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'Active',
    installation_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample infrastructure
INSERT INTO test_infrastructure (location_id, infrastructure_name, infrastructure_type, status, installation_date) VALUES
-- Central Park infrastructure
(1, 'Water Fountain System', 'Water', 'Active', '2020-03-15'),
(1, 'LED Lighting Network', 'Electrical', 'Active', '2021-06-10'),
(1, 'Security Camera Grid', 'Security', 'Active', '2019-11-20'),
(1, 'WiFi Access Points', 'Telecommunications', 'Active', '2022-01-05'),
-- Downtown Plaza infrastructure
(2, 'Underground Parking System', 'Transportation', 'Active', '2018-09-12'),
(2, 'Fiber Optic Network', 'Telecommunications', 'Active', '2020-07-22'),
(2, 'Storm Drainage System', 'Water', 'Active', '2017-04-18'),
-- Times Square infrastructure
(3, 'Digital Billboard Network', 'Advertising', 'Active', '2021-12-01'),
(3, 'Subway Ventilation System', 'Transportation', 'Active', '2019-08-15'),
-- Brooklyn Bridge Park infrastructure
(4, 'Waterfront Lighting', 'Electrical', 'Active', '2020-05-30'),
(4, 'Pier Support Structure', 'Structural', 'Active', '2016-03-10'),
-- High Line Park infrastructure
(5, 'Elevated Walkway System', 'Transportation', 'Active', '2015-10-20'),
(5, 'Irrigation Network', 'Water', 'Active', '2018-04-25')
ON CONFLICT DO NOTHING;

-- Land use table (related to locations)
CREATE TABLE IF NOT EXISTS test_land_use (
    land_use_id SERIAL PRIMARY KEY,
    location_id INTEGER REFERENCES test_locations(location_id),
    zoning_code VARCHAR(20),
    land_use_type VARCHAR(50),
    area_hectares NUMERIC(10,2),
    designation_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample land use data
INSERT INTO test_land_use (location_id, zoning_code, land_use_type, area_hectares, designation_date) VALUES
(1, 'P-1', 'Recreation', 341.15, '1857-07-21'),
(2, 'C-4', 'Commercial', 2.50, '1920-05-15'),
(3, 'C-6', 'Mixed Commercial', 1.75, '1904-03-20'),
(4, 'P-2', 'Waterfront Recreation', 34.20, '2010-07-15'),
(5, 'P-3', 'Linear Park', 2.33, '2009-06-09')
ON CONFLICT DO NOTHING;

-- Points of interest table (related to locations)
CREATE TABLE IF NOT EXISTS test_points_of_interest (
    poi_id SERIAL PRIMARY KEY,
    location_id INTEGER REFERENCES test_locations(location_id),
    poi_name VARCHAR(100) NOT NULL,
    poi_type VARCHAR(50),
    description TEXT,
    rating NUMERIC(2,1),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample points of interest
INSERT INTO test_points_of_interest (location_id, poi_name, poi_type, description, rating) VALUES
-- Central Park POIs
(1, 'Bethesda Fountain', 'Historic', 'Famous fountain and gathering place', 4.8),
(1, 'Strawberry Fields', 'Memorial', 'John Lennon memorial garden', 4.7),
(1, 'Central Park Zoo', 'Attraction', 'Small zoo in the heart of Manhattan', 4.3),
(1, 'Bow Bridge', 'Historic', 'Iconic cast iron bridge', 4.6),
-- Downtown Plaza POIs
(2, 'City Hall', 'Government', 'Municipal government building', 4.1),
(2, 'Financial District', 'Business', 'Major financial center', 4.2),
-- Times Square POIs
(3, 'TKTS Red Steps', 'Attraction', 'Famous red bleacher steps', 4.4),
(3, 'Times Square Museum', 'Cultural', 'History of Times Square', 4.0),
-- Brooklyn Bridge Park POIs
(4, 'Brooklyn Bridge Promenade', 'Scenic', 'Walking path with city views', 4.9),
(4, 'Jane''s Carousel', 'Attraction', 'Historic merry-go-round', 4.5),  -- FIXED: '' instead of \'
-- High Line Park POIs
(5, 'High Line Overlook', 'Scenic', 'Elevated city viewpoint', 4.7),
(5, 'Chelsea Market Passage', 'Shopping', 'Connection to famous food market', 4.3)
ON CONFLICT DO NOTHING;

-- Create spatial indexes
CREATE INDEX IF NOT EXISTS idx_test_locations_geom ON test_locations USING GIST(geom);

-- Create foreign key indexes for better relationship query performance
CREATE INDEX IF NOT EXISTS idx_test_buildings_location_id ON test_buildings(location_id);
CREATE INDEX IF NOT EXISTS idx_test_infrastructure_location_id ON test_infrastructure(location_id);
CREATE INDEX IF NOT EXISTS idx_test_land_use_location_id ON test_land_use(location_id);
CREATE INDEX IF NOT EXISTS idx_test_points_of_interest_location_id ON test_points_of_interest(location_id);

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
