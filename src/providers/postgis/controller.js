const Model = require('./model')

class Controller {
  constructor() {
    this.model = new Model()
  }

  /**
   * Handle FeatureServer requests
   */
  async featureServer(req, res) {
    try {
      const { layer, method } = req.params
      
      console.log('FeatureServer request:', { layer, method, url: req.url, params: req.params })
      
      // Check if this is a service-level request (no layer specified)
      if ((!layer || layer === '') && (!method || method === '')) {
        console.log('Handling service info request - CUSTOM CONTROLLER')
        return this.handleServiceInfo(req, res, 'FeatureServer')
      }
      
      // Handle different FeatureServer methods
      switch (method) {
        case 'query':
          return this.handleQuery(req, res)
        case 'queryRelatedRecords':
          return this.handleQueryRelatedRecords(req, res)
        case 'queryrelated':
          return this.handleQueryRelatedRecords(req, res)
        case 'getEstimates':
          return this.handleGetEstimates(req, res)
        case 'info':
          return this.handleLayerInfo(req, res)
        default:
          if (!method && layer) {
            // URL pattern: /schema/FeatureServer/0 - show layer info
            console.log('Handling layer info request for layer:', layer)
            return this.handleLayerInfo(req, res)
          } else {
            // Unknown method, return 404
            return res.status(404).json({ error: 'Method not found', method: method })
          }
      }
    } catch (error) {
      this.handleError(res, error)
    }
  }

  /**
   * Handle MapServer requests
   */
  async mapServer(req, res) {
    try {
      const { layer, method } = req.params
      
      // Handle different MapServer methods
      switch (method) {
        case 'query':
          return this.handleQuery(req, res)
        case 'queryRelatedRecords':
          return this.handleQueryRelatedRecords(req, res)
        case 'queryrelated':
          return this.handleQueryRelatedRecords(req, res)
        case 'info':
          return this.handleLayerInfo(req, res)
        default:
          if (!method && layer) {
            // URL pattern: /id/MapServer/0 - show layer info
            return this.handleLayerInfo(req, res)
          } else if (!method && !layer) {
            // URL pattern: /id/MapServer - show service info
            return this.handleServiceInfo(req, res, 'MapServer')
          } else {
            // Unknown method, return 404
            return res.status(404).json({ error: 'Method not found', method: method })
          }
      }
    } catch (error) {
      this.handleError(res, error)
    }
  }

  /**
   * Handle query requests
   */
  async handleQuery(req, res) {
    try {
      // Use Koop's standard getData method
      this.model.getData(req, (error, geojson) => {
        if (error) {
          return this.handleError(res, error)
        }

        // Handle different response formats
        const f = req.query.f || 'json'
        
        if (f === 'geojson') {
          res.json(geojson)
        } else if (req.query.returnCountOnly === 'true') {
          res.json({
            count: geojson.features.length
          })
        } else if (req.query.returnIdsOnly === 'true') {
          const ids = geojson.features.map(feature => {
            const idField = geojson.metadata.idField
            return idField ? feature.properties[idField] : null
          }).filter(id => id !== null)
          
          res.json({
            objectIdFieldName: geojson.metadata.idField || 'OBJECTID',
            objectIds: ids
          })
        } else {
          // Convert to Esri JSON format
          const esriJson = this.convertToEsriJson(geojson, req.query)
          res.json(esriJson)
        }
      })
    } catch (error) {
      this.handleError(res, error)
    }
  }

