var Busboy = require('busboy')
var FormData = require('form-data')
var concatStream = require('concat-stream')
var https = require('https')

module.exports = Service

function Service (options) {
  if (!(this instanceof Service)) {
    return new Service(options)
  }

  ;['address', 'domain', 'key', 'logger'].forEach(function (option) {
    if (!options[option]) {
      throw new Error('missing ' + option + ' option')
    } else {
      this['_' + option] = options[option]
    }
  })

  ;['api', 'normalize'].forEach(function (option) {
    if (options[option]) {
      this['_' + option] = options[option]
    }
  })

  this._handlers = {}
}

var prototype = Service.prototype

prototype.handler = function (request, response) {
  var service = this
  if (request.method === 'POST') {
    var logger = service._logger
    readPostBody(request, function (error, fields) {
      if (error) {
        logger.error(error)
        respond(500)
      } else {
        var from = fields.from
        var subject = this._normalize
          ? this._normalize(fields.subject)
          : fields.subject
        var headers = headersJSONToObject(fields['message-headers'])
        logger.info('message', {
          subject: subject,
          from: from
        })
        this.emit(
          subject,
          {
            from: from,
            headers: headers,
            text: fields['stripped-text']
          },
          handlerCallback
        )
      }

      function handlerCallback (error, message) {
        if (error) {
          if (response) {
            reply(error.toString())
          } else {
            logger.info('not replying')
            respond(200)
          }
        } else {
          reply(message)
        }
      }

      // Send a reply e-mail with Mailgun.
      function reply (text) {
        // The Mailgun v3 API takes form-data post requests.
        var form = new FormData()
        form.append('from', service._address)
        form.append('to', from)
        form.append('subject', subject)
        ;['In-Reply-To', 'References'].forEach(function (header) {
          if (header in headers) {
            form.append('h:' + header, headers[header])
          }
        })
        form.append('text', text)
        form.append('o:dkim', 'yes')
        form.append('o:tracking', 'no')
        form.append('o:tracking-clicks', 'no')
        form.append('o:tracking-opens', 'no')

        var options = {
          method: 'POST',
          host: service._api || 'api.mailgun.net',
          path: '/v3/' + service._domain + '/messages',
          auth: 'api:' + service._key,
          headers: form.getHeaders()
        }
        var request = https.request(options, function (response) {
          var statusCode = response.statusCode
          logger.info('response', {statusCode: statusCode})
          if (statusCode !== 200) {
            response.pipe(concatStream(function (body) {
              logger.error('send error', {message: body})
              respond(500)
            }))
          } else {
            respond(200)
          }
        })
        form.pipe(request)
      }
    })
  } else {
    response.statusCode = 405
    response.end()
  }

  function respond (statusCode) {
    response.statusCode = statusCode
    response.end()
  }
}

function readPostBody (request, callback) {
  var fields = {}
  var busboy
  try {
    busboy = new Busboy({headers: request.headers})
  } catch (error) {
    callback(error)
    return
  }
  busboy
    .on('field', function (field, value) {
      fields[field] = value
    })
    .once('finish', function () {
      callback(null, fields)
    })
  request.pipe(busboy)
}

function headersJSONToObject (json) {
  return json.reduce(function (returned, array) {
    returned[array[0]] = array[1]
    return returned
  }, {})
}

prototype.on = function (subject, handler) {
  if (this._handlers[subject]) {
    throw new Error(
      'already set a handler for the subject "' + subject + '"'
    )
  } else {
    this._handlers[subject] = handler
  }
}
