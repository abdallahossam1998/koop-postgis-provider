module.exports = [
  // Multi-layer FeatureServer routes (schema-based)
  // These routes will be prefixed with /arcgis/rest/services by Koop
  {
    path: '/:id/FeatureServer/:layer/:method',
    methods: ['get', 'post'],
    handler: 'featureServer'
  },
  {
    path: '/:id/FeatureServer/:layer',
    methods: ['get'],
    handler: 'featureServer'
  },
  // PRIORITY ROUTE: Handle service-level requests directly
  {
    path: '/:id/FeatureServer',
    methods: ['get'],
    handler: 'handleServiceRoot'
  },
  // Multi-layer MapServer routes (schema-based)
  {
    path: '/:id/MapServer/:layer/:method',
    methods: ['get', 'post'],
    handler: 'mapServer'
  },
  {
    path: '/:id/MapServer/:layer',
    methods: ['get'],
    handler: 'mapServer'
  },
  {
    path: '/:id/MapServer',
    methods: ['get'],
    handler: 'mapServer'
  },
  // Identify endpoints for ArcGIS Pro compatibility
  {
    path: '/:id/FeatureServer/identify',
    methods: ['get', 'post'],
    handler: 'identify'
  },
  {
    path: '/:id/MapServer/identify',
    methods: ['get', 'post'],
    handler: 'identify'
  },
  {
    path: '/:id',
    methods: ['get'],
    handler: 'info'
  }
]