  /**
   * Handle queryRelatedRecords requests
   */
  async handleQueryRelatedRecords(req, res) {
    
    try {
      const { layer } = req.params
      const { objectIds, relationshipId, definitionExpression, outFields, returnGeometry, f } = req.query
      
      // Get the main layer metadata to find relationships
      this.model.getData(req, async (error, geojson) => {
        if (error) {
          return this.handleError(res, error)
        }
        
        try {
          const relationships = geojson.metadata.relationships || []
          
          // Handle relationshipId - remove quotes if present
          let cleanRelationshipId = relationshipId
          if (typeof relationshipId === 'string' && relationshipId.startsWith('"') && relationshipId.endsWith('"')) {
            cleanRelationshipId = relationshipId.slice(1, -1)
          }
          
          // Find the relationship
          let relationship
          if (cleanRelationshipId !== undefined && cleanRelationshipId !== null) {
            const relId = parseInt(cleanRelationshipId)
            relationship = relationships.find(rel => rel.id === relId)
            
            if (!relationship) {
              relationship = relationships.find(rel => rel.name === cleanRelationshipId)
            }
          } else {
            relationship = relationships[0] // Use first relationship if none specified
          }
          
          if (!relationship) {
            return res.status(400).json({
              error: {
                code: 400,
                message: `Relationship not found. Available relationships: ${relationships.map(r => `${r.id}:${r.name}`).join(', ')}`,
                details: []
              }
            })
          }
          
          
          // Get object IDs to query
          let targetObjectIds = []
          if (objectIds) {
            targetObjectIds = objectIds.split(',').map(id => parseInt(id))
          } else {
            // Get all object IDs from the main layer (limit to first 3 for testing)
            const mainLayerFeatures = geojson.features || []
            const idField = geojson.metadata.idField || 'location_id'
            const allObjectIds = mainLayerFeatures.map(feature => feature.properties[idField]).filter(id => id != null)
            targetObjectIds = allObjectIds.slice(0, 3)
          }
          
          
          // For now, return test data to verify the endpoint is working
          const relatedRecords = targetObjectIds.map(objectId => ({
            objectId: objectId,
            relatedRecords: [
              {
                attributes: {
                  id: 1,
                  location_id: objectId,
                  name: `Test ${relationship.relatedTableName} for location ${objectId}`,
                  type: relationship.relatedTableName,
                  relationship_id: relationship.id
                }
              }
            ]
          }))
          
          // Format response according to Esri specification
          const response = {
            relatedRecordGroups: relatedRecords.map(group => ({
              objectId: group.objectId,
              relatedRecords: group.relatedRecords.map(record => ({
                attributes: record.attributes,
                geometry: returnGeometry === 'true' ? record.geometry : undefined
              }))
            }))
          }
          
          res.json(response)
          
        } catch (relatedError) {
          return res.status(500).json({
            error: {
              code: 500,
              message: `Related records error: ${relatedError.message}`,
              details: []
            }
          })
        }
      })
    } catch (error) {
      this.handleError(res, error)
    }
  }

  /**
   * Handle getEstimates requests (NEW for multi-layer support)
   */
  async handleGetEstimates(req, res) {
    try {
      const { schema, layer } = req.params
      
      // Get table info from layer ID
      const layerInfo = await this.model.getTableByLayerId(schema || 'public', layer)
      if (!layerInfo) {
        return res.status(404).json({ error: `Layer ${layer} not found` })
      }
      
      // Get estimates from model
      const estimates = await this.model.getLayerEstimates(schema || 'public', layerInfo.tableName, layerInfo.geometryColumn)
      
      res.json(estimates)
    } catch (error) {
      this.handleError(res, error)
    }
  }

  /**
   * Handle layer info requests
   */
  async handleLayerInfo(req, res) {
    try {
      this.model.getData(req, (error, geojson) => {
        if (error) {
          return this.handleError(res, error)
        }

        // Check if this is a service root request
        if (geojson.metadata && geojson.metadata.isServiceRoot) {
          console.log('Service root detected, generating service info from metadata')
          return this.generateServiceInfoFromMetadata(req, res, geojson.metadata, 'FeatureServer')
        }

        const layerInfo = this.generateLayerInfo(geojson.metadata, req.params)
        res.json(layerInfo)
      })
    } catch (error) {
      this.handleError(res, error)
    }
  }

