'use strict'

module.exports = function (path) {
    if (typeof path !== 'string') return ''
    
    path = path.replace(/\/$/i, '')

    if (path.length === 0 || path === '/') return ''
    
    if (path[0] !== '/')
      path = `/${path}`

    let length = path.length

    if (path.length > 1 && path[length - 1] === '/')
        path = path.substring(0, length - 1)
    
    return path
}

