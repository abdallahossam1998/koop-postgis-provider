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
      
      // Handle different FeatureServer methods
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
            // URL pattern: /id/FeatureServer/0 - show layer info
            return this.handleLayerInfo(req, res)
          } else if (!method && !layer) {
            // URL pattern: /id/FeatureServer - show service info
            return this.handleServiceInfo(req, res, 'FeatureServer')
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
   * Handle layer info requests
   */
  async handleLayerInfo(req, res) {
    try {
      this.model.getData(req, (error, geojson) => {
        if (error) {
          return this.handleError(res, error)
        }

        const layerInfo = this.generateLayerInfo(geojson.metadata, req.params)
        res.json(layerInfo)
      })
    } catch (error) {
      this.handleError(res, error)
    }
  }

  /**
   * Handle service info requests
   */
  async handleServiceInfo(req, res, serviceType) {
    try {
      const { id } = req.params
      const host = 'default' // Always use default host
      
      const serviceInfo = {
        currentVersion: 10.91,
        serviceDescription: `PostgreSQL/PostGIS ${serviceType} for ${id}`,
        mapName: id,
        description: `PostgreSQL/PostGIS layer: ${id}`,
        copyrightText: '',
        supportsDynamicLayers: false,
        layers: [
          {
            id: 0,
            name: id,
            parentLayerId: -1,
            defaultVisibility: true,
            subLayerIds: null,
            minScale: 0,
            maxScale: 0,
            type: 'Feature Layer',
            geometryType: 'esriGeometryPoint'
          }
        ],
        tables: [],
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
            layerId: 0,
            layerName: req.params.id,
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
      name: metadata.name || params.id,
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