  /**
   * Handle service root requests directly (bypasses Koop's built-in FeatureServer)
   */
  async handleServiceRoot(req, res) {
    try {
      const { id } = req.params
      const schemaName = id || 'public'
      
      console.log(`DIRECT SERVICE ROOT REQUEST for schema: ${schemaName}`)
      
      // Get database configuration and initialize pool
      const config = this.model.getDatabaseConfig('default')
      await this.model.initializePool(config)
      
      // Get all tables in the schema
      const allTables = await this.model.getAllTablesInSchema(schemaName)
      console.log('DIRECT: Found tables for service:', allTables.length)
      
      if (allTables.length === 0) {
        return res.status(404).json({
          error: {
            code: 404,
            message: `No tables found in schema '${schemaName}'. Please check that the schema exists and contains tables.`,
            details: [`Schema: ${schemaName}`, `Available schemas can be checked via database administration tools`]
          }
        })
      }
      
      // Separate spatial layers from non-spatial tables
      const spatialLayers = allTables.filter(t => !t.isTable)
      const nonSpatialTables = allTables.filter(t => t.isTable)
      
      console.log(`DIRECT: Found ${spatialLayers.length} spatial layers and ${nonSpatialTables.length} non-spatial tables`)
      
      const serviceInfo = {
        currentVersion: 11.2,
        serviceDescription: `Multi-layer service for schema ${schemaName}`,
        hasVersionedData: false,
        supportsDisconnectedEditing: false,
        hasStaticData: false,
        hasSharedDomains: false,
        maxRecordCount: parseInt(process.env.KOOP_MAX_RECORD_COUNT) || 50000,
        supportedQueryFormats: "JSON",
        supportsVCSProjection: false,
        supportedExportFormats: "",
        capabilities: "Query",
        description: `Multi-layer service for schema ${schemaName}`,
        copyrightText: "Copyright information varies by provider. For more information please contact the source of this data.",
        spatialReference: {"wkid": 4326, "latestWkid": 4326},
        fullExtent: {"xmin": -180, "ymin": -90, "xmax": 180, "ymax": 90, "spatialReference": {"wkid": 4326, "latestWkid": 4326}},
        initialExtent: {"xmin": -180, "ymin": -90, "xmax": 180, "ymax": 90, "spatialReference": {"wkid": 4326, "latestWkid": 4326}},
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
        tables: nonSpatialTables.map(table => ({
          id: table.id,
          name: table.name,
          type: "Table",
          parentLayerId: -1,
          defaultVisibility: true,
          subLayerIds: null,
          minScale: 0,
          maxScale: 0
        })),
        layers: spatialLayers.map(layer => ({
          id: layer.id,
          name: layer.name,
          parentLayerId: -1,
          defaultVisibility: true,
          subLayerIds: null,
          minScale: 0,
          maxScale: 0,
          type: "Feature Layer",
          geometryType: layer.geometryType || "esriGeometryPoint"
        })),
        relationships: [],
        supportsRelationshipsResource: false
      }

      console.log('DIRECT: Generated service info with:', {
        layers: serviceInfo.layers.length,
        tables: serviceInfo.tables.length,
        layerNames: serviceInfo.layers.map(l => l.name),
        tableNames: serviceInfo.tables.map(t => t.name)
      })

      res.json(serviceInfo)
    } catch (error) {
      console.error('Error in handleServiceRoot:', error)
      this.handleError(res, error)
    }
  }

