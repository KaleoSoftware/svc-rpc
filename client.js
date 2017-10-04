// json-rpc

const fetch = require('isomorphic-fetch')
const pick = require('lodash/pick')
const merge = require('lodash/merge')
const uuidV4 = require('uuid/v4')
const chalk = require('chalk')
const jsome = require('jsome')

let requestCounter = 0

function logRequest (url, requestBody) {
  if (typeof window !== 'undefined') {
    return {}
  }
  if (process.env.NODE_ENV === 'production') {
    return {start: new Date()}
  }

  const start = new Date()
  const requestIndex = ++requestCounter
  const dateString = `${chalk.grey(start.toLocaleTimeString())}`
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `> #${requestIndex} ${chalk.bold('POST')} ${url}\t\t${dateString}`
    )
    jsome(requestBody)
  }
  return {start, requestIndex}
}

function logResponse (
  statusCode,
  responseBody,
  start,
  requestIndex,
  requestBody
) {
  if (typeof window !== 'undefined') {
    return
  }

  const delta = new Date() - start
  const time = delta < 10000 ? `${delta}ms` : `${Math.round(delta / 1000)}s`
  const endDateString = `${chalk.grey(new Date().toLocaleTimeString())}`

  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `< #${requestIndex} ${chalk.bold(statusCode)} [+${time}]\t${endDateString}`
    )
    jsome(responseBody)
  } else {
    let delta = new Date() - start
    delta = `${delta}ms`
    const stringBody = JSON.stringify(responseBody)
    const responseSize = `${stringBody.length}b`

    console.log(JSON.stringify({
      method: 'POST',
      statusCode,
      delta,
      responseSize,
      requestBody,
      responseBody
    }))
  }
}

async function rpc (url, method, params, options) {
  // Allow passing falsy values to params
  if (!params) {
    params = undefined
  }

  const id = uuidV4()
  const requestBody = {jsonrpc: '2.0', method, params, id}

  const {start, requestIndex} = logRequest(url, requestBody)

  const response = await fetch(
    url,
    merge(
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      },
      options
    )
  )

  let responseJson
  if (!/^2/.test(response.status.toString())) {
    responseJson = {
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal error',
        id,
        data: pick(response, 'url', 'status', 'statusText')
      }
    }
  } else {
    responseJson = await response.json()
  }

  logResponse(
    response.status.toString(),
    responseJson,
    start,
    requestIndex,
    requestBody
  )

  return responseJson
}

// svc-rpc

const cookie = require('cookie')

function getJwt (reqOrJwt) {
  let parsed = {}

  if (reqOrJwt && typeof reqOrJwt === 'string') {
    parsed.jwt = reqOrJwt
  } else if (reqOrJwt) {
    parsed = cookie.parse(reqOrJwt.headers.cookie || '')
  } else if (typeof window !== 'undefined') {
    parsed = cookie.parse(document.cookie || '')
  }

  return parsed.jwt
}

function jwtRpc (url, method, params, reqOrJwt) {
  const jwt = getJwt(reqOrJwt)

  const options = {headers: {Authorization: jwt && `Bearer ${jwt}`}}

  return rpc(url, method, params, options)
}

function svcRpc (service, method, params, jwt) {
  if (!process.env[`SVC_${service.toUpperCase()}_URL`]) {
    throw new Error(
      `Rpc request made to service that wasn't found in config: ${service}`
    )
  }
  const url = process.env[`SVC_${service.toUpperCase()}_URL`]

  return jwtRpc(url, method, params, jwt)
}

module.exports = {rpc, jwtRpc, svcRpc}
