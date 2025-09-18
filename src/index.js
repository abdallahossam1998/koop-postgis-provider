const config = require('config')
const Koop = require('@koopjs/koop-core')
const routes = require('./routes')
const plugins = require('./plugins')
const { setupSwagger } = require('./request-handlers/swagger-docs')

// initiate a koop app
const koop = new Koop()

// register all plugins (providers, outputs, auths, caches)
plugins.forEach((plugin) => {
  try {
    koop.register(plugin.instance, plugin.options)
    console.log(`Successfully registered plugin: ${plugin.instance.name || 'Unknown'}`)
  } catch (error) {
    console.error(`Failed to register plugin:`, error.message)
  }
})

// setup swagger documentation
setupSwagger(koop.server)

// add additional routes
routes.forEach((route) => {
  route.methods.forEach((method) => {
    koop.server[method](route.path, route.handler)
  })
})

// start the server
koop.server.listen(config.port, () => {
  koop.log.info(`Koop server listening at ${config.port}`)
  koop.log.info(`API Documentation available at http://localhost:${config.port}/api-docs`)
})