  /**
   * Generate service info from metadata (when tables are already loaded)
   */
  generateServiceInfoFromMetadata(req, res, metadata, serviceType) {
    try {
      const { id } = req.params
      const schemaName = id || 'public'
      const allTables = metadata.tables || []
      
      console.log('Generating service info from metadata:', { schemaName, tableCount: allTables.length })
      
      // Separate spatial layers from non-spatial tables
      const spatialLayers = allTables.filter(t => !t.isTable)
      const nonSpatialTables = allTables.filter(t => t.isTable)
      
      const serviceInfo = {
        currentVersion: 11.2,
        serviceDescription: `PostgreSQL/PostGIS ${serviceType} for schema: ${schemaName}`,
        mapName: schemaName,
        description: `Multi-layer ${serviceType} exposing all tables in schema ${schemaName}`,
        copyrightText: 'PostgreSQL/PostGIS Provider',
        supportsDynamicLayers: false,
        layers: spatialLayers.map(layer => ({
          id: layer.id,
          name: layer.name,
          parentLayerId: -1,
          defaultVisibility: true,
          subLayerIds: null,
          minScale: 0,
          maxScale: 0,
          type: 'Feature Layer',
          geometryType: layer.geometryType || 'esriGeometryPoint'
        })),
        tables: nonSpatialTables.map(table => ({
          id: table.id,
          name: table.name,
          type: 'Table',
          parentLayerId: -1,
          defaultVisibility: true,
          subLayerIds: null,
          minScale: 0,
          maxScale: 0
        })),
        spatialReference: {
          wkid: 4326,
          latestWkid: 4326
        },
        singleFusedMapCache: false,
        initialExtent: {
          xmin: -180,
          ymin: -90,
          xmax: 180,
          ymax: 90,
          spatialReference: {
            wkid: 4326,
            latestWkid: 4326
          }
        },
        fullExtent: {
          xmin: -180,
          ymin: -90,
          xmax: 180,
          ymax: 90,
          spatialReference: {
            wkid: 4326,
            latestWkid: 4326
          }
        },
        minScale: 0,
        maxScale: 0,
        units: 'esriDecimalDegrees',
        supportedImageFormatTypes: 'PNG32,PNG24,PNG,JPG,DIB,TIFF,EMF,PS,PDF,GIF,SVG,SVGZ,BMP',
        documentInfo: {
          Title: `${serviceType} for ${schemaName}`,
          Author: 'Koop PostgreSQL/PostGIS Provider',
          Comments: 'Generated by Koop',
          Subject: `PostgreSQL/PostGIS ${serviceType}`,
          Category: '',
          AntialiasingMode: 'None',
          TextAntialiasingMode: 'Force',
          Keywords: 'koop,postgis,postgresql'
        },
        capabilities: 'Map,Query,Data,Relationship,Identify',
        supportedQueryFormats: 'JSON, geoJSON',
        supportedExportFormats: 'sqlite,filegdb,shapefile,csv,kml,kmz',
        hasVersionedData: false,
        maxRecordCount: parseInt(process.env.KOOP_MAX_RECORD_COUNT) || 100000,
        maxImageHeight: 4096,
        maxImageWidth: 4096,
        supportedExtensions: '',
        relationships: [],
        supportsRelationshipsResource: spatialLayers.length > 0
      }

      console.log('Generated service info:', {
        layers: serviceInfo.layers.length,
        tables: serviceInfo.tables.length,
        layerNames: serviceInfo.layers.map(l => l.name),
        tableNames: serviceInfo.tables.map(t => t.name)
      })

      res.json(serviceInfo)
    } catch (error) {
      this.handleError(res, error)
    }
  }

