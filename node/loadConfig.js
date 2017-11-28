const fs = require('fs')

const dotenv = require('dotenv')
const _ = require('lodash')
const jsome = require('jsome')

if (!fs.existsSync('.env')) {
  throw new Error('.env file missing!')
}

const envExample = dotenv.parse(fs.readFileSync('.env.example'))
const env = dotenv.parse(fs.readFileSync('.env'))

const difference = _.difference(Object.keys(envExample), Object.keys(env))

if (difference.length !== 0) {
  throw new Error(`You're missing an env var in .env that's set in .env.example: ${JSON.stringify(difference)}`)
}

Object.keys(env).forEach(key => {
  if (process.env.hasOwnProperty(key)) return
  process.env[key] = env[key]
})

const cleanConfig = _(process.env)
  .pickBy((_, key) => !/^npm_/.test(key)) // Removes npm_* vars
  .toPairs()
  .sortBy(0)
  .fromPairs() // Orders by key alphabetically
  .value()

if (process.env.NODE_ENV === 'production') {
  console.log(`Starting with config: ${JSON.stringify(cleanConfig)}`)
}
if (process.env.NODE_ENV === 'development') {
  console.log('Starting with config:')
  jsome(cleanConfig)
}
