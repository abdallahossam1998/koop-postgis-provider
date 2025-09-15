const swaggerUi = require('swagger-ui-express')
const swaggerDocument = require('../../swagger.json')

// Swagger UI setup function
function setupSwagger(app) {
  // Serve swagger docs at /api-docs
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "PostGIS Koop Provider API Documentation"
  }))
  
  // Serve raw swagger JSON at /api-docs.json
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(swaggerDocument)
  })
}

// Route handler for swagger docs redirect
function swaggerRedirect(req, res) {
  res.redirect('/api-docs')
}

module.exports = {
  setupSwagger,
  swaggerRedirect,
  swaggerDocument
}