  /**
   * Handle service info requests (UPDATED for multi-layer support)
   */
  async handleServiceInfo(req, res, serviceType) {
    try {
      const { schema, id } = req.params
      // Support both :schema and :id parameters
      const schemaName = schema || (id && !id.includes('.') ? id : 'public')
      const host = 'default' // Always use default host
      
      // Get database configuration and initialize pool
      const config = this.model.getDatabaseConfig(host)
      await this.model.initializePool(config)
      
      // Get all tables in the schema
      const allTables = await this.model.getAllTablesInSchema(schemaName)
      console.log('getAllTablesInSchema result:', allTables)
      
      if (allTables.length === 0) {
        return res.status(404).json({
          error: {
            code: 404,
            message: `No tables found in schema '${schemaName}'. Please check that the schema exists and contains tables.`,
            details: [`Schema: ${schemaName}`, `Available schemas can be checked via database administration tools`]
          }
        })
      }
      
      // Separate spatial layers from non-spatial tables
      const spatialLayers = allTables.filter(t => !t.isTable)
      const nonSpatialTables = allTables.filter(t => t.isTable)
      
      console.log('Spatial layers:', spatialLayers)
      console.log('Non-spatial tables:', nonSpatialTables)
      
      const serviceInfo = {
        currentVersion: 11.2,
        serviceDescription: `PostgreSQL/PostGIS ${serviceType} for schema: ${schemaName}`,
        mapName: schemaName,
        description: `Multi-layer ${serviceType} exposing all tables in schema ${schemaName}`,
        copyrightText: 'PostgreSQL/PostGIS Provider',
        supportsDynamicLayers: false,
        layers: spatialLayers.map(layer => ({
          id: layer.id,
          name: layer.name,
          parentLayerId: -1,
          defaultVisibility: true,
          subLayerIds: null,
          minScale: 0,
          maxScale: 0,
          type: 'Feature Layer',
          geometryType: layer.geometryType || 'esriGeometryPoint'
        })),
        tables: nonSpatialTables.map(table => ({
          id: table.id,
          name: table.name
        })),
        spatialReference: {
          wkid: 4326,
          latestWkid: 4326
        },
        singleFusedMapCache: false,
        initialExtent: {
          xmin: -180,
          ymin: -90,
          xmax: 180,
          ymax: 90,
          spatialReference: {
            wkid: 4326,
            latestWkid: 4326
          }
        },
        fullExtent: {
          xmin: -180,
          ymin: -90,
          xmax: 180,
          ymax: 90,
          spatialReference: {
            wkid: 4326,
            latestWkid: 4326
          }
        },
        minScale: 0,
        maxScale: 0,
        units: 'esriDecimalDegrees',
        supportedImageFormatTypes: 'PNG32,PNG24,PNG,JPG,DIB,TIFF,EMF,PS,PDF,GIF,SVG,SVGZ,BMP',
        documentInfo: {
          Title: `${serviceType} for ${id}`,
          Author: 'Koop PostgreSQL/PostGIS Provider',
          Comments: 'Generated by Koop',
          Subject: `PostgreSQL/PostGIS ${serviceType}`,
          Category: '',
          AntialiasingMode: 'None',
          TextAntialiasingMode: 'Force',
          Keywords: 'koop,postgis,postgresql'
        },
        capabilities: 'Map,Query,Data,Relationship,Identify',
        supportedQueryFormats: 'JSON, geoJSON',
        supportedExportFormats: 'sqlite,filegdb,shapefile,csv,kml,kmz',
        hasVersionedData: false,
        maxRecordCount: parseInt(process.env.KOOP_MAX_RECORD_COUNT) || 100000,
        maxImageHeight: 4096,
        maxImageWidth: 4096,
        supportedExtensions: ''
      }

      res.json(serviceInfo)
    } catch (error) {
      this.handleError(res, error)
    }
  }

  /**
   * Handle identify requests for ArcGIS Pro compatibility
   */
  async identify(req, res) {
    try {
      // For now, just return all features (simplified identify)
      // TODO: Implement proper spatial identify logic
      const modifiedReq = { ...req }
      modifiedReq.query = {
        where: '1=1',
        resultRecordCount: 10, // Limit results for identify
        f: 'json'
      }
      
      // Use the same query handler but format for identify response
      this.model.getData(modifiedReq, (error, geojson) => {
        if (error) {
          return this.handleError(res, error)
        }

        // Format as identify response
        const identifyResults = {
          results: geojson.features.map((feature, index) => ({
            layerId: parseInt(req.params.layer) || 0,
            layerName: req.params.schema || 'public',
            value: feature.properties[geojson.metadata.idField] || index,
            displayFieldName: geojson.metadata.displayField || Object.keys(feature.properties)[0],
            attributes: feature.properties,
            geometry: this.convertGeometryToEsri(feature.geometry)
          }))
        }

        res.json(identifyResults)
      })
    } catch (error) {
      this.handleError(res, error)
    }
  }

