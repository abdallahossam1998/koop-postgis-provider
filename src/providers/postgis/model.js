require('dotenv').config()
const { Pool } = require('pg')
const wellknown = require('wellknown')
const _ = require('lodash')

class Model {
  constructor(options = {}) {
    this.options = options
    this.pool = null
  }

  /**
   * Initialize database connection pool
   */
  async initializePool(config) {
    if (!this.pool) {
      try {
        // Use database connection string from environment variables
        const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
        
        // Create pool with connection string only
        this.pool = new Pool({ connectionString });
        
        // Set up error handler for the pool
        this.pool.on('error', (err) => {
          console.error('PostgreSQL pool error:', err);
        });
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
      const { host, id, layer } = params
      
      // Get database configuration
      const config = this.getDatabaseConfig(host)
      await this.initializePool(config)

      // Parse table and layer information
      const tableInfo = await this.parseTableInfo(request.params.id, request.params.layer)
      
      // Build and execute query
      const geojson = await this.executeQuery(tableInfo, query, config)
      
      // Add metadata
      geojson.metadata = await this.generateMetadata(tableInfo, config)
      
      // Debug: Log the complete metadata including relationships
      console.log('Complete metadata being passed to Koop:', JSON.stringify(geojson.metadata, null, 2))
      
      // Debug: Also log the relationships specifically
      if (geojson.metadata && geojson.metadata.relationships) {
        console.log('Relationships in metadata:', JSON.stringify(geojson.metadata.relationships, null, 2))
      } else {
        console.log('No relationships found in metadata')
      }
      
      callback(null, geojson)
    } catch (error) {
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

    // Execute query
    const client = await this.pool.connect()
    try {
      const result = await client.query(query, params)
      
      // Format results based on table type
      if (isNonSpatial) {
        return await this.formatAsTable(result.rows, queryParams, schema, table)
      } else {
        return await this.formatAsGeoJSON(result.rows, queryParams, schema, table)
      }
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
    const resultRecordCount = parseInt(queryParams.resultRecordCount) || 1000

    if (resultOffset > 0) {
      params.push(resultOffset)
      query += ` OFFSET $${paramIndex++}`
    }

    params.push(resultRecordCount)
    query += ` LIMIT $${paramIndex}`

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
      const query = `
        SELECT DISTINCT
          tc.constraint_name,
          tc.table_name as origin_table,
          kcu.column_name as origin_column,
          ccu.table_name as destination_table,
          ccu.column_name as destination_column
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
      
      const relationships = result.rows.map((row, index) => {
        const isOrigin = row.origin_table === tableName
        const relatedTableName = isOrigin ? row.destination_table : row.origin_table
        
        // Generate a numeric ID for the related table based on table name hash
        const relatedTableId = this.generateTableId(relatedTableName)
        
        return {
          id: index,
          name: row.constraint_name,
          relatedTableId: relatedTableId,
          cardinality: isOrigin ? 'esriRelCardinalityOneToMany' : 'esriRelCardinalityManyToOne',
          role: isOrigin ? 'esriRelRoleOrigin' : 'esriRelRoleDestination',
          keyField: isOrigin ? row.origin_column : row.destination_column,
          composite: false
        }
      })
      
      console.log(`Found ${relationships.length} relationships for table ${tableName}:`, relationships)
      return relationships
    } catch (error) {
      console.warn('Failed to get table relationships:', error.message)
      return []
    } finally {
      client.release()
    }
  }

  /**
   * Extract field definitions from query results
   */
  extractFields(rows) {
    if (!rows || rows.length === 0) {
      console.log('No rows provided to extractFields')
      return []
    }
    
    const sampleRow = rows[0]
    if (!sampleRow) {
      console.log('First row is undefined')
      return []
    }
    
    console.log('Sample row for field extraction:', sampleRow)
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
        console.log(`PostGIS geometry type for ${table}:`, pgGeomType)
        geometryType = this.mapPostgisToEsriGeometryType(pgGeomType)
        console.log(`Mapped to Esri geometry type:`, geometryType)
      }

      // Parse extent
      let extent = [[-180, -90], [180, 90]] // Default world extent
      if (geometryColumn && extentInfo.rows.length > 0 && extentInfo.rows[0].extent) {
        extent = this.parsePostgisExtent(extentInfo.rows[0].extent)
      }

      // Get relationships for this table
      const relationships = await this.getTableRelationships(schema, table)

      return {
        name: `${schema}.${table}`,
        description: `PostgreSQL/PostGIS layer: ${schema}.${table}`,
        extent,
        displayField: fields.length > 0 ? fields[0].name : null,
        geometryType,
        idField: this.findIdField(fields),
        maxRecordCount: 1000,
        fields,
        relationships
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
