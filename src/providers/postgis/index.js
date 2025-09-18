const Model = require('./model')
const Controller = require('./controller')

const provider = {
  name: 'arcgis',
  hosts: true,
  disableIdParam: false,
  Model,
  Controller,
  version: require('./package.json').version
}

module.exports = provider
