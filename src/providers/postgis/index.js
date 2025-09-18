const Model = require('./model')
const Controller = require('./controller')
const routes = require('./routes')

const provider = {
  name: 'arcgis',
  hosts: false, // Disable host parameter
  disableIdParam: false,
  Model,
  Controller,
  routes, // Add custom routes
  version: require('./package.json').version
}

module.exports = provider
