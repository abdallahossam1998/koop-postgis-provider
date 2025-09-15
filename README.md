# PostGIS Koop Provider

Transform PostgreSQL spatial data into Esri-compatible REST services.

## Quick Start

### Docker (Recommended)
```bash
git clone <repository-url> && cd postgis-koop-provider
docker-compose up -d
```

### Local Development
```bash
npm install
cp .env.example .env
npm start
```

## Access Points

- **Welcome Page**: http://localhost:8080/
- **API Documentation**: http://localhost:8080/api-docs
- **Sample Query**: http://localhost:8080/postgis/rest/services/postgres/public.cities/FeatureServer/0/query?where=1=1&f=json
- **pgAdmin**: http://localhost:5050 (admin@example.com / admin)

## API Structure

```
/postgis/rest/services/{host}/{schema}.{table}/FeatureServer/{layer}/query
```

### Key Parameters
- `where` - SQL WHERE clause
- `bbox` - Bounding box filter  
- `outFields` - Fields to return
- `f` - Output format (json, geojson)
- `resultRecordCount` - Limit results

## Common Commands

```bash
# Start services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Database access
docker exec -it koop-postgres psql -U postgres

# Stop services
docker-compose down
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection refused | `docker-compose ps` |
| Empty response | Check database has data |
| Slow queries | Add spatial indexes |

Visit the **Welcome Page** at http://localhost:8080/ for comprehensive test URLs and examples.
