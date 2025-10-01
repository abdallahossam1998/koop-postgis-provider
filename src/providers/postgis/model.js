require('dotenv').config()
const { Pool } = require('pg')
const wellknown = require('wellknown')
const _ = require('lodash')

class Model {
  constructor(options = {}) {
    this.options = options
    this.pool = null
  }

  async pull(request) {
    
    // Check if this is a queryRelatedRecords request
    const isQueryRelatedRecords = (request.url && request.url.includes('queryRelatedRecords')) || 
                                  (request.params && request.params.method === 'queryRelatedRecords')
    
    if (isQueryRelatedRecords) {
      
      // Handle queryRelatedRecords specially
      return new Promise((resolve, reject) => {
        this.getRelatedRecordsData(request, (error, data) => {
          if (error) {
            reject(error)
          } else {
            resolve(data)
          }
        })
      })
    }
    
    // For regular requests, call getData with a callback wrapper
    return new Promise((resolve, reject) => {
      this.getData(request, (error, data) => {
        if (error) {
          reject(error)
        } else {
          resolve(data)
        }
      })
    })
  }

  /**
   * Initialize database connection pool
   */
  async initializePool(config) {
    if (!this.pool) {
      try {
        // Use database connection string from environment variables
        const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
        
        // Create pool with connection string and timeout settings
        this.pool = new Pool({ 
          connectionString,
          connectionTimeoutMillis: 10000, // 10 second connection timeout
          idleTimeoutMillis: 30000,       // 30 second idle timeout
          query_timeout: 30000,           // 30 second query timeout
          // max: 10                         // Maximum 10 connections
        });
        
        // Set up error handler for the pool
        this.pool.on('error', (err) => {
          console.error('PostgreSQL pool error:', err);
        });
        
        // Test the connection
        const client = await this.pool.connect();
        await client.query('SELECT 1');
        client.release();
        console.log('Database connection successful');
        
      } catch (error) {
        console.error('Failed to create connection pool:', error);
        throw new Error(`Failed to create connection pool: ${error.message}`);
      }
    }
    return this.pool;
  }

  /**
   * Main getData method required by Koop
   * @param {Object} request - Express request object
   * @param {Function} callback - Callback function
   */
  async getData(request, callback) {
    try {
      const { params, query } = request
      const { schema, id, layer, method } = params
      
      // Determine the schema name - could be from :schema or :id parameter
      const schemaName = schema || (id && !id.includes('.') ? id : 'public')
      
      // Check if this is a queryRelatedRecords request
      const isQueryRelatedRecords = method === 'queryRelatedRecords' || 
                                   (request.url && request.url.includes('queryRelatedRecords'))
      
      if (isQueryRelatedRecords) {
        return this.getRelatedRecordsData(request, callback)
      }
      
      // Always use default host since we removed host parameter from URLs
      const host = 'default'
      
      // Get database configuration
      const config = this.getDatabaseConfig(host)
      await this.initializePool(config)

      // NEW: Handle multi-layer service - get table name from layer ID
      let tableInfo
      if (layer !== undefined && layer !== null && layer !== '') {
        // Layer ID provided - look up table name
        const layerInfo = await this.getTableByLayerId(schemaName, layer)
        if (!layerInfo) {
          return callback(new Error(`Layer ${layer} not found in schema ${schemaName}`))
        }
        
        tableInfo = {
          schema: schemaName,
          table: layerInfo.tableName,
          geometryColumn: layerInfo.geometryColumn,
          isNonSpatial: !layerInfo.geometryColumn
        }
      } else if (id && id.includes('.')) {
        // OLD: Backward compatibility - schema.table format
        tableInfo = await this.parseTableInfo(id, layer)
      } else {
        // Service-level request without layer ID - get all tables in schema
        const allTables = await this.getAllTablesInSchema(schemaName)
        
        if (allTables.length === 0) {
          return callback(new Error(`No tables found in schema '${schemaName}'. Please check that the schema exists and contains tables.`))
        }
        
        // Return service info in the format Koop's FeatureServer expects
        // Separate spatial layers from non-spatial tables
        const spatialLayers = allTables.filter(t => !t.isTable)
        const nonSpatialTables = allTables.filter(t => t.isTable)
        
        // Return data in the format Koop's serverInfo expects
        // The serverInfo function expects layers and tables at the top level
        const serviceGeojson = {
          type: 'FeatureCollection',
          features: [],
          // TOP-LEVEL arrays that serverInfo will use
          layers: spatialLayers.map(layer => ({
            type: 'FeatureCollection',
            features: [],
            metadata: {
              id: layer.id,
              name: layer.name,
              geometryType: layer.geometryType || 'esriGeometryPoint'
            }
          })),
          tables: nonSpatialTables.map(table => ({
            type: 'FeatureCollection', 
            features: [],
            metadata: {
              id: table.id,
              name: table.name
            }
          })),
          relationships: [],
          // Service metadata
          metadata: {
            name: schemaName,
            description: `Multi-layer service for schema ${schemaName}`,
            serviceDescription: `Multi-layer service for schema ${schemaName}`,
            currentVersion: 11.2,
            hasVersionedData: false,
            supportsDisconnectedEditing: false,
            hasStaticData: false,
            hasSharedDomains: false,
            maxRecordCount: parseInt(process.env.KOOP_MAX_RECORD_COUNT) || 50000,
            supportedQueryFormats: "JSON",
            supportsVCSProjection: false,
            supportedExportFormats: "",
            capabilities: "Query",
            copyrightText: "Copyright information varies by provider. For more information please contact the source of this data.",
            spatialReference: {"wkid": 4326, "latestWkid": 4326},
            extent: {"xmin": -180, "ymin": -90, "xmax": 180, "ymax": 90},
            allowGeometryUpdates: false,
            units: "esriDecimalDegrees",
            supportsAppend: false,
            supportsSharedDomains: false,
            supportsWebHooks: false,
            supportsTemporalLayers: false,
            layerOverridesEnabled: false,
            syncEnabled: false,
            supportsApplyEditsWithGlobalIds: false,
            supportsReturnDeleteResults: false,
            supportsLayerOverrides: false,
            supportsTilesAndBasicQueriesMode: true,
            supportsQueryContingentValues: false,
            supportedContingentValuesFormats: "",
            supportsContingentValuesJson: null,
            supportsRelationshipsResource: true
          }
        }
        return callback(null, serviceGeojson)
      }
      
      // Build and execute query
      const geojson = await this.executeQuery(tableInfo, query, config)
      
      // Add metadata with layer ID information
      geojson.metadata = await this.generateMetadata(tableInfo, config)
      
      // Add layer ID to metadata if available
      if (layer !== undefined) {
        geojson.metadata.layerId = parseInt(layer)
      }
      
      callback(null, geojson)
    } catch (error) {
      console.error('Error in getData:', error)
      callback(error)
    }
  }

