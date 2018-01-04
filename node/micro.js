// json-rpc

const fs = require('fs')
const path = require('path')

const {json} = require('micro')
const serializeError = require('serialize-error')
const tv4 = require('tv4')
const {get, set} = require('lodash')
const jsonwebtoken = require('jsonwebtoken')

const requestSchema = require('./request.schema')
const addError = require('./addError')

function addJwt (secret) {
  return fn =>
    (req, res) => {
      try {
        const token = req.headers.authorization.replace('Bearer ', '')
        req.jwt = jsonwebtoken.verify(token, secret)
      } catch (err) {}

      return fn(req, res)
    }
}

class RpcError extends Error {
  constructor (data = null, message = 'General error', code = 0) {
    super(message)

    this.data = data
    this.code = code
  }
}

// Yeah recursion!
//
// Turns a ValidationError that looks like this:
//
// ValidationError {
//   message: 'title must be at least 1 characters long',
//   params: { length: 0, minimum: '1' },
//   code: 200,
//   dataPath: '/title',
//   schemaPath: '/allOf/0/properties/title/minLength',
//   subErrors: [...],
//   stack: {...}
// }
//
// Into errors a frontend can easily consume like this:
//
// {
//   title: 'title must be at least 1 characters long',
// }
//
// Pretty neat, huh
//
function _makeHashOutOfValidateErrors (accumulatedErrors, validateError) {
  const __accumulatedErrors = Object.assign({}, accumulatedErrors)

  // If required error
  const path = /required/.test(validateError.schemaPath)
    // Path is the params.key
    ? validateError.params.key
    // Path is in the dataPath
    : validateError.dataPath.substring(1).replace(/\//g, '.')

  // Set the error
  set(__accumulatedErrors, path, validateError.message)

  // If there aren't any suberrors, return out
  if (!validateError.subErrors) return __accumulatedErrors

  // Recurse on suberrors
  return validateError.subErrors.reduce(
    _makeHashOutOfValidateErrors,
    __accumulatedErrors
  )
}

// Recursively combines properties in "allOf" schemas, so the combined "default" properties can be read,
// for defaulting params coming in
function _resolveAndCombineAllOfs (schema) {
  if (!schema.allOf) { return schema }

  const combinedProperties = schema.allOf.reduce((prev, curr) => {
    const schemaOfRef = tv4.getSchema(curr['$ref'])
    const resolvedSchemaOfRef = _resolveAndCombineAllOfs(schemaOfRef)
    return Object.assign({}, prev, resolvedSchemaOfRef.properties)
  }, schema.properties || {})

  return Object.assign({}, schema, {properties: combinedProperties})
}

function handleRpcs (rpcDir, {dontDefault} = {dontDefault: []}) {
  // Read methods in directory, get dict like:
  // {
  //    myFunction: myFunction().paramsSchema
  // }
  //
  // so we can reference them quickly below

  if (!fs.existsSync(rpcDir)) {
    throw new Error('Passed rpc directory not found')
  }

  const files = fs.readdirSync(rpcDir)
  const methods = files.reduce(
    (methods, filename) => {
      // Only files
      if (!fs.lstatSync(path.join(rpcDir, filename)).isFile()) return methods

      const name = filename.split('.')[0]
      const module = require(path.join(rpcDir, filename))
      // If it's a method file or a random schema
      const isMethod = filename.split('.')[1] !== 'schema'

      if (isMethod) {
        if (!module.paramsSchema) {
          throw new Error(`paramsSchema not exported from ${filename}`)
        }
        methods[name] = module
        tv4.addSchema(name, module.paramsSchema)
      } else {
        tv4.addSchema(name, module)
      }

      return methods
    },
    {}
  )

  // Also add support for directories with an index.js
  const isDir = source => fs.lstatSync(source).isDirectory()
  const dirs = fs.readdirSync(rpcDir).filter(name => isDir(path.join(rpcDir, name)))
  dirs.reduce(
    (dirMethods, dirname) => {
      const fqn = path.join(rpcDir, dirname, 'index.js')
      try {
        fs.accessSync(fqn)
      } catch (err) {
        return dirMethods
      }

      const name = dirname
      const module = require(fqn)
      if (!module.paramsSchema) {
        throw new Error(`paramsSchema not exported from ${dirname}/index.js`)
      }
      dirMethods[name] = module
      tv4.addSchema(name, module.paramsSchema)

      return dirMethods
    },
    methods
  )
  console.log({
    message: 'Loaded RPC methods',
    methods: Object.keys(methods).sort()
  })


  return fn =>
    async (req, res, ...args) => {
      // Assume if the content type is application/json, that it's an rpc request
      if (req.headers['content-type'] !== 'application/json') {
        return fn(req, res, ...args)
      }

      let js = {id: null}

      try {
        // Validate json
        try {
          js = await json(req)
        } catch (err) {
          throw new RpcError(serializeError(err), 'Parse error', -32700)
        }

        // Validate request
        const requestValidateResult = tv4.validateResult(js, requestSchema)
        if (!requestValidateResult.valid) {
          throw new RpcError(
            _makeHashOutOfValidateErrors({}, requestValidateResult.error),
            'Invalid request',
            -32600
          )
        }

        // Validate method exists
        if (!methods[js.method]) {
          throw new RpcError(null, 'Method not found', -32601)
        }

        // Default params (mutates js.params)
        // dontDefault is an option
        if (methods[js.method].paramsSchema && dontDefault.indexOf(js.method) === -1) {
          const combinedSchema = _resolveAndCombineAllOfs(methods[js.method].paramsSchema)
          Object.keys(combinedSchema.properties || {}).forEach(property => {
            if (combinedSchema.properties[property].default === undefined) return
            if (get(js, ['params', property]) !== undefined) return

            set(js, ['params', property], combinedSchema.properties[property].default)
          })
        }

        // Validate params
        if (methods[js.method].paramsSchema) {
          const methodValidateResult = tv4.validateResult(
            js.params || {},
            methods[js.method].paramsSchema
          )
          if (!methodValidateResult.valid) {
            throw new RpcError(
              _makeHashOutOfValidateErrors({}, methodValidateResult.error),
              'Invalid params',
              -32602
            )
          }
        }

        req.method = js.method
        req.id = js.id

        // Call fn
        const result = await methods[js.method](js.params, req, res)

        // Success
        return {jsonrpc: '2.0', result, id: js.id}
      } catch (err) {
        if (
          !(err instanceof RpcError) && process.env.NODE_ENV === 'production'
        ) {
          console.error({
            message: 'Error occured in RPC function',
            error: serializeError(err)
          })
        }

        // Send the full error in dev mode for easier debugging
        const {code, message, data} = err instanceof RpcError
          ? err
          : new RpcError(
              process.env.NODE_ENV !== 'production' && serializeError(err),
              'Internal error',
              -32603
            )

        return {jsonrpc: '2.0', error: {code, message, data}, id: js.id}
      }
    }
}

function prodRpcLogger (fn) {
  return async function logRpc (req, res, ...args) {
    if (req.headers['content-type'] === 'application/json') {
      req.json = await json(req)
    }

    res.once('finish', () => {
      if (req.method === 'GET') return

      let delta = new Date() - start
      delta = `${delta}ms`
      const stringBody = JSON.stringify(res._logBody) || ''
      const responseSize = `${stringBody.length}b`
      const statusCode = get(res, '_logBody.error.statusCode') ||
        res.statusCode ||
        200

      console.log(JSON.stringify({
        method: req.method,
        statusCode,
        delta,
        responseSize,
        requestBody: req.json,
        responseBody: res._logBody
      }))
    })

    const start = new Date()
    const ret = await fn(req, res, ...args)

    res._logBody = ret
    return res._logBody
  }
}

// svc-rpc

const http = require('http')

const micro = require('micro')
const listen = require('test-listen')
const pick = require('lodash/pick')

const {jwtRpc} = require('./client')

const makeTestRpc = (microFnOrServer, {deps = Promise.resolve(), defaultJwt = {}} = {}) =>
  async (method, params, {jwt = {}, keepId = false} = {}) => {
    await deps

    let service = microFnOrServer instanceof http.Server
      ? microFnOrServer
      : micro(microFnOrServer)

    const url = await listen(service)

    const rpcJwt = jwt
      ? jsonwebtoken.sign(Object.assign({}, jwt), process.env.JWT_SECRET)
      : jsonwebtoken.sign(Object.assign({}, defaultJwt), process.env.JWT_SECRET)
    const response = await jwtRpc(url, method, params, rpcJwt)

    if (get(response, 'result._id') && !keepId) {
      delete response.result._id
    }

    return pick(response, 'result', 'error')
  }

module.exports = {addJwt, handleRpcs, RpcError, addError, prodRpcLogger, makeTestRpc}
