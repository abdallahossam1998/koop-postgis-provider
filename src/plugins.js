const config = require('config')
const PostgisProvider = require('./providers/postgis')
const tile = require('@koopjs/output-vector-tiles')

// Create a clean copy of the config to avoid reference issues
const postgisConfig = JSON.parse(JSON.stringify(config.postgis || {}));

// Output plugins (like vector tiles)
const outputs = []

// Try to add vector tiles plugin with proper format detection
try {
  if (tile && typeof tile === 'function') {
    // Direct function export
    outputs.push({
      instance: tile,
      options: {}
    })
  } else if (tile && tile.instance) {
    // Object with instance property
    outputs.push({
      instance: tile.instance,
      options: tile.options || {}
    })
  } else if (tile && tile.default) {
    // ES6 default export
    outputs.push({
      instance: tile.default,
      options: {}
    })
  } else {
    console.warn('Vector tiles plugin not added - unexpected export format')
  }
} catch (error) {
  console.warn('Failed to load vector tiles plugin:', error.message)
}

const auths = []
const caches = []

// Provider plugins
const providers = [
  {
    instance: PostgisProvider,
    options: postgisConfig
  }
]

module.exports = [...outputs, ...auths, ...caches, ...providers]
