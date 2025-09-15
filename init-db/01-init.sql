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

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
