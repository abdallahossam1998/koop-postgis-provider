module.exports = [
  // Simplified routes without host parameter
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
  {
    path: '/:id/FeatureServer',
    methods: ['get'],
    handler: 'featureServer'
  },
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
