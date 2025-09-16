const config = require('config')
const PostgisProvider = require('./providers/postgis')

// Create a clean copy of the config to avoid reference issues
const postgisConfig = JSON.parse(JSON.stringify(config.postgis || {}));

const outputs = []
const auths = []
const caches = []
const plugins = [
  {
    instance: PostgisProvider,
    options: postgisConfig
  }
]
module.exports = [...outputs, ...auths, ...caches, ...plugins]