  /**
   * Handle general info requests
   */
  async info(req, res) {
    try {
      const { id } = req.params
      const host = 'default' // Always use default host
      
      const info = {
        name: id,
        type: 'PostgreSQL/PostGIS Provider',
        description: `PostgreSQL/PostGIS data source: ${id}`,
        host: host,
        services: [
          {
            name: 'FeatureServer',
            url: `${req.protocol}://${req.get('host')}${req.originalUrl}/FeatureServer`
          },
          {
            name: 'MapServer', 
            url: `${req.protocol}://${req.get('host')}${req.originalUrl}/MapServer`
          }
        ]
      }

      res.json(info)
    } catch (error) {
      this.handleError(res, error)
    }
  }

  /**
   * Convert GeoJSON to Esri JSON format
   */
  convertToEsriJson(geojson, queryParams) {
    const features = geojson.features.map(feature => {
      const esriFeature = {
        attributes: feature.properties || {},
        geometry: this.convertGeometryToEsri(feature.geometry)
      }
      return esriFeature
    })

    const result = {
      objectIdFieldName: geojson.metadata.idField || 'OBJECTID',
      uniqueIdField: {
        name: geojson.metadata.idField || 'OBJECTID',
        isSystemMaintained: true
      },
      globalIdFieldName: '',
      geometryType: this.mapGeometryTypeToEsri(geojson.metadata.geometryType),
      spatialReference: {
        wkid: 4326,
        latestWkid: 4326
      },
      fields: this.convertFieldsToEsri(geojson.metadata.fields),
      features: features
    }

    // Add count information if available
    if (queryParams.returnCountOnly !== 'true') {
      result.exceededTransferLimit = geojson.metadata.limitExceeded || false
    }

    return result
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
   * Map geometry type to Esri format
   */
  mapGeometryTypeToEsri(geometryType) {
    const typeMap = {
      'Point': 'esriGeometryPoint',
      'MultiPoint': 'esriGeometryMultipoint',
      'LineString': 'esriGeometryPolyline',
      'MultiLineString': 'esriGeometryPolyline',
      'Polygon': 'esriGeometryPolygon',
      'MultiPolygon': 'esriGeometryPolygon'
    }
    return typeMap[geometryType] || 'esriGeometryPoint'
  }

  /**
   * Convert fields to Esri format
   */
  convertFieldsToEsri(fields) {
    if (!fields) return []

    return fields.map(field => ({
      name: field.name,
      type: this.mapFieldTypeToEsri(field.type),
      alias: field.alias || field.name,
      length: field.length || 255,
      nullable: true,
      defaultValue: null,
      modelName: field.name
    }))
  }

  /**
   * Map field type to Esri format
   */
  mapFieldTypeToEsri(fieldType) {
    const typeMap = {
      'String': 'esriFieldTypeString',
      'Integer': 'esriFieldTypeInteger',
      'Double': 'esriFieldTypeDouble',
      'Date': 'esriFieldTypeDate'
    }
    return typeMap[fieldType] || 'esriFieldTypeString'
  }

  /**
   * Generate layer info response
   */
  generateLayerInfo(metadata, params) {
    const isNonSpatial = !metadata.geometryType
    
    // Check if there are any date fields for temporal configuration
    const dateFields = metadata.fields ? metadata.fields.filter(field => field.type === 'Date') : []
    const hasDateFields = dateFields.length > 0
    
    // Determine if this should be a temporal layer
    const enableTemporal = process.env.KOOP_ENABLE_TEMPORAL === 'true'
    const temporalField = process.env.KOOP_TEMPORAL_FIELD || metadata.displayField
    
    const isTemporalLayer = enableTemporal && hasDateFields && temporalField && 
      dateFields.some(field => field.name === temporalField)
    
    const layerInfo = {
      id: parseInt(params.layer) || 0,
      name: metadata.name || params.schema,
      type: isNonSpatial ? 'Table' : 'Feature Layer',
      description: metadata.description || '',
      geometryType: isNonSpatial ? null : this.mapGeometryTypeToEsri(metadata.geometryType),
      sourceSpatialReference: {
        wkid: 4326,
        latestWkid: 4326
      },
      copyrightText: '',
      parentLayer: null,
      subLayers: [],
      minScale: 0,
      maxScale: 0,
      defaultVisibility: true,
      extent: {
        xmin: metadata.extent[0][0],
        ymin: metadata.extent[0][1],
        xmax: metadata.extent[1][0],
        ymax: metadata.extent[1][1],
        spatialReference: {
          wkid: 4326,
          latestWkid: 4326
        }
      },
      hasAttachments: false,
      htmlPopupType: 'esriServerHTMLPopupTypeAsHTMLText',
      supportsAdvancedQueries: true,
      canModifyLayer: false,
      enableZDefaults: false,
      zDefault: 0,
      allowGeometryUpdates: true,
      displayField: metadata.displayField || '',
      typeIdField: null,
      subtypeFieldName: null,
      subtypeField: null,
      defaultSubtypeCode: null,
      fields: this.convertFieldsToEsri(metadata.fields),
      geometryField: isNonSpatial ? null : {
        name: 'Shape',
        type: 'esriFieldTypeGeometry',
        alias: 'Shape'
      },
      indexes: [],
      subtypes: [],
      relationships: metadata.relationships || [],
      canModifyLayer: false,
      canScaleSymbols: false,
      hasLabels: false,
      capabilities: 'Map,Query,Data,Identify,Relationship',
      maxRecordCount: metadata.maxRecordCount || parseInt(process.env.KOOP_MAX_RECORD_COUNT) || 100000,
      supportsStatistics: true,
      supportsAdvancedQueries: true,
      supportedQueryFormats: 'JSON, geoJSON',
      supportsValidateSql: false,
      supportsCoordinatesQuantization: true,
      supportsReturningQueryGeometry: true,
      isDataVersioned: false,
      ownershipBasedAccessControlForFeatures: {
        allowOthersToQuery: true
      },
      useStandardizedQueries: true,
      advancedQueryCapabilities: {
        useStandardizedQueries: true,
        supportsStatistics: true,
        supportsHavingClause: true,
        supportsCountDistinct: true,
        supportsOrderBy: true,
        supportsDistinct: true,
        supportsPagination: true,
        supportsTrueCurve: true,
        supportsReturningQueryExtent: true,
        supportsQueryWithDistance: true,
        supportsSqlExpression: true
      },
      supportsDatumTransformation: true,
      supportsCoordinatesQuantization: true
    }
    
    // Add temporal configuration if this is a temporal layer
    if (isTemporalLayer) {
      layerInfo.timeInfo = {
        startTimeField: temporalField,
        endTimeField: null,
        trackIdField: null,
        timeExtent: null,
        timeReference: {
          timeZone: 'UTC',
          respectsDaylightSaving: false
        },
        hasLiveData: false,
        defaultTimeInterval: 1,
        defaultTimeIntervalUnits: 'esriTimeUnitsHours'
      }
      
      layerInfo.supportsTime = true
      layerInfo.timeInfo.exportOptions = {
        useTime: true,
        timeDataCumulative: false,
        timeOffset: null,
        timeOffsetUnits: null
      }
    } else {
      layerInfo.timeInfo = null
      layerInfo.supportsTime = false
    }
    
    return layerInfo
  }

  /**
   * Handle errors consistently
   */
  handleError(res, error) {
    console.error('PostgreSQL/PostGIS Provider Error:', error)
    
    const errorResponse = {
      error: {
        code: error.code || 500,
        message: error.message || 'Internal server error',
        details: []
      }
    }

    res.status(error.code || 500).json(errorResponse)
  }
}

module.exports = Controller
