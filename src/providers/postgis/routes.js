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
  {
    path: '/:id',
    methods: ['get'],
    handler: 'info'
  }
]
