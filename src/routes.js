const welcomePage = require('./request-handlers/welcome-page')
const { swaggerRedirect } = require('./request-handlers/swagger-docs')

module.exports = [
  {
    path: '/',
    methods: ['get'],
    handler: welcomePage
  },
  {
    path: '/docs',
    methods: ['get'],
    handler: swaggerRedirect
  }
]
