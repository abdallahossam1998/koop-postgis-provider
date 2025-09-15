function handleRequest (req, res) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PostGIS Koop Provider</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f8fafc;
            color: #334155;
            line-height: 1.6;
        }
        
        .header {
            background: white;
            border-bottom: 1px solid #e2e8f0;
            padding: 2rem 0;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 1.5rem;
        }
        
        .header-content {
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5rem;
            font-weight: 700;
            color: #1e293b;
            margin-bottom: 0.5rem;
        }
        
        .header p {
            font-size: 1.125rem;
            color: #64748b;
            margin-bottom: 1rem;
        }
        
        .status {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: #dcfce7;
            color: #166534;
            padding: 0.5rem 1rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 500;
        }
        
        .status-dot {
            width: 8px;
            height: 8px;
            background: #22c55e;
            border-radius: 50%;
        }
        
        .main {
            padding: 3rem 0;
        }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
            margin-bottom: 3rem;
        }
        
        .card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 0.75rem;
            padding: 1.5rem;
            transition: all 0.2s;
        }
        
        .card:hover {
            border-color: #3b82f6;
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
        }
        
        .card-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1rem;
        }
        
        .card-icon {
            width: 2.5rem;
            height: 2.5rem;
            background: #eff6ff;
            border-radius: 0.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.25rem;
        }
        
        .card h3 {
            font-size: 1.125rem;
            font-weight: 600;
            color: #1e293b;
        }
        
        .card p {
            color: #64748b;
            margin-bottom: 1rem;
        }
        
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: #3b82f6;
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            text-decoration: none;
            font-size: 0.875rem;
            font-weight: 500;
            transition: background 0.2s;
        }
        
        .btn:hover {
            background: #2563eb;
        }
        
        .btn-secondary {
            background: #f1f5f9;
            color: #475569;
        }
        
        .btn-secondary:hover {
            background: #e2e8f0;
        }
        
        .section {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 0.75rem;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }
        
        .section h2 {
            font-size: 1.25rem;
            font-weight: 600;
            color: #1e293b;
            margin-bottom: 1rem;
        }
        
        .endpoint-list {
            display: grid;
            gap: 0.75rem;
        }
        
        .endpoint {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 0.75rem;
            background: #f8fafc;
            border-radius: 0.5rem;
            border-left: 3px solid #3b82f6;
        }
        
        .method {
            background: #3b82f6;
            color: white;
            padding: 0.25rem 0.5rem;
            border-radius: 0.25rem;
            font-size: 0.75rem;
            font-weight: 600;
            min-width: 3rem;
            text-align: center;
        }
        
        .endpoint-path {
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 0.875rem;
            color: #475569;
        }
        
        .footer {
            text-align: center;
            padding: 2rem 0;
            color: #64748b;
            font-size: 0.875rem;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="container">
            <div class="header-content">
                <h1>PostGIS Koop Provider</h1>
                <p>Transform PostgreSQL spatial data into Esri-compatible REST services</p>
                <div class="status">
                    <div class="status-dot"></div>
                    Service Online
                </div>
            </div>
        </div>
    </div>
    
    <div class="main">
        <div class="container">
            <div class="grid">
                <div class="card">
                    <div class="card-header">
                        <div class="card-icon">📖</div>
                        <h3>API Documentation</h3>
                    </div>
                    <p>Interactive API documentation with examples and schema definitions.</p>
                    <a href="/api-docs" class="btn">View Swagger Docs</a>
                </div>
                
                <div class="card">
                    <div class="card-header">
                        <div class="card-icon">🎯</div>
                        <h3>Quick Test</h3>
                    </div>
                    <p>Test the API with sample city data to get started quickly.</p>
                    <a href="/postgis/rest/services/postgres/public.cities/FeatureServer/0/query?where=1=1&f=json" class="btn">Try Sample Query</a>
                </div>
                
                <div class="card">
                    <div class="card-header">
                        <div class="card-icon">🔧</div>
                        <h3>Database Admin</h3>
                    </div>
                    <p>Manage your PostgreSQL database with pgAdmin interface.</p>
                    <a href="http://localhost:5050" class="btn btn-secondary" target="_blank">Open pgAdmin</a>
                </div>
            </div>
            
            <div class="section">
                <h2>Available Endpoints</h2>
                <div class="endpoint-list">
                    <div class="endpoint">
                        <span class="method">GET</span>
                        <span class="endpoint-path">/postgis/rest/info</span>
                    </div>
                    <div class="endpoint">
                        <span class="method">GET</span>
                        <span class="endpoint-path">/postgis/rest/generateToken</span>
                    </div>
                    <div class="endpoint">
                        <span class="method">GET</span>
                        <span class="endpoint-path">/postgis/rest/services/:host/:id/FeatureServer</span>
                    </div>
                    <div class="endpoint">
                        <span class="method">GET</span>
                        <span class="endpoint-path">/postgis/rest/services/:host/:id/FeatureServer/layers</span>
                    </div>
                    <div class="endpoint">
                        <span class="method">GET</span>
                        <span class="endpoint-path">/postgis/rest/services/:host/:id/FeatureServer/:layer</span>
                    </div>
                    <div class="endpoint">
                        <span class="method">GET</span>
                        <span class="endpoint-path">/postgis/rest/services/:host/:id/FeatureServer/:layer/query</span>
                    </div>
                    <div class="endpoint">
                        <span class="method">GET</span>
                        <span class="endpoint-path">/postgis/rest/services/:host/:id/FeatureServer/:layer/generateRenderer</span>
                    </div>
                    <div class="endpoint">
                        <span class="method">GET</span>
                        <span class="endpoint-path">/postgis/rest/services/:host/:id/FeatureServer/:layer/queryRelatedRecords</span>
                    </div>
                    <div class="endpoint">
                        <span class="method">GET</span>
                        <span class="endpoint-path">/postgis/rest/services/:host/:id/MapServer*</span>
                    </div>
                </div>
            </div>
            
            <div class="section">
                <h2>Quick Examples</h2>
                <div class="grid">
                    <div class="card">
                        <h3>Service Information</h3>
                        <p>Get metadata about available services</p>
                        <a href="/postgis/rest/services/postgres/public.cities/FeatureServer" class="btn btn-secondary">Try It</a>
                    </div>
                    <div class="card">
                        <h3>Layer Details</h3>
                        <p>View layer schema and geometry type</p>
                        <a href="/postgis/rest/services/postgres/public.cities/FeatureServer/0" class="btn btn-secondary">Try It</a>
                    </div>
                    <div class="card">
                        <h3>Spatial Query</h3>
                        <p>Query features with spatial filters</p>
                        <a href="/postgis/rest/services/postgres/public.cities/FeatureServer/0/query?where=population>5000000&f=json" class="btn btn-secondary">Try It</a>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <div class="footer">
        <div class="container">
            <p>Built with Koop.js, PostgreSQL, and PostGIS</p>
        </div>
    </div>
</body>
</html>
  `
  
  res.status(200).send(html)
}

module.exports = handleRequest
