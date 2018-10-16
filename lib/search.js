'use strict'

module.exports = mixinSearch

function mixinSearch(PostgreSQL) {
    PostgreSQL.prototype.buildWhere = function(model, where) {
        var whereClause = this._buildWhere(model, where);
        var searchObj = getSearchQuery(where)

        if (whereClause.sql && searchObj.searchClause) {
            whereClause.sql = `${searchObj.join} WHERE ${whereClause.sql} AND (${searchObj.searchClause})`
        } else if (whereClause.sql) {
            whereClause.sql = `${searchObj.join} WHERE ${whereClause.sql}`
        } else if (searchObj.searchClause) {
            whereClause.sql = `${searchObj.join} WHERE ${searchObj.searchClause}`
        }        
        return whereClause
    }

    PostgreSQL.prototype.columnEscaped = function (model, property) {
        if (isNested(property)) {
            // Convert column to PostgreSQL json style query: "model"->>'val'
            var self = this
            return property
                .split('.')
                .map(function (val, idx) { return (idx === 0 ? self.columnEscaped(model, val) : escapeLiteral(val)) })
                .reduce(function (prev, next, idx, arr) {
                    return idx == 0 ? next : idx < arr.length - 1 ? prev + '->' + next : prev + '->>' + next
                })
        } else {
            if (!this.isJoinSearch) {
                return this.escapeName(this.column(model, property))
            }
            return model.toLowerCase() + '.' + property
        }
    }

    function getSearchQuery(where) {
        let retval = { join: '' }
        let joinArr = []
        let searchClause = []
        if (where.refSearch) {
            if (where.refSearch.join) {
                if (Array.isArray(where.refSearch.join)) {
                    where.refSearch.join.forEach(value => {
                        let strSrc = `${value.source.model}.${value.source.field}`
                        let strDes = `${value.des.model}.${value.des.field}`
                        joinArr.push(` inner join ${value.des.model} on ${strSrc} = ${strDes}`)
                    })
                }
            } if (where.refSearch.keysSearch) {
                if (Array.isArray(where.refSearch.keysSearch)) {
                    where.refSearch.keysSearch.forEach(value => {
                        let strQuery = `${value.field}::text ILIKE  \'%${value.value}%\'`
                        searchClause.push(strQuery)
                    })
                }
            }
            let join = joinArr.join(' ').trim()
            let search = searchClause.join(' OR ').trim()
            retval = { join: join, searchClause: search }
        }
        return retval
    }

    function isNested(property) {
        return property.split('.').length > 1
    }

    function escapeLiteral(str) {
        var hasBackslash = false
        var escaped = '\''
        for (var i = 0; i < str.length; i++) {
            var c = str[i]
            if (c === '\'') {
                escaped += c + c
            } else if (c === '\\') {
                escaped += c + c
                hasBackslash = true
            } else {
                escaped += c
            }
        }
        escaped += '\''
        if (hasBackslash === true) {
            escaped = ' E' + escaped
        }
        return escaped
    }
}


