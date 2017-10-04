# svc-rpc

Minimal service-to-service json-rpc framework, based on micro.

Uses [json-rpc 2.0](http://www.jsonrpc.org/specification) for communication.

Uses [json-schema 2.0](http://json-schema.org/) to validate parameters.

Uses [JWT](https://jwt.io/) for authentication and authorization.

## Install

Install with npm:

`npm i svc-rpc`

If you're using this with micro, install peer dependencies:

`npm i micro tv4`

## micro

### Setup

Set up your micro js file like:

```js
const path = require('path')

const micro = require('micro')
const {send} = micro

const {handleRpcs} = require('svc-rpc')

module.exports = handleRpcs(path.join(__dirname, 'rpc')(
  async (req, res) => send(res, 404)
)
```

`handleRpcs(directory)` will look for rpcs in the passed directory and automatically listen for those rpcs.

rpcs are a single js file that export a function.

So to write your first rpc, create `rpc/example.js` and fill it with:

```js
module.exports = () => 'hello world'
```

You could then send a json-rpc request to that service from another script:

```js
const {rpc} = require('svc-rpc/client')

const {result} = rpc('localhost:3000', 'example')

console.log(result) // 'hello world'
```

### Validation

Function parameters are validated using json-schema. Just set `module.exports.paramsSchema` to a POJO with the schema for the parameters, and it will get validated automatically.

So in `rpc/exampleWithParams.js`, you might write:

```js
module.exports = ({name}) => `hello ${name}!`

module.exports.paramsSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      maxLength: 20
    }
  }
}
```

And then you could make an rpc request in another service/script with:

```js
const {rpc} = require('svc-rpc/client')

const {result} = rpc('localhost:3000', 'exampleWithParams', {name: 'john'})

console.log(result) // 'hello john!'

const {error} = rpc('localhost:3000', 'exampleWithParams', {name: 123})

console.log(error) // "{code: -32602, message: 'Invalid params', data: {name: 'Expected string instead of number'}}", or something like that
```

### Custom errors

If you want to create your own errors, you can use the `addError()` function, which gets the same parameters as [tv4](https://github.com/geraintluff/tv4)'s `setErrorReporter()` function.

So in your micro js file, you might put:

```js
addError((error, data, schema) => {
  if (!/minLength/.test(error.schemaPath)) return

  const characters = schema.minLength === '1' ? 'character' : 'characters'

  return `${schema.title} must be at least ${schema.minLength} ${characters} long`
})

```

Which creates a custom error message for strings that don't meet the minimum length.

### Logging

We recommend [micro-visualize](https://github.com/onbjerg/micro-visualize) for development logging.

For production, `prodRpcLogger()` is available, which logs requests and responses on single lines as JSON.

Example:

```js
module.exports = compose(
  process.env.NODE_ENV === 'development' && visualize,
  process.env.NODE_ENV === 'production' && prodRpcLogger,
  addJwt(process.env.JWT_SECRET),
  handleRpcs(path.join(__dirname, 'rpc'))
)(async (req, res) => send(res, 404))
```

### addJwt()

A helper HoF, `addJwt()`, is available if you want to add the jwt from cookies.jwt or authorization header to the `req` object, as `req.jwt`. This is useful for authenticating. An alternative is [micro-jwt-auth](https://github.com/kandros/micro-jwt-auth), which blocks requests with a 401 if the jwt isn't correct.

Example:

```js
module.exports = compose(
  addJwt(process.env.JWT_SECRET),
  handleRpcs(path.join(__dirname, 'rpc'))
)(async (req, res) => send(res, 404))
```

## client

### rpc

`rpc(url, method, params, additionalFetchOptions)` is the vanilla json-rpc caller. You can call any json-rpc service with it.

Example:

```js
const {result, error} = rpc('localhost:3000', 'myFunction', {parameterHere: 'hey'})

console.log(result, error)
```

### jwtRpc

If you want to make a call with a jwt, you can use jwtRpc(url, method, parameters, reqOrJwt)

You can pass a node IncomingMessage (req) object to reqOrJwt, a jwt itself, or nothing and it will try to retrieve it from document.cookies if in the browser.

Useable on the server:
```js
const {jwtRpc, getJwt} = require('svc-rpc/client')

const {result, error} = await jwtRpc('localhost:3001', 'myRemoteFunction', {hello: 'world'}, 'some.jwt.here')

console.log(result, error)
```

Or in the browser, with jwt in cookies:
```js
import {jwtRpc} from 'rpc'

// getJwt() will automatically read the jwt from cookies
await jwtRpc('localhost:3001', 'myRemoteFunction', {hello: 'world'})
```

In a next.js page's `getInitialProps()`, with jwt in the `req` `Authorization` header or cookie, for SSR:

```js
import {jwtRpc} from 'rpc'

const MyPage = () => <div />

MyPage.getInitialProps(({req}) => {
  const getUserResponse = await jwtRpc('localhost:3001', 'getUser', {id: 1}, getJwt(req))

  return {user: getUserResponse.result}
})

```

### svcRpc

If you follow our convention, and put service urls in environment variables like so:

```
SVC_USERS_URL=https://mysite.com/svc/users
SVC_POSTS_URL=https://mysite.com/svc/posts
```

You can use the `svcRpc(service, method, params, reqOrJwt)` method.

So with those environment vars set you could:

```jsjs
import {svcRpc} from 'rpc'

// jwt is automatically grabbed from cookies if called in browser
const {result, error} = await svcRpc('users', 'findOne', {username: 'tuckerconnelly'})

console.log(result.id) // 123

```

## Testing

### makeTestRpc

You can easily set up a test rpc function, which boots up your micro server on a random port and hits the test url, by using the `makeTestRpc(microFnOrServer, deps=Promise.resolve(), defaultJwt={})`

`deps` is a promise that must resolve before any testRpcs are made (say, waiting to connect to an external service).

`defaultJwt` is the default jwt sent along with requests

Call this once to create a `testRpc(method, params, jwt=defaultJwt)` function in your setup script:

testSetup.js
```js
const {makeTestRpc} = require('./common/node/svc-rpc/micro')
module.exports.testRpc = makeTestRpc(require('./index'))
```

And then in a test file:

```js
const {testRpc} = require('../testSetup')

it('should do something', async () => {
  const {error} = await testRpc('findUser', {username: 'tuckerconnelly'})

  expect(error).toBeFalsy()
})
```

## Authors

John Lynch - [johnthethird](https://github.com/johnthethird)
Tucker Connelly - [tuckerconnelly](https://github.com/tuckerconnelly)