  /**
   * Get database configuration from host parameter or config
   */
  getDatabaseConfig(host) {
    let config
    
    // If host is provided, look for specific configuration
    if (host && this.options.databases && this.options.databases[host]) {
      config = this.options.databases[host]
    } else {
      // Use default configuration
      config = this.options.database || {
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT || 5432,
        database: process.env.PGDATABASE || 'gis',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || ''
      }
    }
    
    // Ensure all values are strings/proper types
    return {
      host: config.host || 'localhost',
      port: config.port || 5432,
      database: config.database || '',
      user: config.user || '',
      password: config.password || '',
      ssl: config.ssl || false,
      maxConnections: config.maxConnections || 20,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 2000
    }
  }

  /**
   * Parse table information from id and layer parameters
   */
  async parseTableInfo(id, layer) {
    let schema = 'public'
    let table = id
    let geometryColumn = null
    let isNonSpatial = false

    // Handle schema.table format
    if (id && id.includes('.')) {
      const parts = id.split('.')
      schema = parts[0]
      table = parts[1]
    }

    // Auto-detect geometry column from the table
    geometryColumn = await this.detectGeometryColumn(schema, table)
    
    if (!geometryColumn) {
      isNonSpatial = true
    }

    return { schema, table, geometryColumn, isNonSpatial }
  }

