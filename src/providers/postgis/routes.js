module.exports = [
  {
    path: '/:host/:id/FeatureServer/:layer/:method',
    methods: ['get', 'post'],
    handler: 'featureServer'
  },
  {
    path: '/:host/:id/FeatureServer/:layer',
    methods: ['get'],
    handler: 'featureServer'
  },
  {
    path: '/:host/:id/FeatureServer',
    methods: ['get'],
    handler: 'featureServer'
  },
  {
    path: '/:host/:id/MapServer/:layer/:method',
    methods: ['get', 'post'],
    handler: 'mapServer'
  },
  {
    path: '/:host/:id/MapServer/:layer',
    methods: ['get'],
    handler: 'mapServer'
  },
  {
    path: '/:host/:id/MapServer',
    methods: ['get'],
    handler: 'mapServer'
  },
  {
    path: '/:host/:id',
    methods: ['get'],
    handler: 'info'
  }
]
