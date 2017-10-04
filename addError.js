/**
 * tv4 lets you add custom errors with setErrorReporter, but it's kind of
 * inflexible because you can't granularly set errors for specific schemaPath's
 * (like minLength, or pattern, or whatever)
 *
 * This abstraction lets you add more granularity when overwriting specific errors,
 * and has good default errors.
 *
 * To use:
 *
 * const {addError} = require('json-rpc-micro')
 *
 * // Same args as tv4 setErrorReporter, see their docs
 * addError(...args) {
 *   return 'My custom error'
 * }
 *
 * See below for specific examples
 */

const tv4 = require('tv4')

const {decamelize} = require('humps')
const {flow, capitalize} = require('lodash')

const _errors = []
function addError (fn) {
  _errors.unshift(fn)
}
tv4.setErrorReporter(function errorReporter (...args) {
  return _errors.reduce(
    (message, currentFn) => message || currentFn(...args),
    null
  )
})

addError(({schemaPath}, _, schema) => {
  if (!/required/.test(schemaPath)) return

  const name = flow(
    parseInt,
    requiredId => schema.required[requiredId],
    name => decamelize(name, {separator: ' '}),
    capitalize
  )(schemaPath.split('/').pop())

  return `${name} is required`
})

addError(({schemaPath}, _, schema) => {
  if (!/minLength/.test(schemaPath)) return

  const characters = schema.minLength === '1' ? 'character' : 'characters'

  return `${schema.title} must be at least ${schema.minLength} ${characters} long`
})

addError(({schemaPath}, _, schema) => {
  if (!/maxLength/.test(schemaPath)) return

  return `${schema.title} must be less than ${schema.maxLength} characters long`
})

addError(({schemaPath}, _, schema) => {
  if (!/pattern/.test(schemaPath)) return

  return `${schema.title} is invalid`
})

module.exports = addError