  /**
   * Get all tables in a schema and assign layer IDs
   * Returns array of {id, name, tableName, geometryType, isTable}
   */
  async getAllTablesInSchema(schema) {
    if (!this.pool) {
      return []
    }

    const client = await this.pool.connect()
    try {
      // Get all tables with their geometry info
      const query = `
        SELECT 
          t.table_name,
          c.column_name as geom_column,
          c.udt_name as geom_type,
          t.table_schema
        FROM information_schema.tables t
        LEFT JOIN information_schema.columns c 
          ON t.table_name = c.table_name 
          AND t.table_schema = c.table_schema
          AND c.udt_name = 'geometry'
        WHERE t.table_schema = $1
          AND t.table_type = 'BASE TABLE'
          AND t.table_name NOT IN ('spatial_ref_sys', 'geography_columns', 'geometry_columns', 'raster_columns', 'raster_overviews')
        ORDER BY t.table_name
      `
      
      console.log('Getting tables in schema:', schema)
      
      // Set a query timeout for schema discovery
      const queryPromise = client.query(query, [schema])
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Schema query timeout after 15 seconds')), 15000)
      )
      
      const result = await Promise.race([queryPromise, timeoutPromise])
      console.log(`Found ${result.rows.length} tables in schema '${schema}'`)
      
      if (result.rows.length === 0) {
        return []
      }
      
      // Group by table name and assign layer IDs
      const tables = {}
      result.rows.forEach(row => {
        if (!tables[row.table_name]) {
          tables[row.table_name] = {
            tableName: row.table_name,
            geometryColumn: row.geom_column,
            geometryType: row.geom_type,
            isSpatial: !!row.geom_column
          }
        }
      })
      
      // Convert to array and assign sequential IDs
      // Spatial layers first, then non-spatial tables
      const spatialLayers = Object.values(tables).filter(t => t.isSpatial)
      const nonSpatialTables = Object.values(tables).filter(t => !t.isSpatial)
      
      const allLayers = [...spatialLayers, ...nonSpatialTables].map((table, index) => ({
        id: index,
        name: table.tableName,
        tableName: table.tableName,
        geometryColumn: table.geometryColumn,
        geometryType: table.isSpatial ? this.mapPostGISGeometryType(table.geometryType) : null,
        isTable: !table.isSpatial // Non-spatial = table, spatial = layer
      }))
      
      return allLayers
    } catch (error) {
      console.error('Error getting tables in schema:', error)
      return []
    } finally {
      client.release()
    }
  }

  /**
   * Get table info by layer ID
   */
  async getTableByLayerId(schema, layerId) {
    const tables = await this.getAllTablesInSchema(schema)
    const table = tables.find(t => t.id === parseInt(layerId))
    
    if (!table) {
      return null
    }
    return table
  }

  /**
   * Get layer ID by table name
   */
  async getLayerIdByTableName(schema, tableName) {
    const tables = await this.getAllTablesInSchema(schema)
    const table = tables.find(t => t.tableName === tableName)
    return table ? table.id : null
  }

  /**
   * Map PostGIS geometry type to Esri geometry type
   */
  mapPostGISGeometryType(postgisType) {
    const typeMap = {
      'point': 'esriGeometryPoint',
      'multipoint': 'esriGeometryMultipoint',
      'linestring': 'esriGeometryPolyline',
      'multilinestring': 'esriGeometryPolyline',
      'polygon': 'esriGeometryPolygon',
      'multipolygon': 'esriGeometryPolygon'
    }
    return typeMap[postgisType?.toLowerCase()] || 'esriGeometryPoint'
  }

  /**
   * Detect geometry column in a table
   */
  async detectGeometryColumn(schema, tableName) {
    if (!this.pool) return null

    const client = await this.pool.connect()
    try {
      const query = `
        SELECT column_name, udt_name
        FROM information_schema.columns 
        WHERE table_schema = $1 
          AND table_name = $2 
          AND udt_name = 'geometry'
        ORDER BY ordinal_position
        LIMIT 1
      `
      
      const result = await client.query(query, [schema, tableName])
      return result.rows.length > 0 ? result.rows[0].column_name : null
    } catch (error) {
      console.warn('Failed to detect geometry column:', error.message)
      return null
    } finally {
      client.release()
    }
  }

  /**
   * Execute the main query to fetch GeoJSON data
   */
  async executeQuery(tableInfo, queryParams, config) {
    const { schema, table, geometryColumn, isNonSpatial } = tableInfo
    
    // Build base query (different for spatial vs non-spatial tables)
    let query = this.buildBaseQuery(schema, table, geometryColumn, isNonSpatial)
    const params = []
    let paramIndex = 1

    // Apply filters (skip spatial filters for non-spatial tables)
    const result1 = this.applyWhereClause(query, queryParams, params, paramIndex)
    query = result1.query
    paramIndex = result1.paramIndex
    
    if (!isNonSpatial && geometryColumn) {
      const result2 = this.applyBboxFilter(query, queryParams, params, paramIndex, geometryColumn)
      query = result2.query
      paramIndex = result2.paramIndex
      
      const result3 = this.applyGeometryFilter(query, queryParams, params, paramIndex, geometryColumn)
      query = result3.query
      paramIndex = result3.paramIndex
    }
    
    // Apply ordering
    query = this.applyOrderBy(query, queryParams)
    
    // Apply pagination
    const result4 = this.applyPagination(query, queryParams, params, paramIndex)
    query = result4.query

    // Execute query with timeout
    const client = await this.pool.connect()
    try {
      console.log('Executing query:', query.substring(0, 200) + '...')
      console.log('Query parameters:', params)
      
      // Set a query timeout of 30 seconds
      const queryPromise = client.query(query, params)
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout after 30 seconds')), 30000)
      )
      
      const result = await Promise.race([queryPromise, timeoutPromise])
      console.log(`Query completed successfully, returned ${result.rows.length} rows`)
      
      // Format results based on table type
      if (isNonSpatial) {
        return await this.formatAsTable(result.rows, queryParams, schema, table)
      } else {
        return await this.formatAsGeoJSON(result.rows, queryParams, schema, table)
      }
    } catch (error) {
      console.error('Query execution error:', error.message)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Build the base SQL query
   */
  buildBaseQuery(schema, table, geometryColumn, isNonSpatial) {
    if (isNonSpatial || !geometryColumn) {
      // Non-spatial table query
      return `
        SELECT *
        FROM "${schema}"."${table}"
        WHERE 1=1
      `
    } else {
      // Spatial table query
      return `
        SELECT 
          *,
          ST_AsGeoJSON("${geometryColumn}") as geojson_geom,
          ST_GeometryType("${geometryColumn}") as geom_type
        FROM "${schema}"."${table}"
        WHERE "${geometryColumn}" IS NOT NULL
      `
    }
  }

  /**
   * Apply WHERE clause filters
   */
  applyWhereClause(query, queryParams, params, paramIndex) {
    if (queryParams.where && queryParams.where !== '1=1') {
      // Convert Esri WHERE clause to PostgreSQL
      const pgWhere = this.convertEsriWhere(queryParams.where)
      query += ` AND (${pgWhere})`
    }
    return { query, paramIndex }
  }

  /**
   * Apply bounding box filter
   */
  applyBboxFilter(query, queryParams, params, paramIndex, geometryColumn) {
    if (queryParams.bbox) {
      const bbox = queryParams.bbox.split(',').map(parseFloat)
      if (bbox.length === 4) {
        params.push(bbox[0], bbox[1], bbox[2], bbox[3])
        query += ` AND ST_Intersects("${geometryColumn}", ST_MakeEnvelope($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, 4326))`
        paramIndex += 4
      }
    }
    return { query, paramIndex }
  }

  /**
   * Apply geometry filter
   */
  applyGeometryFilter(query, queryParams, params, paramIndex, geometryColumn) {
    if (queryParams.geometry) {
      try {
        // Parse geometry (could be WKT, GeoJSON, etc.)
        const geom = this.parseGeometry(queryParams.geometry)
        if (geom) {
          params.push(geom)
          const spatialRel = queryParams.spatialRel || 'esriSpatialRelIntersects'
          const pgSpatialFunc = this.convertSpatialRelation(spatialRel)
          query += ` AND ${pgSpatialFunc}("${geometryColumn}", ST_GeomFromText($${paramIndex}, 4326))`
          paramIndex++
        }
      } catch (error) {
        // Invalid geometry, skip filter
      }
    }
    return { query, paramIndex }
  }

  /**
   * Apply ORDER BY clause
   */
  applyOrderBy(query, queryParams) {
    if (queryParams.orderByFields) {
      const orderFields = queryParams.orderByFields.split(',')
        .map(field => {
          const parts = field.trim().split(' ')
          const fieldName = parts[0]
          const direction = parts[1] && parts[1].toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
          return `"${fieldName}" ${direction}`
        })
        .join(', ')
      query += ` ORDER BY ${orderFields}`
    }
    return query
  }

  /**
   * Apply pagination
   */
  applyPagination(query, queryParams, params, paramIndex) {
    const resultOffset = parseInt(queryParams.resultOffset) || 0
    // Increase default limit to 10000, or use environment variable if set
    const defaultLimit = parseInt(process.env.KOOP_MAX_RECORD_COUNT) || 100000
    const resultRecordCount = parseInt(queryParams.resultRecordCount) || defaultLimit

    if (resultOffset > 0) {
      params.push(resultOffset)
      query += ` OFFSET $${paramIndex++}`
    }

    // Only apply LIMIT if resultRecordCount > 0 (0 means unlimited)
    if (resultRecordCount > 0) {
      params.push(resultRecordCount)
      query += ` LIMIT $${paramIndex}`
    }

    return { query, paramIndex }
  }

  /**
   * Convert Esri WHERE clause to PostgreSQL syntax
   */
  convertEsriWhere(whereClause) {
    // Basic conversion - can be extended for more complex cases
    return whereClause
      .replace(/\bAND\b/gi, 'AND')
      .replace(/\bOR\b/gi, 'OR')
      .replace(/\bNOT\b/gi, 'NOT')
      .replace(/\bLIKE\b/gi, 'ILIKE') // Case-insensitive LIKE
  }

  /**
   * Convert Esri spatial relation to PostGIS function
   */
  convertSpatialRelation(spatialRel) {
    const relations = {
      'esriSpatialRelIntersects': 'ST_Intersects',
      'esriSpatialRelContains': 'ST_Contains',
      'esriSpatialRelWithin': 'ST_Within',
      'esriSpatialRelTouches': 'ST_Touches',
      'esriSpatialRelOverlaps': 'ST_Overlaps',
      'esriSpatialRelCrosses': 'ST_Crosses',
      'esriSpatialRelDisjoint': 'ST_Disjoint'
    }
    return relations[spatialRel] || 'ST_Intersects'
  }

  /**
   * Parse geometry from various formats
   */
  parseGeometry(geometryString) {
    try {
      // Try parsing as JSON first
      const geom = JSON.parse(geometryString)
      if (geom.type && geom.coordinates) {
        // GeoJSON geometry
        return wellknown.stringify(geom)
      }
    } catch (e) {
      // Not JSON, might be WKT
      return geometryString
    }
    return null
  }

  /**
   * Format query results as table (non-spatial data)
   */
  async formatAsTable(rows, queryParams, schema, tableName) {
    const relationships = await this.getTableRelationships(schema || 'public', tableName)
    
    // Format as FeatureCollection but without geometry for non-spatial tables
    const features = rows.map(row => ({
      type: 'Feature',
      geometry: null,
      properties: this.formatProperties(row)
    }))

    const geojson = {
      type: 'FeatureCollection',
      features,
      metadata: {
        name: tableName || 'Table',
        description: `Non-spatial table with ${rows.length} records`,
        geometryType: null,
        fields: this.extractFields(rows),
        relationships: relationships
      }
    }

    // Add filters applied information for Koop
    geojson.filtersApplied = {
      where: !!queryParams.where,
      geometry: false,
      bbox: false,
      limit: !!queryParams.resultRecordCount,
      offset: !!queryParams.resultOffset
    }

    return geojson
  }

  /**
   * Format query results as GeoJSON
   */
  async formatAsGeoJSON(rows, queryParams, schema, tableName) {
    const features = rows.map(row => {
      const { geojson_geom, geom_type, ...properties } = row
      
      let geometry = null
      if (geojson_geom) {
        try {
          geometry = JSON.parse(geojson_geom)
        } catch (e) {
          // Invalid geometry
        }
      }

      return {
        type: 'Feature',
        geometry,
        properties: this.formatProperties(properties)
      }
    })

    // Get relationships for this table
    const relationships = await this.getTableRelationships(schema || 'public', tableName)

    const geojson = {
      type: 'FeatureCollection',
      features,
      metadata: {
        name: tableName || 'Layer',
        description: `Spatial layer with ${rows.length} features`,
        geometryType: rows.length > 0 ? rows[0].geom_type : null,
        fields: this.extractFields(rows),
        relationships: relationships
      }
    }

    // Add filters applied information for Koop
    geojson.filtersApplied = {
      where: !!queryParams.where,
      geometry: !!queryParams.geometry,
      bbox: !!queryParams.bbox,
      limit: !!queryParams.resultRecordCount,
      offset: !!queryParams.resultOffset
    }

    return geojson
  }

  /**
   * Generate a numeric table ID from table name for Esri compatibility
   */
  generateTableId(tableName) {
    // Simple hash function to convert table name to numeric ID
    let hash = 0
    if (tableName.length === 0) return hash
    for (let i = 0; i < tableName.length; i++) {
      const char = tableName.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash)
  }

  /**
   * Get table relationships (foreign keys) from PostgreSQL information schema
   */
  async getTableRelationships(schema, tableName) {
    if (!this.pool || !tableName) return []

    const client = await this.pool.connect()
    try {
      // Enhanced query to get relationship info with cardinality detection
      const query = `
        SELECT DISTINCT
          tc.constraint_name,
          tc.table_name as origin_table,
          kcu.column_name as origin_column,
          ccu.table_name as destination_table,
          ccu.column_name as destination_column,
          -- Check if origin column is unique (determines cardinality)
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM information_schema.table_constraints tc2
              JOIN information_schema.key_column_usage kcu2 
                ON tc2.constraint_name = kcu2.constraint_name
                AND tc2.table_schema = kcu2.table_schema
              WHERE tc2.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
                AND tc2.table_schema = tc.table_schema
                AND tc2.table_name = tc.table_name
                AND kcu2.column_name = kcu.column_name
            ) THEN true
            ELSE false
          END as origin_column_is_unique,
          -- Check if destination column is unique
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM information_schema.table_constraints tc3
              JOIN information_schema.key_column_usage kcu3 
                ON tc3.constraint_name = kcu3.constraint_name
                AND tc3.table_schema = kcu3.table_schema
              WHERE tc3.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
                AND tc3.table_schema = ccu.table_schema
                AND tc3.table_name = ccu.table_name
                AND kcu3.column_name = ccu.column_name
            ) THEN true
            ELSE false
          END as destination_column_is_unique
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu 
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = $1
          AND (tc.table_name = $2 OR ccu.table_name = $2)
        ORDER BY tc.constraint_name
      `
      
      const result = await client.query(query, [schema, tableName])
      
      // Log relationship detection for debugging
      if (process.env.NODE_ENV === 'development') {
        console.log(`Relationship detection for ${schema}.${tableName}:`)
        result.rows.forEach(row => {
          console.log(`  ${row.constraint_name}: ${row.origin_table}.${row.origin_column} (unique: ${row.origin_column_is_unique}) → ${row.destination_table}.${row.destination_column} (unique: ${row.destination_column_is_unique})`)
        })
      }
      
      // Map relationships with proper layer IDs
      const relationships = await Promise.all(result.rows.map(async (row, index) => {
        const isOrigin = row.origin_table === tableName
        const relatedTableName = isOrigin ? row.destination_table : row.origin_table
        
        // Get the actual layer ID for the related table
        const relatedLayerId = await this.getLayerIdByTableName(schema, relatedTableName)
        
        // Determine cardinality based on PostgreSQL constraints
        let cardinality, role, keyField
        
        if (isOrigin) {
          // This table has FK pointing to another table
          role = 'esriRelRoleOrigin'
          keyField = row.origin_column
          
          // Determine cardinality based on uniqueness constraints
          if (row.origin_column_is_unique && row.destination_column_is_unique) {
            // Both sides unique = One-to-One
            cardinality = 'esriRelCardinalityOneToOne'
          } else if (row.origin_column_is_unique) {
            // Origin unique, destination not = One-to-Many (from this table's perspective)
            cardinality = 'esriRelCardinalityOneToMany'
          } else {
            // Origin not unique = Many-to-One (most common case)
            cardinality = 'esriRelCardinalityManyToOne'
          }
        } else {
          // Another table has FK pointing to this table
          role = 'esriRelRoleDestination'
          keyField = row.destination_column
          
          // Determine cardinality from the destination perspective
          if (row.origin_column_is_unique && row.destination_column_is_unique) {
            // Both sides unique = One-to-One
            cardinality = 'esriRelCardinalityOneToOne'
          } else if (row.origin_column_is_unique) {
            // Origin unique = One-to-One from destination perspective
            cardinality = 'esriRelCardinalityOneToOne'
          } else {
            // Origin not unique = One-to-Many (this table is the "one" side)
            cardinality = 'esriRelCardinalityOneToMany'
          }
        }
        
        // Create descriptive relationship name
        const relationshipName = `${tableName}_to_${relatedTableName}`
        
        return {
          id: index, // Simple sequential ID
          name: relationshipName,
          relatedTableId: relatedLayerId !== null ? relatedLayerId : this.generateTableId(relatedTableName),
          cardinality: cardinality,
          role: role,
          keyField: keyField,
          composite: false, // Simple FK relationships are not composite
          // Official ArcGIS relationship properties - use table names for labels
          backwardPathLabel: relatedTableName,
          forwardPathLabel: tableName,
          attributed: false, // Simple FK relationships are not attributed
          rules: [], // No rules for simple FK relationships
          // Add additional metadata for better Esri compatibility
          relatedTableName: relatedTableName,
          originTable: row.origin_table,
          destinationTable: row.destination_table,
          originColumn: row.origin_column,
          destinationColumn: row.destination_column,
          // Keep original constraint name for reference
          constraintName: row.constraint_name
        }
      }))
      
      return relationships
    } catch (error) {
        return []
    } finally {
      client.release()
    }
  }

  /**
   * Get layer estimates (count and extent) for getEstimates endpoint
   */
  async getLayerEstimates(schema, tableName, geometryColumn) {
    if (!this.pool) {
      throw new Error('Database pool not initialized')
    }

    const client = await this.pool.connect()
    try {
      const result = { count: 0 }
      
      // Get count
      const countQuery = `SELECT COUNT(*) as count FROM ${schema}.${tableName}`
      const countResult = await client.query(countQuery)
      result.count = parseInt(countResult.rows[0].count)
      
      // Get extent if spatial layer
      if (geometryColumn) {
        const extentQuery = `
          SELECT 
            ST_XMin(ST_Extent(${geometryColumn})) as xmin,
            ST_YMin(ST_Extent(${geometryColumn})) as ymin,
            ST_XMax(ST_Extent(${geometryColumn})) as xmax,
            ST_YMax(ST_Extent(${geometryColumn})) as ymax,
            ST_SRID(${geometryColumn}) as srid
          FROM ${schema}.${tableName}
          WHERE ${geometryColumn} IS NOT NULL
        `
        const extentResult = await client.query(extentQuery)
        
        if (extentResult.rows[0] && extentResult.rows[0].xmin !== null) {
          const row = extentResult.rows[0]
          result.extent = {
            xmin: parseFloat(row.xmin),
            ymin: parseFloat(row.ymin),
            xmax: parseFloat(row.xmax),
            ymax: parseFloat(row.ymax),
            spatialReference: {
              wkid: parseInt(row.srid) || 4326,
              latestWkid: parseInt(row.srid) || 4326
            }
          }
        }
      }
      
      return result
    } catch (error) {
      console.error('Error getting layer estimates:', error)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get main layer data without recursion
   */
  async getMainLayerData(request) {
    const { params, query } = request
    const { schema, layer } = params
    
    // Always use default host since we removed host parameter from URLs
    const host = 'default'
    
    // Get database configuration
    const config = this.getDatabaseConfig(host)
    await this.initializePool(config)

    // Get table info from layer ID
    let tableInfo
    if (layer !== undefined && layer !== null) {
      const layerInfo = await this.getTableByLayerId(schema || 'public', layer)
      if (!layerInfo) {
        throw new Error(`Layer ${layer} not found in schema ${schema || 'public'}`)
      }
      
      tableInfo = {
        schema: schema || 'public',
        table: layerInfo.tableName,
        geometryColumn: layerInfo.geometryColumn,
        isNonSpatial: !layerInfo.geometryColumn
      }
    } else {
      // No layer ID provided - this shouldn't happen in the new architecture
      throw new Error('Layer ID is required for getMainLayerData')
    }
    
    // Build and execute query
    const geojson = await this.executeQuery(tableInfo, query, config)
    
    // Add metadata
    geojson.metadata = await this.generateMetadata(tableInfo, config)
    
    return geojson
  }

  /**
   * Get related records data in the special format Koop expects
   * @param {Object} request - Express request object
   * @param {Function} callback - Callback function
   */
  async getRelatedRecordsData(request, callback) {
    try {
      const { params, query } = request
      const { objectIds, relationshipId } = query
      
      // Get the main layer metadata directly without calling getData to avoid recursion
      const mainGeojson = await this.getMainLayerData(request)
      
      const relationships = mainGeojson.metadata.relationships || []
      
      // Handle relationshipId - remove quotes if present
      let cleanRelationshipId = relationshipId
      if (typeof relationshipId === 'string' && relationshipId.startsWith('"') && relationshipId.endsWith('"')) {
        cleanRelationshipId = relationshipId.slice(1, -1)
      }
      
      // Find the relationship
      const relId = parseInt(cleanRelationshipId)
      const relationship = relationships.find(rel => rel.id === relId)
      
      if (!relationship) {
        return callback(new Error(`Relationship ${cleanRelationshipId} not found`))
      }
      
      // Get object IDs to query
      let targetObjectIds = []
      if (objectIds) {
        targetObjectIds = objectIds.split(',').map(id => parseInt(id))
      } else {
        // Get first few object IDs from main layer
        const mainFeatures = mainGeojson.features || []
        const idField = mainGeojson.metadata.idField || 'OBJECTID'
        targetObjectIds = mainFeatures.slice(0, 3).map(f => f.properties[idField]).filter(id => id != null)
      }
      
      // Query actual related records from database
      const relatedRecordsResult = await this.queryRelatedRecords({
        sourceLayer: mainGeojson.metadata.name,
        sourceLayerId: parseInt(params.layer) || 0,
        objectIds: targetObjectIds,
        relationship: relationship,
        definitionExpression: query.definitionExpression,
        outFields: query.outFields,
        returnGeometry: query.returnGeometry === 'true'
      })
      
      // Get field definitions from the related table
      const relatedTableFields = await this.getTableFields(relationship.relatedTableName)
      
      // Convert to Koop's expected format: FeatureCollection with features array containing FeatureCollections
      // Each feature is a FeatureCollection representing related records for one parent object
      const relatedFeatureCollections = relatedRecordsResult.map(group => ({
        type: 'FeatureCollection',
        properties: {
          objectid: group.objectId // Note: lowercase 'objectid' as required by Koop
        },
        features: group.relatedRecords.map(record => ({
          type: 'Feature',
          properties: record.attributes,
          geometry: record.geometry || null
        }))
      }))
      
      // Return the special FeatureCollection of FeatureCollections format
      const specialGeojson = {
        type: 'FeatureCollection',
        features: relatedFeatureCollections,
        metadata: {
          name: `${relationship.relatedTableName}`,
          description: `Related records for ${relationship.relatedTableName}`,
          geometryType: null, // Will be set if related table has geometry
          fields: relatedTableFields,
          idField: 'OBJECTID' // Standard Esri ID field
        }
      }
      
      callback(null, specialGeojson)
      
    } catch (error) {
      console.error('Error in getRelatedRecordsData:', error)
      callback(error)
    }
  }

  /**
   * Query related records for given object IDs and relationship
   */
  async queryRelatedRecords(options) {
    const { sourceLayer, sourceLayerId, objectIds, relationship, definitionExpression, outFields, returnGeometry } = options
    
    if (!this.pool) {
      throw new Error('Database pool not initialized')
    }
    
    const client = await this.pool.connect()
    try {
      // Get the related table name from the relationship
      // Use the relatedTableName directly from the relationship metadata
      const relatedTableName = relationship.relatedTableName
      
      
      if (!relatedTableName) {
        throw new Error(`No related table name found in relationship`)
      }
      
      
      const relatedRecordGroups = []
      
      // Query related records for each object ID
      for (const objectId of objectIds) {
        let query
        let queryParams
        
        // Check if the related table has geometry column
        const hasGeomQuery = `
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = $1 AND column_name = 'geom'
        `
        const hasGeomResult = await client.query(hasGeomQuery, [relatedTableName])
        const hasGeometry = hasGeomResult.rows.length > 0
        
        // Build query based on relationship cardinality and role
        // For our case: locations is destination, related tables are origin
        // So we need to find records in related tables where location_id = objectId
        
        
        if (relationship.role === 'esriRelRoleDestination') {
          // This layer (locations) is the destination
          // Find records in the related table that reference this location
          const foreignKeyColumn = relationship.originColumn // This should be 'location_id' in the related table
          
          if (hasGeometry) {
            query = `
              SELECT *, ST_AsGeoJSON(geom) as geojson_geom FROM ${relatedTableName} 
              WHERE ${foreignKeyColumn} = $1
            `
          } else {
            query = `
              SELECT * FROM ${relatedTableName} 
              WHERE ${foreignKeyColumn} = $1
            `
          }
          queryParams = [objectId]
        } else {
          // This layer is the origin, find the record it references
          const primaryKeyColumn = relationship.destinationColumn
          
          if (hasGeometry) {
            query = `
              SELECT *, ST_AsGeoJSON(geom) as geojson_geom FROM ${relatedTableName} 
              WHERE ${primaryKeyColumn} = $1
            `
          } else {
            query = `
              SELECT * FROM ${relatedTableName} 
              WHERE ${primaryKeyColumn} = $1
            `
          }
          queryParams = [objectId]
        }
        
        // Add definition expression if provided
        if (definitionExpression) {
          query += ` AND (${definitionExpression})`
        }
        
        // Add field selection if specified
        if (outFields && outFields.length > 0 && !outFields.includes('*')) {
          const fieldList = outFields.join(', ')
          query = query.replace('SELECT *', `SELECT ${fieldList}`)
        }
        
        
        // Write query to debug file for inspection
        const fs = require('fs')
        fs.appendFileSync('query-debug.log', `\n=== Query Debug ===\n`)
        fs.appendFileSync('query-debug.log', `Table: ${relatedTableName}\n`)
        fs.appendFileSync('query-debug.log', `ObjectId: ${objectId}\n`)
        fs.appendFileSync('query-debug.log', `Query: ${query}\n`)
        fs.appendFileSync('query-debug.log', `Params: ${JSON.stringify(queryParams)}\n`)
        
        const result = await client.query(query, queryParams)
        
        fs.appendFileSync('query-debug.log', `Result count: ${result.rows.length}\n`)
        if (result.rows.length > 0) {
          fs.appendFileSync('query-debug.log', `Sample result: ${JSON.stringify(result.rows[0])}\n`)
        }
        
        // Format the related records
        const relatedRecords = result.rows.map(row => {
          const record = {
            attributes: { ...row }
          }
          
          // Add geometry if requested and available
          if (returnGeometry && row.geom) {
            try {
              const geojsonGeom = JSON.parse(row.geojson_geom || '{}')
              record.geometry = this.convertGeometryToEsri(geojsonGeom)
            } catch (e) {
              console.warn('Failed to parse geometry for related record:', e.message)
            }
          }
          
          // Remove internal geometry fields from attributes
          delete record.attributes.geom
          delete record.attributes.geojson_geom
          delete record.attributes.geom_type
          
          return record
        })
        
        relatedRecordGroups.push({
          objectId: objectId,
          relatedRecords: relatedRecords
        })
      }
      
      return relatedRecordGroups
      
    } catch (error) {
      console.error('Error querying related records:', error)
      throw error
    } finally {
      client.release()
    }
  }
  
  /**
   * Get table name from generated table ID
   */
  async getTableNameFromId(tableId) {
    if (!this.pool) return null
    
    const client = await this.pool.connect()
    try {
      // Query all tables and find the one with matching generated ID
      const query = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      `
      
      const result = await client.query(query)
      
      for (const row of result.rows) {
        const generatedId = this.generateTableId(row.table_name)
        if (generatedId === tableId) {
          return row.table_name
        }
      }
      
      return null
    } catch (error) {
      console.warn('Failed to get table name from ID:', error.message)
      return null
    } finally {
      client.release()
    }
  }
  
  /**
   * Convert GeoJSON geometry to Esri geometry format
   */
  convertGeometryToEsri(geometry) {
    if (!geometry) return null

    switch (geometry.type) {
      case 'Point':
        return {
          x: geometry.coordinates[0],
          y: geometry.coordinates[1]
        }
      case 'MultiPoint':
        return {
          points: geometry.coordinates
        }
      case 'LineString':
        return {
          paths: [geometry.coordinates]
        }
      case 'MultiLineString':
        return {
          paths: geometry.coordinates
        }
      case 'Polygon':
        return {
          rings: geometry.coordinates
        }
      case 'MultiPolygon':
        return {
          rings: geometry.coordinates.flat()
        }
      default:
        return null
    }
  }

  /**
   * Extract field definitions from query results
   */
  extractFields(rows) {
    if (!rows || rows.length === 0) {
      return []
    }
    
    const sampleRow = rows[0]
    if (!sampleRow) {
      return []
    }
    
    const fields = []
    
    Object.keys(sampleRow).forEach(key => {
      // Skip internal geometry columns
      if (key === 'geojson_geom' || key === 'geom_type') return
      
      const value = sampleRow[key]
      let fieldType = 'esriFieldTypeString'
      let length = 255
      
      // Determine field type based on value
      if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          fieldType = 'esriFieldTypeInteger'
        } else {
          fieldType = 'esriFieldTypeDouble'
        }
        length = null
      } else if (typeof value === 'boolean') {
        fieldType = 'esriFieldTypeSmallInteger'
        length = null
      } else if (value instanceof Date) {
        fieldType = 'esriFieldTypeDate'
        length = null
      }
      
      fields.push({
        name: key,
        type: fieldType,
        alias: key,
        length: length,
        nullable: true,
        editable: true
      })
    })
    
    return fields
  }

  /**
   * Get field definitions for a specific table from database schema
   */
  async getTableFields(tableName) {
    if (!this.pool || !tableName) {
      return []
    }

    const client = await this.pool.connect()
    try {
      const query = `
        SELECT 
          column_name,
          data_type,
          is_nullable,
          character_maximum_length,
          numeric_precision,
          numeric_scale
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `
      
      const result = await client.query(query, [tableName])
      
      const fields = result.rows.map(row => {
        let fieldType = 'esriFieldTypeString'
        let length = row.character_maximum_length || 255
        
        // Map PostgreSQL types to Esri field types
        switch (row.data_type) {
          case 'integer':
          case 'int':
          case 'int4':
            fieldType = 'esriFieldTypeInteger'
            length = null
            break
          case 'bigint':
          case 'int8':
            fieldType = 'esriFieldTypeBigInteger'
            length = null
            break
          case 'smallint':
          case 'int2':
            fieldType = 'esriFieldTypeSmallInteger'
            length = null
            break
          case 'double precision':
          case 'float8':
          case 'real':
          case 'float4':
          case 'numeric':
          case 'decimal':
            fieldType = 'esriFieldTypeDouble'
            length = null
            break
          case 'boolean':
            fieldType = 'esriFieldTypeSmallInteger'
            length = null
            break
          case 'date':
          case 'timestamp':
          case 'timestamp without time zone':
          case 'timestamp with time zone':
          case 'time':
          case 'time without time zone':
          case 'time with time zone':
            fieldType = 'esriFieldTypeDate'
            length = 8
            break
          case 'uuid':
            fieldType = 'esriFieldTypeGUID'
            length = 38
            break
          case 'text':
          case 'character varying':
          case 'varchar':
          case 'character':
          case 'char':
            fieldType = 'esriFieldTypeString'
            break
          case 'USER-DEFINED': // Could be geometry or other custom type
            if (row.column_name === 'geom' || row.column_name === 'geometry') {
              return null // Skip geometry columns
            }
            fieldType = 'esriFieldTypeString'
            break
          default:
            fieldType = 'esriFieldTypeString'
        }
        
        // Special handling for OBJECTID field
        if (row.column_name.toUpperCase() === 'OBJECTID' || row.column_name === 'id') {
          fieldType = 'esriFieldTypeOID'
        }
        
        // Special handling for GlobalID field
        if (row.column_name.toUpperCase() === 'GLOBALID') {
          fieldType = 'esriFieldTypeGlobalID'
        }
        
        return {
          name: row.column_name,
          type: fieldType,
          alias: row.column_name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          sqlType: 'sqlTypeOther',
          length: length,
          nullable: row.is_nullable === 'YES',
          editable: row.column_name.toUpperCase() !== 'OBJECTID' && row.column_name.toUpperCase() !== 'GLOBALID',
          domain: null,
          defaultValue: null
        }
      }).filter(field => field !== null) // Remove null entries (geometry columns)
      
      return fields
    } catch (error) {
      console.error('Error getting table fields:', error)
      return []
    } finally {
      client.release()
    }
  }

  /**
   * Format properties for Esri compatibility
   */
  formatProperties(properties) {
    const formatted = {}
    
    Object.keys(properties).forEach(key => {
      let value = properties[key]
      
      // Handle dates
      if (value instanceof Date) {
        value = value.getTime() // Convert to timestamp for Esri
      }
      
      // Handle null values
      if (value === null || value === undefined) {
        value = null
      }
      
      formatted[key] = value
    })
    
    return formatted
  }

  /**
   * Generate metadata for the layer
   */
  async generateMetadata(tableInfo, config) {
    const { schema, table, geometryColumn } = tableInfo
    
    const client = await this.pool.connect()
    try {
      // Get table information
      const tableInfoQuery = `
        SELECT 
          column_name,
          data_type,
          is_nullable,
          character_maximum_length
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `
      
      let geometryInfoQuery = null
      let extentQuery = null
      
      if (geometryColumn) {
        geometryInfoQuery = `
          SELECT 
            ST_SRID("${geometryColumn}") as srid,
            ST_GeometryType("${geometryColumn}") as geom_type
          FROM "${schema}"."${table}" 
          WHERE "${geometryColumn}" IS NOT NULL 
          LIMIT 1
        `
        
        extentQuery = `
          SELECT 
            ST_Extent("${geometryColumn}") as extent
          FROM "${schema}"."${table}" 
          WHERE "${geometryColumn}" IS NOT NULL
        `
      }
      
      const countQuery = `
        SELECT COUNT(*) as total_count
        FROM "${schema}"."${table}"
      `

      // Execute queries conditionally based on whether geometry column exists
      const promises = [
        client.query(tableInfoQuery, [schema, table]),
        client.query(countQuery)
      ]
      
      // Only add geometry-related queries if geometry column exists
      if (geometryColumn && geometryInfoQuery && extentQuery) {
        promises.push(client.query(geometryInfoQuery))
        promises.push(client.query(extentQuery))
      }
      
      const results = await Promise.all(promises)
      const [tableInfo, countInfo, geometryInfo, extentInfo] = [
        results[0],
        results[1],
        geometryColumn ? results[2] : { rows: [] },
        geometryColumn ? results[3] : { rows: [] }
      ]

      // Build fields metadata
      const fields = tableInfo.rows
        .filter(col => col.column_name !== geometryColumn)
        .map(col => ({
          name: col.column_name,
          type: this.mapPostgresToEsriType(col.data_type),
          alias: col.column_name,
          length: col.character_maximum_length || 255
        }))
      // Determine geometry type
      let geometryType = null
      if (geometryColumn && geometryInfo.rows.length > 0) {
        const pgGeomType = geometryInfo.rows[0].geom_type
        geometryType = this.mapPostgisToEsriGeometryType(pgGeomType)
      }

      // Parse extent
      let extent = null
      if (geometryColumn && extentInfo.rows.length > 0 && extentInfo.rows[0].extent) {
        extent = this.parsePostgisExtent(extentInfo.rows[0].extent)
      } else {
        extent = [[-180, -90], [180, 90]] // Default world extent
      }

      // Get relationships for this table
      const relationships = await this.getTableRelationships(schema, table)

      // Get max record count from environment or use default
      const maxRecordCount = parseInt(process.env.KOOP_MAX_RECORD_COUNT) || 10000
      
      return {
        name: table, // Just the table name without schema prefix
        description: `PostgreSQL/PostGIS layer: ${table}`,
        extent,
        displayField: this.findDisplayField(fields),
        geometryType,
        idField: this.findIdField(fields),
        maxRecordCount: maxRecordCount,
        fields,
        relationships,
        capabilities: 'Map,Query,Data,Identify,Relationship'
      }
    } finally {
      client.release()
    }
  }

  /**
   * Map PostgreSQL data types to Esri field types
   */
  mapPostgresToEsriType(pgType) {
    const typeMap = {
      'integer': 'Integer',
      'bigint': 'Integer',
      'smallint': 'Integer',
      'numeric': 'Double',
      'real': 'Double',
      'double precision': 'Double',
      'text': 'String',
      'character varying': 'String',
      'character': 'String',
      'date': 'Date',
      'timestamp': 'Date',
      'timestamp with time zone': 'Date',
      'timestamp without time zone': 'Date',
      'boolean': 'String'
    }
    return typeMap[pgType] || 'String'
  }

  /**
   * Map PostGIS geometry types to Esri geometry types
   */
  mapPostgisToEsriGeometryType(pgGeomType) {
    // Remove ST_ prefix if present and convert to uppercase
    const cleanType = pgGeomType.replace(/^ST_/, '').toUpperCase()
    
    const typeMap = {
      'POINT': 'Point',
      'MULTIPOINT': 'MultiPoint',
      'LINESTRING': 'LineString',
      'MULTILINESTRING': 'MultiLineString',
      'POLYGON': 'Polygon',
      'MULTIPOLYGON': 'MultiPolygon'
    }
    return typeMap[cleanType] || 'Point'
  }

  /**
   * Parse PostGIS extent to Esri format
   */
  parsePostgisExtent(extentString) {
    // Parse "BOX(xmin ymin,xmax ymax)" format
    const match = extentString.match(/BOX\(([^,]+),([^)]+)\)/)
    if (match) {
      const [, min, max] = match
      const [xmin, ymin] = min.trim().split(' ').map(parseFloat)
      const [xmax, ymax] = max.trim().split(' ').map(parseFloat)
      return [[xmin, ymin], [xmax, ymax]]
    }
    return [[-180, -90], [180, 90]]
  }

  /**
   * Find suitable display field for Esri compatibility
   */
  findDisplayField(fields) {
    if (!fields || fields.length === 0) return null
    
    // Look for common display field names (non-date fields preferred)
    const displayCandidates = ['name', 'title', 'label', 'description', 'id']
    
    for (const candidate of displayCandidates) {
      const field = fields.find(f => 
        f.name.toLowerCase().includes(candidate) && 
        f.type !== 'Date' // Avoid date fields for display unless specifically needed
      )
      if (field) return field.name
    }
    
    // Look for any string field
    const stringField = fields.find(f => f.type === 'String')
    if (stringField) return stringField.name
    
    // Look for any non-date field
    const nonDateField = fields.find(f => f.type !== 'Date')
    if (nonDateField) return nonDateField.name
    
    // If only date fields exist, return the first one
    return fields[0].name
  }

  /**
   * Find suitable ID field for Esri compatibility
   */
  findIdField(fields) {
    // Look for common ID field names
    const idCandidates = ['id', 'objectid', 'fid', 'gid', 'pk']
    
    for (const candidate of idCandidates) {
      const field = fields.find(f => 
        f.name.toLowerCase() === candidate && 
        f.type === 'Integer'
      )
      if (field) return field.name
    }
    
    // Look for any integer field
    const intField = fields.find(f => f.type === 'Integer')
    return intField ? intField.name : null
  }

  /**
   * Close database connections
   */
  async close() {
    if (this.pool) {
      await this.pool.end()
      this.pool = null
    }
  }
}

module.exports = Model
